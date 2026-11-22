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
 * Two contract generations are in use. Escrow v1 (`@oceanprotocol/contracts` 2.x, which
 * pontusx-node and its deployments use) and Escrow v2 (contracts 3.x, ocean.js 10's
 * default ABI), whose authorisation has a 7th field `expiryTimestamp` and whose
 * `authorize` takes it as a 6th argument. A v2 contract answers ERC-165 for its core
 * interface, a v1 contract has no `supportsInterface`; nautilus reads and writes each with
 * its own ABI.
 *
 * Not exported from the package.
 */
import {
  type Config,
  EscrowContract,
  getOceanArtifactsAddressesByChainId,
  sendTx
} from '@oceanprotocol/lib'
import { Contract, getAddress, isAddress, type Signer } from 'ethers'
import { type Logger, log } from '../log/logger.js'
import { approveFeeWei, confirmTransaction } from '../utils/order.js'
import type { EscrowPaymentQuote } from '../utils/paymentLimits.js'

const ERC20_BALANCE_ABI = [
  'function balanceOf(address) view returns (uint256)'
] as const

/**
 * Seconds an expiring Escrow v2 authorisation must outlast the job's lock time by, for the
 * orders and the start call before the node locks. ocean.js's `verifyFundsForEscrowPayment`
 * adds the same.
 */
const EXPIRY_MARGIN_SECONDS = 120n

/** Which escrow contract generation an address holds. */
export type EscrowVersion = 1 | 2

const abiAddress = (name: string) => ({
  name,
  type: 'address',
  internalType: 'address'
})
const abiUint = (name: string) => ({
  name,
  type: 'uint256',
  internalType: 'uint256'
})

/**
 * The Escrow v1 functions nautilus calls (`@oceanprotocol/contracts` 2.x). ocean.js 10
 * ships only the v2 ABI, which cannot decode a v1 authorisation (6 fields, not 7) and
 * encodes `authorize` with a 6th argument a v1 contract does not have.
 */
const ESCROW_V1_ABI = [
  {
    type: 'function',
    name: 'getUserFunds',
    stateMutability: 'view',
    inputs: [abiAddress('payer'), abiAddress('token')],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct Escrow.userFunds',
        components: [abiUint('available'), abiUint('locked')]
      }
    ]
  },
  {
    type: 'function',
    name: 'getAuthorizations',
    stateMutability: 'view',
    inputs: [abiAddress('token'), abiAddress('payer'), abiAddress('payee')],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        internalType: 'struct Escrow.auth[]',
        components: [
          abiAddress('payee'),
          abiUint('maxLockedAmount'),
          abiUint('currentLockedAmount'),
          abiUint('maxLockSeconds'),
          abiUint('maxLockCounts'),
          abiUint('currentLocks')
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [abiAddress('token'), abiUint('amount')],
    outputs: []
  },
  {
    type: 'function',
    name: 'authorize',
    stateMutability: 'nonpayable',
    inputs: [
      abiAddress('token'),
      abiAddress('payee'),
      abiUint('maxLockedAmount'),
      abiUint('maxLockSeconds'),
      abiUint('maxLockCounts')
    ],
    outputs: []
  }
]

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
    /**
     * Escrow v2 only: after it the payee can no longer create or extend locks; `0` is
     * indefinite, which is what a v1 authorisation always is.
     */
    expiryTimestamp: bigint
  }
  /** The escrow contract's generation, read before planning. */
  version: EscrowVersion
}

/**
 * Reads the payer's escrow balance, its authorisation for the payee and its token balance,
 * and decides what to deposit and authorise. Read-only. Throws when the wallet cannot
 * cover the deposit, before anything is sent.
 *
 * The plan holds absolute values computed from what it read (`currentLockedAmount +
 * amount`, `currentLocks + 1`), so it is only right until another job of the same payer
 * and payee changes them. `compute()` therefore plans, funds and starts each job under its
 * `escrowLock`, one job at a time per (chain, payer, token, payee).
 */
export async function planEscrow(
  signer: Signer,
  chainConfig: Config,
  quote: EscrowPaymentQuote
): Promise<EscrowPlan> {
  const payer = getAddress(await signer.getAddress())
  const version = await escrowVersion(signer, chainConfig, quote.escrowAddress)
  const escrow = escrowAt(signer, chainConfig, quote.escrowAddress, version)

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
    currentLocks: toBigInt(field(standing, 'currentLocks', 5) ?? 0),
    // v2 only; a v1 authorisation never expires
    expiryTimestamp:
      version === 2 ? toBigInt(field(standing, 'expiryTimestamp', 6) ?? 0) : 0n
  }

  // An expiring v2 authorisation must outlast the job's lock, which the node creates only
  // after the orders and the start call: EXPIRY_MARGIN_SECONDS on top, as ocean.js's own
  // escrow check adds. Read from the chain's clock, which the contract compares against.
  let lockUntil = 0n

  if (current.expiryTimestamp !== 0n) {
    const now = await chainTime(signer)

    // In v2 a payer revokes by re-authorising with a past expiry: never undo that.
    if (current.expiryTimestamp <= now)
      throw new Error(
        `The payer's escrow authorisation for ${quote.payee} on ${quote.escrowAddress} expired at ${current.expiryTimestamp} (chain time ${now}), which is how an authorisation is revoked; nautilus does not re-authorise it. Authorise the payee again to run paid jobs on it. Nothing was spent.`
      )

    lockUntil = now + quote.minLockSeconds + EXPIRY_MARGIN_SECONDS
  }

  const neededLocked = current.currentLockedAmount + quote.amount
  const covered =
    standing !== undefined &&
    current.maxLockedAmount >= neededLocked &&
    current.maxLockSeconds >= quote.minLockSeconds &&
    current.maxLockCounts > current.currentLocks &&
    (current.expiryTimestamp === 0n || current.expiryTimestamp >= lockUntil)

  return {
    quote,
    payer,
    deposit,
    version,
    // Raise only what falls short, to exactly what this job needs; an allowance the payer
    // set higher before is left as it was. An expiring v2 authorisation stays expiring,
    // moved out to the job's lock; one without expiry stays without.
    authorize: covered
      ? undefined
      : {
          maxLockedAmount: max(current.maxLockedAmount, neededLocked),
          maxLockSeconds: max(current.maxLockSeconds, quote.minLockSeconds),
          maxLockCounts: max(current.maxLockCounts, current.currentLocks + 1n),
          expiryTimestamp:
            current.expiryTimestamp === 0n
              ? 0n
              : max(current.expiryTimestamp, lockUntil)
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
  plan: EscrowPlan,
  logger: Logger = log
): Promise<void> {
  const { quote, deposit, authorize, version } = plan
  const escrow = escrowAt(signer, chainConfig, quote.escrowAddress, version)

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

    logger.emit('compute.escrow.deposited', 'Deposited into the escrow.', {
      paymentToken: quote.token,
      amount: deposit.toString()
    })
  }

  if (authorize)
    await send(escrow, chainConfig, signer, 'authorize', [
      quote.token,
      quote.payee,
      authorize.maxLockedAmount,
      authorize.maxLockSeconds,
      authorize.maxLockCounts,
      ...(version === 2 ? [authorize.expiryTimestamp] : [])
    ])
}

// #region helpers

function escrowAt(
  signer: Signer,
  chainConfig: Config,
  address: string,
  version: EscrowVersion
): EscrowContract {
  return version === 2
    ? new EscrowContract(address, signer, chainConfig.chainId, chainConfig)
    : new EscrowContract(
        address,
        signer,
        chainConfig.chainId,
        chainConfig,
        ESCROW_V1_ABI as never
      )
}

/**
 * The escrow contract's generation: 2 when it answers ERC-165 for Escrow v2's core
 * interface (ocean.js `isEscrowCore`, which reads a revert or a missing method as no),
 * else 1.
 */
export async function escrowVersion(
  signer: Signer,
  chainConfig: Config,
  address: string
): Promise<EscrowVersion> {
  const probe = new EscrowContract(
    address,
    signer,
    chainConfig.chainId,
    chainConfig
  )

  return typeof probe.isEscrowCore === 'function' &&
    (await probe.isEscrowCore()) === true
    ? 2
    : 1
}

/** The latest block's timestamp, in seconds. */
async function chainTime(signer: Signer): Promise<bigint> {
  const block = await signer.provider?.getBlock('latest')

  if (!block)
    throw new Error(
      'Cannot read the chain time to check the escrow authorisation expiry: the signer has no provider. Nothing was spent.'
    )

  return BigInt(block.timestamp)
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
    await sendTx(gas, signer, chainConfig.gasFeeMultiplier, fn, ...args),
    signer,
    escrow.address
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
