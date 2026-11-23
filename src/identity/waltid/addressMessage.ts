/**
 * The EIP-4361 message of a wallet-api2 address sign-in, rebuilt and checked by nautilus
 * before the signer signs it. Kept out of the package's exports.
 *
 * wallet-api2 builds the message from its challenge (`AddressChallenges.message`); nautilus
 * builds the same text from what it asked for (the gateway URL, the address, the chain, the
 * scopes, its own DPoP key thumbprint) and the three values only the server picks (nonce,
 * issued at, expiration time), and compares them byte for byte. Any difference means the
 * message is not for this gateway, this key or this request, and nothing is signed.
 */
import { getAddress } from 'ethers'

/** A scope of an address token: presenting, and signing DDOs for publishing. */
export type AddressSignInScope = 'present' | 'sign-ddo'

/** The scopes in wallet-api2's canonical order. */
export const ADDRESS_SIGN_IN_SCOPES: readonly AddressSignInScope[] = [
  'present',
  'sign-ddo'
]

export const SCOPE_URN_PREFIX = 'urn:pontusx:wallet2:scope:'
export const JKT_URN_PREFIX = 'urn:ietf:params:oauth:jwk-thumbprint:sha-256:'

/** How long a challenge is valid on wallet-api2 (`AddressChallenges.VALIDITY_SECONDS`). */
export const CHALLENGE_VALIDITY_SECONDS = 300

/** The statement line for `scopes` (`AddressChallenges.statement`). */
export function signInStatement(scopes: readonly string[]): string {
  return `Sign in to the Pontus-X SSI wallet of this address for up to 4 hours, to present credentials to data services${scopes.includes('sign-ddo') ? ' and to sign asset descriptions (DDOs) for publishing' : ''}. This signature cannot move funds or send transactions.`
}

/**
 * `domain` of the message: the host and, when the URL names one, the port of `gateway`,
 * as wallet-api2 derives it from its configured public URL (`java.net.URI`: host as
 * written, port only when given).
 */
export function signInDomain(gateway: string): string {
  const match = /^https?:\/\/([^/?#@]+)/i.exec(gateway)
  if (!match) throw new Error(`Not an http(s) URL: ${gateway}`)
  return match[1]
}

/** Epoch seconds as `java.time.Instant.toString()` prints them: `2026-11-23T10:00:00Z`. */
export function instantText(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.000Z$/, 'Z')
}

/** What the message is built from. */
export interface SignInMessageFields {
  /** The gateway URL, as wallet-api2's `addressSignIn.publicUrl`. */
  gateway: string
  address: string
  chainId: number
  /** The DPoP key's SHA-256 JWK thumbprint. */
  jkt: string
  scopes: readonly string[]
  /** 32 lower-case hex characters. */
  nonce: string
  /** Epoch seconds. */
  issuedAt: number
  /** Epoch seconds. */
  expiresAt: number
}

/**
 * The message wallet-api2 sends for these fields, byte for byte: `AddressChallenges.message`
 * (lines joined by `\n`, no trailing line break, the address in EIP-55 form, the scopes in
 * canonical order, then the thumbprint).
 */
export function buildSignInMessage(fields: SignInMessageFields): string {
  const scopes = ADDRESS_SIGN_IN_SCOPES.filter((scope) =>
    fields.scopes.includes(scope)
  )
  return [
    `${signInDomain(fields.gateway)} wants you to sign in with your Ethereum account:`,
    getAddress(fields.address.toLowerCase()),
    '',
    signInStatement(scopes),
    '',
    `URI: ${fields.gateway}`,
    'Version: 1',
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${instantText(fields.issuedAt)}`,
    `Expiration Time: ${instantText(fields.expiresAt)}`,
    'Resources:',
    ...scopes.map((scope) => `- ${SCOPE_URN_PREFIX}${scope}`),
    `- ${JKT_URN_PREFIX}${fields.jkt}`
  ].join('\n')
}

/** `text` as a JSON string (control characters escaped), at most 300 characters of it. */
function quote(text: string): string {
  return JSON.stringify(text.length > 300 ? `${text.slice(0, 300)}…` : text)
}

/** Why a sign-in message is refused: the first line that differs, expected and actual. */
export class SignInMessageMismatch extends Error {
  constructor(
    readonly field: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super(
      `The sign-in message's ${field} is not what nautilus asked for, so it was not signed. Expected ${quote(expected)}, got ${quote(actual)}.`
    )
    this.name = 'SignInMessageMismatch'
  }
}

const NONCE = /^[0-9a-f]{32}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

function epochOf(text: string | undefined): number | undefined {
  if (!text || !INSTANT.test(text)) return undefined
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms / 1000 : undefined
}

/**
 * Throws a `SignInMessageMismatch` unless `message` is exactly the message for `expected`
 * with a well-formed nonce and a validity window that is open now (`nowSeconds`) and at
 * most `CHALLENGE_VALIDITY_SECONDS` long. `expiresAt` is the challenge answer's own
 * `expiresAt`, which must agree with the message.
 */
export function checkSignInMessage(
  message: string,
  expected: Omit<SignInMessageFields, 'nonce' | 'issuedAt' | 'expiresAt'>,
  options: { nowSeconds: number; expiresAt?: string }
): { nonce: string; issuedAt: number; expiresAt: number } {
  if (typeof message !== 'string')
    throw new SignInMessageMismatch(
      'text',
      'an EIP-4361 message',
      typeof message
    )

  const lines = message.split('\n')
  const value = (index: number, prefix: string) =>
    lines[index]?.startsWith(prefix)
      ? lines[index].slice(prefix.length)
      : undefined

  const nonce = value(8, 'Nonce: ') ?? ''
  const issuedText = value(9, 'Issued At: ')
  const expiryText = value(10, 'Expiration Time: ')
  const issuedAt = epochOf(issuedText)
  const expiresAt = epochOf(expiryText)

  // The server's values first, so a mismatch in the rebuilt text names the right line.
  if (!NONCE.test(nonce))
    throw new SignInMessageMismatch(
      'nonce (line 9)',
      'Nonce: <32 lower-case hex characters>',
      lines[8] ?? ''
    )
  if (issuedAt === undefined)
    throw new SignInMessageMismatch(
      'issue time (line 10)',
      'Issued At: <YYYY-MM-DDTHH:MM:SSZ>',
      lines[9] ?? ''
    )
  if (expiresAt === undefined)
    throw new SignInMessageMismatch(
      'expiration time (line 11)',
      'Expiration Time: <YYYY-MM-DDTHH:MM:SSZ>',
      lines[10] ?? ''
    )

  const rebuilt = buildSignInMessage({
    ...expected,
    nonce,
    issuedAt,
    expiresAt
  })
  if (rebuilt !== message) {
    const want = rebuilt.split('\n')
    const names = [
      'domain line (line 1)',
      'address (line 2)',
      'blank line 3',
      'statement (line 4)',
      'blank line 5',
      'URI (line 6)',
      'version (line 7)',
      'chain id (line 8)'
    ]
    const count = Math.max(want.length, lines.length)
    for (let i = 0; i < count; i++)
      if (want[i] !== lines[i])
        throw new SignInMessageMismatch(
          names[i] ??
            (i < want.length
              ? `resource line ${i + 1}`
              : `extra line ${i + 1}`),
          want[i] ?? '(no line)',
          lines[i] ?? '(no line)'
        )
    throw new SignInMessageMismatch('text', rebuilt, message)
  }

  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > CHALLENGE_VALIDITY_SECONDS
  )
    throw new SignInMessageMismatch(
      'validity',
      `at most ${CHALLENGE_VALIDITY_SECONDS} s after the issue time`,
      `${issuedText} to ${expiryText}`
    )
  if (expiresAt <= options.nowSeconds)
    throw new SignInMessageMismatch(
      'expiration time',
      `later than now (${instantText(Math.floor(options.nowSeconds))})`,
      expiryText ?? ''
    )
  if (
    options.expiresAt !== undefined &&
    epochOf(options.expiresAt) !== expiresAt
  )
    throw new SignInMessageMismatch(
      "challenge's expiresAt",
      expiryText ?? '',
      String(options.expiresAt)
    )

  return { nonce, issuedAt, expiresAt }
}
