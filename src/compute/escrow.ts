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
 * pontusx-node and its deployments use) and Escrow v2 (contracts 3.2.0, ocean.js 10's
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
    /** Snapshot used to plan these limits, checked again before writing. */
    previous: Awaited<ReturnType<typeof readAuthorization>>
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

  if (version === 2 && (await escrow.isEscrowEnterprise())) {
    if (!(await escrow.isTokenAllowed(quote.token)))
      throw new Error(
        `Enterprise escrow ${quote.escrowAddress} does not allow token ${quote.token}. Nothing was spent.`
      )

    // With zero decimal places the wrapper accepts and returns exact base units.
    const fee = BigInt(
      await escrow.previewFee(quote.token, quote.amount.toString(), 0)
    )
    if (fee >= quote.amount)
      throw new Error(
        `Enterprise escrow fee ${fee} leaves no payment from the gross lock amount ${quote.amount} base units. Nothing was spent.`
      )
  }

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

  const current = await readAuthorization(escrow, quote, payer, version)
  const covered = await coversJob(current, quote, signer, false)

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
          maxLockedAmount: max(
            current.maxLockedAmount,
            current.currentLockedAmount + quote.amount
          ),
          maxLockSeconds: max(current.maxLockSeconds, quote.minLockSeconds),
          maxLockCounts: max(current.maxLockCounts, current.currentLocks + 1n),
          previous: current
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

  const latest = await readAuthorization(escrow, quote, plan.payer, version)
  if (authorize) {
    const previous = authorize.previous
    if (
      latest.present !== previous.present ||
      latest.expiryTimestamp !== previous.expiryTimestamp ||
      latest.maxLockedAmount !== previous.maxLockedAmount ||
      latest.maxLockCounts !== previous.maxLockCounts ||
      latest.maxLockSeconds !== previous.maxLockSeconds ||
      latest.currentLockedAmount !== previous.currentLockedAmount ||
      latest.currentLocks !== previous.currentLocks
    )
      throw new Error(
        `The payer's escrow authorisation for ${quote.payee} changed after planning. No authorisation or order was sent.`
      )
    const expiry = await renewalExpiry(
      signer,
      quote,
      latest.expiryTimestamp,
      deposit > 0n
    )

    await send(escrow, chainConfig, signer, 'authorize', [
      quote.token,
      quote.payee,
      authorize.maxLockedAmount,
      authorize.maxLockSeconds,
      authorize.maxLockCounts,
      ...(version === 2 ? [expiry] : [])
    ])
  } else if (!(await coversJob(latest, quote, signer, deposit > 0n))) {
    throw new Error(
      `The payer's escrow authorisation for ${quote.payee} no longer covers this compute job. No order was sent.`
    )
  }
}

// #region helpers

async function coversJob(
  grant: Awaited<ReturnType<typeof readAuthorization>>,
  quote: EscrowPaymentQuote,
  signer: Signer,
  deposited: boolean
): Promise<boolean> {
  const expiry = await renewalExpiry(
    signer,
    quote,
    grant.expiryTimestamp,
    deposited
  )
  return (
    grant.present &&
    grant.maxLockedAmount >= grant.currentLockedAmount + quote.amount &&
    grant.maxLockSeconds >= quote.minLockSeconds &&
    grant.maxLockCounts > grant.currentLocks &&
    grant.expiryTimestamp === expiry
  )
}

async function readAuthorization(
  escrow: EscrowContract,
  quote: EscrowPaymentQuote,
  payer: string,
  version: EscrowVersion
) {
  const auths = (await escrow.getAuthorizations(
    quote.token,
    payer,
    quote.payee
  )) as unknown[]
  const standing = (auths ?? []).find(
    (auth) => getAddress(String(field(auth, 'payee', 0))) === quote.payee
  )

  return {
    present: standing !== undefined,
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
}

/** Expiring grants must cover the lock time and the orders and start call ahead of it. */
async function renewalExpiry(
  signer: Signer,
  quote: EscrowPaymentQuote,
  expiryTimestamp: bigint,
  deposited: boolean
): Promise<bigint> {
  if (expiryTimestamp === 0n) return 0n
  const now = await chainTime(signer)

  if (expiryTimestamp < now)
    throw new Error(
      `The payer's escrow authorisation for ${quote.payee} on ${quote.escrowAddress} expired at ${expiryTimestamp} (chain time ${now}), which is how an authorisation is revoked; nautilus does not re-authorise it. Authorise the payee again to run paid jobs on it. ${deposited ? 'The deposit was confirmed.' : 'Nothing was spent.'}`
    )

  return max(
    expiryTimestamp,
    now + quote.minLockSeconds + EXPIRY_MARGIN_SECONDS
  )
}

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
      'Cannot read the chain time to check the escrow authorisation expiry: the latest block is unavailable.'
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
