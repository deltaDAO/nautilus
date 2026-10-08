import type {
  ComputeEnvironment,
  ComputeResources,
  Nautilus,
  NautilusOptions,
  TokenAmount
} from '@deltadao/nautilus'
import { Contract, isAddress, parseUnits } from 'ethers'

/**
 * How much a node may charge these examples.
 *
 * The node chooses the provider fee of every download and compute input (token, amount and
 * who receives it) and the amount a compute job locks in escrow. nautilus pays a non-zero
 * fee or escrow payment only when the caller allows it, with a ceiling or a confirmation
 * callback; without either it throws before anything is spent. The examples set the
 * ceilings from `.env`:
 *
 *   MAX_PROVIDER_FEE="<token>:<amount>"    most provider fee per access/compute call
 *   MAX_ESCROW_PAYMENT="<token>:<amount>"  most escrow per compute job
 *
 * The amount is in the token's smallest unit: 1 token at 18 decimals is
 * 1000000000000000000. Several tokens: comma separated. With `MAX_PROVIDER_FEE` unset only
 * zero provider fees are paid (the usual case for downloads); with `MAX_ESCROW_PAYMENT`
 * unset, the paid compute example allows what the environment advertises for the job
 * (`advertisedJobPrice`).
 */
export function paymentLimits(): Pick<
  NautilusOptions,
  'maxProviderFee' | 'maxEscrowPayment'
> {
  return {
    maxProviderFee: ceilingFromEnv('MAX_PROVIDER_FEE'),
    maxEscrowPayment: ceilingFromEnv('MAX_ESCROW_PAYMENT')
  }
}

/** A `token:amount` list from the environment, or `undefined` when it is unset. */
export function ceilingFromEnv(name: string): TokenAmount[] | undefined {
  const value = process.env[name]?.trim()

  if (!value) return undefined

  return value.split(',').map((entry) => {
    const [token, amount, ...rest] = entry.trim().split(':')

    if (
      rest.length ||
      !token ||
      !isAddress(token) ||
      !/^\d+$/.test(amount ?? '')
    )
      throw new Error(
        `${name} must be "<token address>:<amount in the token's smallest unit>" pairs, comma separated (1 token at 18 decimals is 1000000000000000000), not '${entry.trim()}'.`
      )

    return { token, amount: BigInt(amount) }
  })
}

const DECIMALS_ABI = ['function decimals() view returns (uint8)'] as const

/**
 * What the environment advertises for this job, in the payment token's smallest unit: per
 * resource, its price per minute × the amount × the started minutes, summed in the order
 * the environment lists its resources, the way ocean-node prices it. A resource the job
 * does not request is counted at its minimum, as the node fills it in.
 *
 * Used as the escrow ceiling of the paid example: the node may lock no more than its own
 * price list says. A node that raises the amount (for instance to satisfy a resource
 * constraint) is refused with an `EscrowPaymentNotAllowedError` naming the amount, before
 * anything is spent; set `MAX_ESCROW_PAYMENT` to allow more.
 */
export async function advertisedJobPrice(
  nautilus: Nautilus,
  environment: ComputeEnvironment,
  resources: ComputeResources,
  maxJobDuration: number
): Promise<TokenAmount | undefined> {
  const chainId = nautilus.getOceanConfig().chainId
  const fees = environment.fees?.[String(chainId)]?.[0]

  if (!fees) return undefined

  const duration = Math.max(maxJobDuration, environment.minJobDuration ?? 0)
  const minutes = Math.ceil(duration / 60)
  let cost = 0

  for (const resource of environment.resources ?? []) {
    const requested = resources.find((entry) => entry.id === resource.id)
    const amount = Math.max(requested?.amount ?? 0, resource.min ?? 0)
    const price =
      fees.prices?.find((entry) => entry.id === resource.id)?.price ?? 0

    cost += price * amount * minutes
  }

  const token = new Contract(fees.feeToken, DECIMALS_ABI, nautilus.getSigner())
  const decimals = Number(await token.getFunction('decimals')())

  // Rounded the way the node rounds it: to the token's decimals, then the shortest decimal
  // string for that number (written out in full where JavaScript would use an exponent).
  const rounded = Number(cost.toFixed(decimals))
  const text = /e/i.test(String(rounded))
    ? rounded.toFixed(decimals)
    : String(rounded)

  return { token: fees.feeToken, amount: parseUnits(text, decimals) }
}
