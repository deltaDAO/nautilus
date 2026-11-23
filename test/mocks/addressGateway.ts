/**
 * A mock of the wallet UI's address gateway in front of wallet-api2, for the address
 * sign-in tests: the challenge (with the EIP-4361 message written out as wallet-api2's
 * `AddressChallenges.message` builds it), the token (checking the EIP-191 signature and the
 * DPoP proof), and the routes an address token may call, checking every DPoP proof with
 * jose as wallet-api2's `DpopVerifier` does. Refusals are `{ error, message, hint }` with
 * the status `AddressSignInCodes.status` gives them.
 */
import { createHash, randomBytes } from 'node:crypto'
import { getAddress, type Provider, verifyMessage, Wallet } from 'ethers'
import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  EmbeddedJWK,
  type JWK,
  jwtVerify
} from 'jose'
import { expect, vi } from 'vitest'
import type { CredentialChallenge } from '../../src/identity/CredentialProvider.js'
import { WalletApi2CredentialProvider } from '../../src/identity/WalletApi2Provider.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { getAssetFixture } from '../fixtures/Asset.js'

export const GATEWAY = 'https://wallet.test.invalid/api/address-gateway'
export const DOMAIN = 'wallet.test.invalid'
/** anvil account 1: a well-known test key, holds nothing. */
export const KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
export const ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
export const CHAIN = 32456
export const NODE = 'https://node.test.invalid'
export const VERIFIER_HOST = 'verifier.test.invalid'
export const SESSION = 'a1b2c3d4e5f6a7b8c9d0'
export const REQUEST_URI = `openid4vp://authorize?client_id=x509_san_dns%3A${VERIFIER_HOST}&request_uri=${encodeURIComponent(`https://${VERIFIER_HOST}/verification-session/${SESSION}/request`)}`
export const ISSUER = 'did:web:org.test'

/** A provider that knows its chain and has no code at any address. */
export function fakeProvider(code = '0x'): Provider {
  return {
    getNetwork: async () => ({ chainId: BigInt(CHAIN) }),
    getCode: vi.fn(async () => code)
  } as unknown as Provider
}

export function signer(provider: Provider | null = fakeProvider()) {
  const wallet = new Wallet(KEY, provider)
  const signMessage = vi.spyOn(wallet, 'signMessage')
  return { wallet, signMessage }
}

export const b64url = (data: string | Buffer) =>
  Buffer.from(data).toString('base64url')
export const sha256url = (text: string) =>
  createHash('sha256').update(text).digest('base64url')

/**
 * The EIP-4361 message as wallet-api2's `AddressChallenges.message` builds it, written out
 * here a second time so the mock gateway does not use the code under test.
 */
export function kotlinMessage(p: {
  a: string
  c: number
  j: string
  s: string[]
  n: string
  i: number
  e: number
}): string {
  const instant = (s: number) =>
    new Date(s * 1000).toISOString().replace('.000Z', 'Z')
  let m = `${DOMAIN} wants you to sign in with your Ethereum account:\n`
  m += `${getAddress(p.a)}\n\n`
  m += `Sign in to the Pontus-X SSI wallet of this address for up to 4 hours, to present credentials to data services${p.s.includes('sign-ddo') ? ' and to sign asset descriptions (DDOs) for publishing' : ''}. This signature cannot move funds or send transactions.\n\n`
  m += `URI: ${GATEWAY}\nVersion: 1\nChain ID: ${p.c}\nNonce: ${p.n}\n`
  m += `Issued At: ${instant(p.i)}\nExpiration Time: ${instant(p.e)}\nResources:`
  for (const s of p.s) m += `\n- urn:pontusx:wallet2:scope:${s}`
  m += `\n- urn:ietf:params:oauth:jwk-thumbprint:sha-256:${p.j}`
  return m
}

export const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })

/** wallet-api2's `{ error, message, hint }` with the status `AddressSignInCodes.status` gives. */
export function refusal(code: string, status = codeStatus(code)) {
  return json(status, {
    error: code,
    message: `refused: ${code}`,
    hint: `Developer or admin: fix ${code}.`
  })
}

export function codeStatus(code: string): number {
  if (
    [
      'invalid_request',
      'chain_not_supported',
      'challenge_invalid',
      'challenge_expired',
      'message_mismatch',
      'not_a_ddo',
      'holder_changed'
    ].includes(code)
  )
    return 400
  if (
    [
      'dpop_invalid',
      'sign_in_failed',
      'token_invalid',
      'token_expired',
      'hanko_token_not_accepted'
    ].includes(code)
  )
    return 401
  if (code === 'nonce_used') return 409
  if (
    ['too_many_sessions', 'rate_limited', 'capacity_exhausted'].includes(code)
  )
    return 429
  if (code === 'handle_evicted') return 410
  if (code === 'handle_expired' || code === 'not_found') return 404
  if (code === 'unavailable') return 503
  return 403
}

export interface Call {
  path: string
  method: string
  headers: Headers
  body: string
}

export interface GatewayOptions {
  /** Rewrites the challenge's message (a malicious or misconfigured server). */
  message?: (message: string) => string
  /** Answers a call before the default handling (after the DPoP check of token calls). */
  handle?: (call: Call, count: number) => Response | undefined
  expiresIn?: number
  scopes?: string[]
}

/**
 * A mock of the wallet UI's address gateway in front of wallet-api2: challenge, token, and
 * the token routes, checking every DPoP proof with jose as `DpopVerifier` does.
 */
export function mockGateway(options: GatewayOptions = {}) {
  const calls: Call[] = []
  const tokens = new Map<string, string>()
  const proofs: string[] = []
  const signatures: string[] = []
  const jtis = new Set<string>()
  const problems: string[] = []
  const challenges = new Map<string, { jkt: string; message: string }>()
  const counts = new Map<string, number>()

  async function checkProof(
    proof: string | null,
    method: string,
    htu: string,
    token: string | undefined,
    jkt: string
  ): Promise<string | undefined> {
    if (!proof) return 'no proof'
    proofs.push(proof)
    const header = decodeProtectedHeader(proof)
    if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256') return 'header'
    const jwk = header.jwk as JWK
    if (jwk?.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk) return 'jwk'
    const { payload } = await jwtVerify(proof, EmbeddedJWK, {
      typ: 'dpop+jwt',
      algorithms: ['ES256']
    })
    if (payload.htm !== method) return 'htm'
    if (payload.htu !== htu) return `htu ${String(payload.htu)}`
    const iat = payload.iat ?? 0
    if (Math.abs(iat - Date.now() / 1000) > 60) return 'iat'
    const jti = payload.jti
    if (typeof jti !== 'string' || !jti || jti.length > 64) return 'jti'
    if (jtis.has(jti)) return 'jti replayed'
    jtis.add(jti)
    if (token !== undefined && payload.ath !== sha256url(token)) return 'ath'
    if (token === undefined && payload.ath !== undefined)
      return 'ath at sign-in'
    if ((await calculateJwkThumbprint(jwk, 'sha256')) !== jkt) return 'jkt'
    return undefined
  }

  const fetchImpl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      expect(url.startsWith(`${GATEWAY}/`)).to.equal(true)
      const path = url.slice(GATEWAY.length + 1)
      const call: Call = {
        path,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? init.body : ''
      }
      calls.push(call)
      const count = (counts.get(path) ?? 0) + 1
      counts.set(path, count)

      if (path === 'auth/address/challenge') {
        const early = options.handle?.(call, count)
        if (early) return early
        const body = JSON.parse(call.body)
        const now = Math.floor(Date.now() / 1000)
        const payload = {
          a: String(body.address).toLowerCase(),
          c: body.chainId,
          j: body.jkt,
          s: body.scopes,
          n: randomBytes(16).toString('hex'),
          i: now,
          e: now + 300
        }
        const message = kotlinMessage(payload)
        const challenge = `v1.${b64url(JSON.stringify(payload))}.mac`
        challenges.set(challenge, { jkt: body.jkt, message })
        return json(200, {
          message: options.message ? options.message(message) : message,
          challenge,
          expiresAt: new Date(payload.e * 1000)
            .toISOString()
            .replace('.000Z', 'Z')
        })
      }

      if (path === 'auth/address/token') {
        const body = JSON.parse(call.body)
        const issued = challenges.get(body.challenge)
        if (!issued) return refusal('challenge_invalid')
        if (issued.message !== body.message) return refusal('message_mismatch')
        const problem = await checkProof(
          call.headers.get('dpop'),
          'POST',
          `${GATEWAY}/auth/address/token`,
          undefined,
          issued.jkt
        )
        if (problem) {
          problems.push(problem)
          return refusal('dpop_invalid', 400)
        }
        signatures.push(body.signature)
        if (verifyMessage(body.message, body.signature) !== ADDRESS)
          return refusal('sign_in_failed')
        const early = options.handle?.(call, count)
        if (early) return early
        const token = `pxa_${randomBytes(32).toString('base64url')}`
        tokens.set(token, issued.jkt)
        return json(200, {
          accessToken: token,
          tokenType: 'DPoP',
          tokenId: `tk_${count}`,
          expiresIn: options.expiresIn ?? 3600,
          scopes: options.scopes ?? ['present'],
          address: ADDRESS.toLowerCase(),
          organizationId: 'org-1',
          walletId: 'w-address'
        })
      }

      // Token routes
      const authorization = call.headers.get('authorization') ?? ''
      const token = authorization.replace(/^DPoP /, '')
      const jkt = tokens.get(token)
      if (!authorization.startsWith('DPoP ') || !jkt)
        return refusal('token_invalid')
      const problem = await checkProof(
        call.headers.get('dpop'),
        call.method,
        url,
        token,
        jkt
      )
      if (problem) {
        problems.push(problem)
        return refusal('dpop_invalid')
      }
      const early = options.handle?.(call, count)
      if (early) return early

      if (path === 'auth/account')
        return json(200, {
          method: 'evm-address',
          address: ADDRESS.toLowerCase(),
          organizationId: 'org-1',
          walletId: 'w-address',
          tokenId: 'tk_1',
          expiresAt: '2026-11-23T11:00:00Z',
          scopes: options.scopes ?? ['present'],
          didWebHolder: false,
          ddoSigning: false,
          verifiers: [
            {
              clientId: `x509_san_dns:${VERIFIER_HOST}`,
              responseUriOrigin: `https://${VERIFIER_HOST}`
            }
          ],
          presentableCredentials: [
            {
              id: 'cred-1',
              type: ['VerifiableCredential', 'gx:LegalPerson'],
              format: 'jwt_vc_json',
              store: 'org'
            }
          ]
        })
      if (path.endsWith('/preview-handle'))
        return json(200, {
          handle: `handle-${count}-0123456789`,
          preview: {
            valid: true,
            clientId: `x509_san_dns:${VERIFIER_HOST}`,
            responseUri: `https://${VERIFIER_HOST}/verification-session/${SESSION}/response`,
            transactionData: [],
            credentialOptions: [
              {
                queryId: 'legal_person',
                credentialId: 'cred-1',
                format: 'jwt_vc_json'
              }
            ],
            credentialRequirements: [{ options: [['legal_person']] }],
            holder: { did: 'did:key:z6Mk', keyId: 'k-1' }
          }
        })
      if (path.endsWith('/submit-handle'))
        return json(200, { transmission_success: true })
      if (path.endsWith('/reject-handle'))
        return new Response(null, { status: 200 })
      if (path === 'auth/logout') return new Response(null, { status: 200 })
      if (/^wallet\/[^/]+\/keys\/[^/]+\/sign$/.test(path)) {
        const header = b64url(
          JSON.stringify({ typ: 'JWT', kid: `${ISSUER}#key-1`, alg: 'ES256' })
        )
        return new Response(
          `${header}.${b64url(call.body)}.${b64url('signature')}`,
          {
            status: 200,
            headers: { 'content-type': 'text/plain' }
          }
        )
      }
      return refusal('route_not_allowed')
    }
  )

  return { fetchImpl, calls, proofs, signatures, problems, tokens }
}

export function challenge(
  overrides: Partial<CredentialChallenge> = {}
): CredentialChallenge {
  return {
    protocol: 'oid4vp',
    asset: getAssetFixture(),
    serviceId: 'service-1',
    consumerAddress: ADDRESS,
    node: { nodeUri: NODE } as OceanNodeClient,
    sessionId: SESSION,
    redirectUri: REQUEST_URI,
    dcql: { credentials: [{ id: 'legal_person', format: 'jwt_vc_json' }] },
    verifierHost: VERIFIER_HOST,
    ...overrides
  } as CredentialChallenge
}

export function node(verifierHost = VERIFIER_HOST): OceanNodeClient {
  return {
    nodeUri: NODE,
    getSsiCapabilities: async () => ({
      enabled: true,
      verifierPublicHost: verifierHost
    })
  } as unknown as OceanNodeClient
}

export function preparation(
  consumerAddress = ADDRESS,
  verifierHost = VERIFIER_HOST
) {
  return {
    asset: getAssetFixture(),
    serviceId: 'service-1',
    consumerAddress,
    node: node(verifierHost)
  }
}

export function withSignIn(
  gateway: ReturnType<typeof mockGateway>,
  extra: Record<string, unknown> = {}
) {
  const { wallet, signMessage } = signer()
  const credentials = WalletApi2CredentialProvider.withAddressSignIn({
    gateway: GATEWAY,
    signer: wallet,
    fetchImpl: gateway.fetchImpl as unknown as typeof fetch,
    ...extra
  })
  return { credentials, signMessage }
}

export const paths = (gateway: ReturnType<typeof mockGateway>) =>
  gateway.calls.map((call) => call.path)
