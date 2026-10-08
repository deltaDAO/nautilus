/**
 * Funding and authorising the C2D escrow for one job, in exact amounts.
 *
 * The node locks the job's payment from the payer's escrow balance with
 * `Escrow.createLock(jobId, token, payer, amount, expiry)`, which requires
 *
 *   funds[payer][token].available >= amount
 *   an authorisation of the payer for msg.sender (the environment's account) with
 *     expiry <= maxLockSeconds, currentLockedAmount + amount <= maxLockedAmount,
 *     currentLocks < maxLockCounts
 *
 * so this deposits only the shortfall, approving the escrow for exactly that, and
 * authorises only what the job needs on top of the current locks. Every amount is in the
 * token's smallest unit, as the node quotes it and the contract takes it.
 *
 * Not exported from the package.
 */
import {
  type Config,
  EscrowContract,
  getOceanArtifactsAddressesByChainId,
  LoggerInstance,
  sendTx
} from '@oceanprotocol/lib'
import { Contract, getAddress, isAddress, type Signer } from 'ethers'
import { approveFeeWei, confirmTransaction } from '../utils/order.js'
import type { EscrowPaymentQuote } from '../utils/paymentLimits.js'

const ERC20_BALANCE_ABI = [
  'function balanceOf(address) view returns (uint256)'
] as const

/**
 * Which rule chose the escrow contract a paid compute job may fund:
 *
 * - `explicit`: the caller set it (`config.escrow` in `Nautilus.create`, or `escrow` in
 *   `compute()`'s context);
 * - `enterprise-escrow`: the `EnterpriseEscrow` entry of Ocean's address data for the chain;
 * - `escrow`: the `Escrow` entry, on a chain whose address data lists no `EnterpriseEscrow`;
 * - `none`: no contract is known, so paid compute is refused.
 */
export type EscrowPinRule = 'explicit' | 'enterprise-escrow' | 'escrow' | 'none'

/** The one escrow contract a paid compute job may fund, and the rule that chose it. */
export interface EscrowPin {
  /** Checksummed. `undefined` only with the rule `none`. */
  address?: string
  rule: EscrowPinRule
}

/**
 * The escrow contract a paid compute job on `chainId` may fund. Exactly one, or none:
 *
 * 1. `explicit`, when the caller set one: that contract, and no other.
 * 2. Otherwise the contract ocean-node 4.2.0 itself uses for the chain
 *    (`getEscrowContractAddressForChain`): the `EnterpriseEscrow` entry of Ocean's address
 *    data when it has one, else its `Escrow` entry. The address data is the file
 *    `ADDRESS_FILE` names when set, else the addresses ocean.js ships.
 * 3. Neither: rule `none`, and paid compute is refused.
 *
 * ocean.js's `ConfigHelper` fills `config.escrow` from the `Escrow` entry, so a chain
 * config's `escrow` is not a caller's choice and is not read here. Nothing comes from the
 * node. Reads no chain. Throws when `explicit` is set but is not an address.
 */
export function resolveEscrowPin(
  chainId: number,
  explicit?: string
): EscrowPin {
  if (explicit !== undefined && explicit !== '') {
    if (!isAddress(explicit))
      throw new Error(
        `The escrow contract set for paid compute must be an address, not '${explicit}'. Set the chain's EnterpriseEscrow contract, or leave it unset to use Ocean's address data for chain ${chainId}.`
      )

    return { address: getAddress(explicit), rule: 'explicit' }
  }

  let addresses: Record<string, unknown> | null = null

  try {
    addresses = getOceanArtifactsAddressesByChainId(chainId)
  } catch {
    addresses = null
  }

  const enterprise = addresses?.EnterpriseEscrow
  if (typeof enterprise === 'string' && isAddress(enterprise))
    return { address: getAddress(enterprise), rule: 'enterprise-escrow' }

  const plain = addresses?.Escrow
  if (typeof plain === 'string' && isAddress(plain))
    return { address: getAddress(plain), rule: 'escrow' }

  return { rule: 'none' }
}

/** What `fundEscrow` will send, decided from chain reads before anything is sent. */
export interface EscrowPlan {
  quote: EscrowPaymentQuote
  payer: string
  /** To deposit: the job's amount less what is already available in escrow. */
  deposit: bigint
  /** The authorisation to set, or `undefined` when the standing one covers the job. */
  authorize?: {
    maxLockedAmount: bigint
    maxLockSeconds: bigint
    maxLockCounts: bigint
  }
}

/**
 * Reads the payer's escrow balance, its authorisation for the payee and its token balance,
 * and decides what to deposit and authorise. Read-only. Throws when the wallet cannot
 * cover the deposit, before anything is sent.
 */
export async function planEscrow(
  signer: Signer,
  chainConfig: Config,
  quote: EscrowPaymentQuote
): Promise<EscrowPlan> {
  const payer = getAddress(await signer.getAddress())
  const escrow = escrowAt(signer, chainConfig, quote.escrowAddress)

  const funds = await escrow.getUserFunds(payer, quote.token)
  const available = toBigInt(field(funds, 'available', 0) ?? 0)
  const deposit = quote.amount > available ? quote.amount - available : 0n

  if (deposit > 0n) {
    const token = new Contract(quote.token, ERC20_BALANCE_ABI, signer)
    const balance = toBigInt(await token.getFunction('balanceOf')(payer))

    if (balance < deposit)
      throw new Error(
        `Escrow cannot cover this compute job: it needs ${quote.amount} base units of ${quote.token}, ${available} are available in escrow, and the wallet holds ${balance} of the ${deposit} to deposit. Nothing was spent.`
      )
  }

  const auths = (await escrow.getAuthorizations(
    quote.token,
    payer,
    quote.payee
  )) as unknown[]
  const standing = (auths ?? []).find(
    (auth) => getAddress(String(field(auth, 'payee', 0))) === quote.payee
  )

  const current = {
    maxLockedAmount: toBigInt(field(standing, 'maxLockedAmount', 1) ?? 0),
    currentLockedAmount: toBigInt(
      field(standing, 'currentLockedAmount', 2) ?? 0
    ),
    maxLockSeconds: toBigInt(field(standing, 'maxLockSeconds', 3) ?? 0),
    maxLockCounts: toBigInt(field(standing, 'maxLockCounts', 4) ?? 0),
    currentLocks: toBigInt(field(standing, 'currentLocks', 5) ?? 0)
  }

  const neededLocked = current.currentLockedAmount + quote.amount
  const covered =
    standing !== undefined &&
    current.maxLockedAmount >= neededLocked &&
    current.maxLockSeconds >= quote.minLockSeconds &&
    current.maxLockCounts > current.currentLocks

  return {
    quote,
    payer,
    deposit,
    // Raise only what falls short, to exactly what this job needs; an allowance the payer
    // set higher before is left as it was.
    authorize: covered
      ? undefined
      : {
          maxLockedAmount: max(current.maxLockedAmount, neededLocked),
          maxLockSeconds: max(current.maxLockSeconds, quote.minLockSeconds),
          maxLockCounts: max(current.maxLockCounts, current.currentLocks + 1n)
        }
  }
}

/**
 * Sends what `planEscrow` decided: approves the escrow contract for exactly the deposit
 * (unless a standing allowance covers it), deposits it, and sets the authorisation.
 */
export async function fundEscrow(
  signer: Signer,
  chainConfig: Config,
  plan: EscrowPlan
): Promise<void> {
  const { quote, deposit, authorize } = plan
  const escrow = escrowAt(signer, chainConfig, quote.escrowAddress)

  if (deposit > 0n) {
    await approveFeeWei({
      signer,
      config: chainConfig,
      token: quote.token,
      spender: quote.escrowAddress,
      amount: deposit.toString(),
      what: 'escrow deposit'
    })

    await send(escrow, chainConfig, signer, 'deposit', [quote.token, deposit])

    LoggerInstance.debug('[compute] escrow deposit', {
      token: quote.token,
      amount: deposit.toString()
    })
  }

  if (authorize)
    await send(escrow, chainConfig, signer, 'authorize', [
      quote.token,
      quote.payee,
      authorize.maxLockedAmount,
      authorize.maxLockSeconds,
      authorize.maxLockCounts
    ])
}

// #region helpers

function escrowAt(
  signer: Signer,
  chainConfig: Config,
  address: string
): EscrowContract {
  return new EscrowContract(address, signer, chainConfig.chainId, chainConfig)
}

/**
 * Calls an escrow method with exact base-unit arguments. ocean.js's `deposit` and
 * `authorize` scale their amounts by the token's decimals, so the contract method is
 * called directly, with ocean.js's gas handling.
 */
async function send(
  escrow: EscrowContract,
  chainConfig: Config,
  signer: Signer,
  method: 'deposit' | 'authorize',
  args: unknown[]
): Promise<void> {
  const fn = escrow.contract.getFunction(method)
  const gas = await fn.estimateGas(...args)

  await confirmTransaction(
    `escrow ${method}`,
    await sendTx(gas, signer, chainConfig.gasFeeMultiplier, fn, ...args)
  )
}

/** A struct field by name, or by position for a plain array. */
function field(value: unknown, name: string, index: number): unknown {
  if (value === undefined || value === null) return undefined

  const record = value as Record<string | number, unknown>

  return record[name] !== undefined ? record[name] : record[index]
}

function toBigInt(value: unknown): bigint {
  return BigInt(value as string | number | bigint)
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

// #endregion
