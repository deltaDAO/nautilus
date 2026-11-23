import { inspect } from 'node:util'
import { Wallet } from 'ethers'
import { EmbeddedJWK, jwtVerify } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WalletApi2CredentialProvider } from '../../src/identity/WalletApi2Provider.js'
import { checkSignInMessage } from '../../src/identity/waltid/addressMessage.js'
import { AddressSignIn } from '../../src/identity/waltid/addressSignIn.js'
import {
  assertLegacyNonce,
  WaltIdWalletError
} from '../../src/identity/waltid/client.js'
import { WalletApi2HttpClient } from '../../src/identity/waltid/wallet2.js'
import { maskAddressTokens } from '../../src/log/credentials.js'
import { sanitize } from '../../src/node/messages.js'
import { WalletApi2VcSigner } from '../../src/signing/walletApi2.js'
import { getAssetFixture } from '../fixtures/Asset.js'
import {
  ADDRESS,
  b64url,
  type Call,
  challenge,
  fakeProvider,
  GATEWAY,
  ISSUER,
  json,
  KEY,
  kotlinMessage,
  mockGateway,
  paths,
  preparation,
  refusal,
  signer,
  VERIFIER_HOST,
  withSignIn
} from '../mocks/addressGateway.js'

afterEach(() => {
  vi.useRealTimers()
})

function signInWith(
  gateway: ReturnType<typeof mockGateway>,
  extra: Partial<ConstructorParameters<typeof AddressSignIn>[0]> = {}
) {
  const { wallet, signMessage } = signer()
  const signIn = new AddressSignIn({
    gateway: GATEWAY,
    signer: wallet,
    fetchImpl: gateway.fetchImpl as unknown as typeof fetch,
    ...extra
  })
  const client = new WalletApi2HttpClient({
    apiUrl: GATEWAY,
    token: signIn,
    fetchImpl: gateway.fetchImpl as unknown as typeof fetch
  })
  return { signIn, client, signMessage }
}

const jtiOf = async (call: Call) =>
  (await jwtVerify(call.headers.get('dpop') as string, EmbeddedJWK)).payload.jti

describe('401 handling (B1)', () => {
  it('dpop_invalid: retries once with a fresh proof on the same token, no new sign-in', async () => {
    const gateway = mockGateway({
      handle: (call, count) =>
        call.path.endsWith('/submit-handle') && count === 1
          ? refusal('dpop_invalid')
          : undefined
    })
    const { client, signMessage } = signInWith(gateway)
    await client.submitPresentation('w-address', {
      handle: 'h',
      selectedCredentialOptions: []
    })
    const submits = gateway.calls.filter((c) =>
      c.path.endsWith('/submit-handle')
    )
    expect(submits).to.have.length(2)
    expect(submits[0].body).to.equal(submits[1].body)
    expect(submits[0].headers.get('authorization')).to.equal(
      submits[1].headers.get('authorization')
    )
    expect(await jtiOf(submits[0])).not.to.equal(await jtiOf(submits[1]))
    expect(signMessage).toHaveBeenCalledTimes(1)
  })

  it('token_expired on keys/sign: signs in again and sends the body at most twice', async () => {
    const gateway = mockGateway({
      scopes: ['present', 'sign-ddo'],
      handle: (call) =>
        call.path.endsWith('/sign') ? refusal('token_expired') : undefined
    })
    const { client } = signInWith(gateway, { scopes: ['present', 'sign-ddo'] })
    const thrown = await client
      .signDdo('w-address', 'key-1', { a: 1 })
      .catch((e) => e)
    expect(thrown.code).to.equal('token_expired')
    const signs = gateway.calls.filter((c) => c.path.endsWith('/sign'))
    expect(signs).to.have.length(2)
    expect(await jtiOf(signs[0])).not.to.equal(await jtiOf(signs[1]))
    expect(signs[0].headers.get('authorization')).not.to.equal(
      signs[1].headers.get('authorization')
    )
  })

  it('retries invalid_token named only by WWW-Authenticate', async () => {
    const gateway = mockGateway({
      handle: (call, count) =>
        call.path === 'auth/account' && count === 1
          ? refusal('session_gone', 401, {
              'www-authenticate': 'DPoP error="invalid_token", algs="ES256"'
            })
          : undefined
    })
    const { signIn } = signInWith(gateway)
    await signIn.check()
    expect(paths(gateway).filter((p) => p === 'auth/account')).to.have.length(2)
  })

  it('does not retry any other 401', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path.endsWith('/reject-handle')
          ? refusal('hanko_token_not_accepted')
          : undefined
    })
    const { client } = signInWith(gateway)
    const thrown = await client
      .rejectPresentation('w-address', { handle: 'h' })
      .catch((e) => e)
    expect(thrown.code).to.equal('hanko_token_not_accepted')
    expect(
      paths(gateway).filter((p) => p.endsWith('/reject-handle'))
    ).to.have.length(1)
  })

  it('reports wrong_endpoint before any retry', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path === 'auth/account'
          ? new Response('Unauthorized', { status: 401 })
          : undefined
    })
    const { signIn } = signInWith(gateway)
    const thrown = await signIn.check().catch((e) => e)
    expect(thrown.code).to.equal('wrong_endpoint')
    expect(paths(gateway).filter((p) => p === 'auth/account')).to.have.length(1)
    expect(
      paths(gateway).filter((p) => p === 'auth/address/token')
    ).to.have.length(1)
  })

  it('revokes a token a renewal replaced', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'))
    const gateway = mockGateway()
    const { signIn } = signInWith(gateway)
    const first = await signIn.getToken()
    vi.setSystemTime(new Date('2026-11-23T10:59:30Z'))
    const second = await signIn.getToken()
    expect(second).not.to.equal(first)
    await vi.waitFor(() => expect(gateway.revoked).to.deep.equal([first]))
  })
})

describe('pre-flight cache (B2)', () => {
  it('re-checks after a new sign-in, and after a failure', async () => {
    let verifiers: unknown[] = []
    const gateway = mockGateway({
      handle: (call) =>
        call.path === 'auth/account'
          ? json(200, {
              method: 'evm-address',
              address: ADDRESS.toLowerCase(),
              walletId: 'w-address',
              scopes: ['present'],
              verifiers,
              presentableCredentials: [
                { id: 'c', type: [], format: 'jwt_vc_json', store: 'org' }
              ]
            })
          : undefined
    })
    const { credentials } = withSignIn(gateway)
    const thrown = await credentials.prepare(preparation()).catch((e) => e)
    expect(thrown.details.code).to.equal('verifier_not_allowed')

    // The admin adds the verifier: the next prepare() sees it, without a restart
    verifiers = [
      { clientId: 'c', responseUriOrigin: `https://${VERIFIER_HOST}` }
    ]
    await credentials.prepare(preparation())
    await credentials.prepare(preparation())
    expect(paths(gateway).filter((p) => p === 'auth/account')).to.have.length(2)

    // A new sign-in (another token) checks again
    credentials.signIn.invalidate()
    await credentials.prepare(preparation())
    expect(paths(gateway).filter((p) => p === 'auth/account')).to.have.length(3)
  })
})

describe('error bodies (B3, S9)', () => {
  it('keeps wallet-api2 404s like "Key not found" as they are, with a hint', async () => {
    const gateway = mockGateway({
      scopes: ['present', 'sign-ddo'],
      handle: (call) =>
        call.path.endsWith('/sign')
          ? json(404, { error: 'Key not found' })
          : undefined
    })
    const { client } = signInWith(gateway, { scopes: ['present', 'sign-ddo'] })
    const thrown = await client
      .signDdo('w-address', 'key-x', { a: 1 })
      .catch((e) => e)
    expect(thrown.code).to.equal(undefined)
    expect(thrown.status).to.equal(404)
    expect(thrown.message).to.contain('Key not found')
    expect(thrown.hint).to.match(/walletId and keyId/)
  })

  it('a 404 that is not JSON is wrong_endpoint', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path.endsWith('/reject-handle')
          ? new Response('<html>404</html>', { status: 404 })
          : undefined
    })
    const { client } = signInWith(gateway)
    const thrown = await client
      .rejectPresentation('w-address', { handle: 'h' })
      .catch((e) => e)
    expect(thrown.code).to.equal('wrong_endpoint')
  })

  it.each([undefined, 'w'])(
    'keeps the Hanko gateway refusal with walletId %s',
    async (walletId) => {
      const fetchImpl = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          expect(new Headers(init?.headers).get('authorization')).to.equal(
            'Bearer hanko-jwt'
          )
          return refusal('hanko_token_not_accepted')
        }
      )
      const provider = new WalletApi2CredentialProvider({
        walletId,
        wallet: new WalletApi2HttpClient({
          apiUrl: GATEWAY,
          token: 'hanko-jwt',
          fetchImpl
        })
      })
      const thrown = await provider.present(challenge()).catch((e) => e)
      expect(thrown.reason).to.equal('sign-in')
      expect(thrown.details.code).to.equal('hanko_token_not_accepted')
      expect(thrown.details.hint).to.equal(
        'Developer or admin: fix hanko_token_not_accepted.'
      )
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  )

  it('a Hanko 401/403 with a coded body stays wallet-setup', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () =>
        json(status, {
          error: 'token_invalid',
          message: 'Please log in.',
          hint: 'Log in.'
        })
      )
      const thrown = await new WalletApi2CredentialProvider({
        walletApi: 'https://wallet-api.test.invalid',
        token: 'hanko-jwt',
        walletId: 'w',
        wallet: new WalletApi2HttpClient({
          apiUrl: 'https://wallet-api.test.invalid',
          token: 'hanko-jwt',
          fetchImpl: fetchImpl as unknown as typeof fetch
        })
      })
        .present(challenge())
        .catch((e) => e)
      expect(thrown.reason).to.equal('wallet-setup')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })
})

describe('redaction keeps prose (B4)', () => {
  it('keeps the words after DPoP and redacts credentials', () => {
    const token = `pxa_${'a'.repeat(43)}`
    expect(sanitize('The DPoP proof is invalid (htu).', 500, null)).to.equal(
      'The DPoP proof is invalid (htu).'
    )
    for (const text of [
      `Authorization: DPoP ${token}`,
      'Authorization: Bearer abc.def',
      'Authorization: Basic dXNlcjpwYXNz',
      `DPoP ${'A'.repeat(25)}`
    ])
      expect(sanitize(text, 500, null)).to.contain('<redacted>')
    expect(maskAddressTokens('The DPoP proof is invalid')).to.equal(
      'The DPoP proof is invalid'
    )
    expect(maskAddressTokens(`DPoP ${token}`)).not.to.contain('pxa_')
  })
})

describe('legacy nonce guard (S1)', () => {
  const b64 = (value: unknown) => b64url(JSON.stringify(value))

  it('refuses JWS signing inputs, Eip191VcSigner in particular', () => {
    const payload = b64({ id: 'did:ope:x', type: ['VerifiableCredential'] })
    for (const input of [
      `${b64({ alg: 'ETH-EIP191', typ: 'JWT' })}.${payload}`,
      `${b64({ alg: 'ETH-EIP191' })}.${payload}`,
      `${b64({ alg: 'ES256' })}.${payload}`,
      `${b64({ typ: 'JWT' })}.${payload}`,
      `${b64(['x'])}.${payload}`,
      `${b64({ alg: 'ES256' })}.${payload}.sig.extra`,
      `${b64({ alg: 'ETH-EIP191', typ: 'JWT' })}.${payload}.c2ln`
    ])
      expect(() => assertLegacyNonce(input), input).to.throw(
        /JWS signing input/
      )
  })

  it('keeps accepting real nonces, trimmed', () => {
    const hex = `Sign in: 0x${'ab'.repeat(32)}`
    expect(assertLegacyNonce(`${hex}\n`)).to.equal(hex)
    expect(
      assertLegacyNonce('  15c72cd0-8c84-45dc-aae2-a310f6075a8f \r\n')
    ).to.equal('15c72cd0-8c84-45dc-aae2-a310f6075a8f')
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ nonce: '1' })}.c2ln`
    expect(assertLegacyNonce(jwt)).to.equal(jwt)
  })
})

describe('message checks (S2)', () => {
  const fields = {
    gateway: GATEWAY,
    address: ADDRESS,
    chainId: 32456,
    jkt: 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs',
    scopes: ['present', 'sign-ddo']
  }
  const now = 1795428100
  const good = kotlinMessage({
    a: ADDRESS,
    c: 32456,
    j: fields.jkt,
    s: ['present', 'sign-ddo'],
    n: '9f2c4e6a8b0d1f3e5a7c9e1b3d5f7a9c',
    i: 1795428000,
    e: 1795428300
  })
  const refused =
    (message: string, nowSeconds = now) =>
    () =>
      checkSignInMessage(message, fields, { nowSeconds })

  it('accepts the message as built', () => {
    expect(refused(good)).not.to.throw()
  })

  it('refuses an Issued At in the future, or long past', () => {
    expect(refused(good, 1795428000 - 61)).to.throw(/issue time/)
    expect(refused(good, 1795428000 - 59)).not.to.throw()
  })

  it('refuses CRLF, duplicated or reordered resources, a homoglyph domain and an impossible date', () => {
    const lines = good.split('\n')
    const cases = [
      good.replace(/\n/g, '\r\n'),
      `${good}\n${lines.at(-1)}`,
      [...lines.slice(0, 12), lines[13], lines[12], lines[14]].join('\n'),
      good.replace(
        'wallet.test.invalid wants',
        'w\u0430llet.test.invalid wants'
      ),
      good
        .replace(
          'Issued At: 2026-11-23T10:00:00Z',
          'Issued At: 2026-02-30T10:00:00Z'
        )
        .replace(
          'Expiration Time: 2026-11-23T10:05:00Z',
          'Expiration Time: 2026-02-30T10:05:00Z'
        )
    ]
    for (const message of cases) expect(refused(message)).to.throw()
  })

  it('escapes line separators and bidi controls in the error', () => {
    const thrown = (() => {
      try {
        checkSignInMessage(
          good.replace('Version: 1', 'Version: 1\u2028\u202eevil'),
          fields,
          { nowSeconds: now }
        )
      } catch (error) {
        return error as Error
      }
    })()
    expect(thrown?.message).to.contain('\\u2028\\u202e')
    expect(thrown?.message).not.to.match(/[\u2028\u202e]/)
  })
})

describe('WalletApi2VcSigner JWS checks (S3, C9)', () => {
  function vcSigner(answer: (body: string) => string) {
    const gateway = mockGateway({
      scopes: ['present', 'sign-ddo'],
      handle: (call) =>
        call.path.endsWith('/sign')
          ? new Response(answer(call.body), { status: 200 })
          : undefined
    })
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY, fakeProvider()),
      scopes: ['present', 'sign-ddo'],
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const s = new WalletApi2VcSigner({
      signIn,
      keyId: 'key-1',
      issuer: ISSUER,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const ddo = {
      ...s.prepareDocument(
        getAssetFixture() as unknown as Record<string, unknown>
      ),
      issuer: ISSUER
    }
    return { s, ddo }
  }
  const header = (value: unknown) => b64url(JSON.stringify(value))

  const cases: [string, (body: string) => string, RegExp][] = [
    [
      'alg none',
      (b) => `${header({ alg: 'none', kid: `${ISSUER}#k` })}.${b64url(b)}.c2ln`,
      /algorithm none/
    ],
    [
      'HS256',
      (b) =>
        `${header({ alg: 'HS256', kid: `${ISSUER}#k` })}.${b64url(b)}.c2ln`,
      /algorithm HS256/
    ],
    [
      'crit',
      (b) =>
        `${header({ alg: 'ES256', kid: `${ISSUER}#k`, crit: ['b64'], b64: false })}.${b64url(b)}.c2ln`,
      /other than alg, kid and typ/
    ],
    [
      'b64',
      (b) =>
        `${header({ alg: 'ES256', kid: `${ISSUER}#k`, b64: false })}.${b64url(b)}.c2ln`,
      /other than alg, kid and typ/
    ],
    [
      'a duplicate payload key',
      (b) =>
        `${header({ alg: 'ES256', kid: `${ISSUER}#k` })}.${b64url(b.replace(/^\{/, '{"id":"did:ope:evil",'))}.c2ln`,
      /duplicate key/
    ],
    [
      'a duplicate header key',
      () =>
        `${b64url('{"alg":"ES256","alg":"none","kid":"x"}')}.${b64url('{}')}.c2ln`,
      /duplicate key/
    ]
  ]
  for (const [name, answer, expected] of cases)
    it(`refuses ${name}`, async () => {
      const { s, ddo } = vcSigner(answer)
      const thrown = await s.sign(ddo).catch((e) => e)
      expect(thrown).to.be.instanceOf(WaltIdWalletError)
      expect(thrown.code).to.equal('signature_invalid')
      expect(thrown.message).to.match(expected)
      expect(thrown.hint).to.be.a('string')
    })

  it('escapes control characters of a foreign kid', async () => {
    const { s, ddo } = vcSigner(
      (b) =>
        `${header({ alg: 'ES256', kid: 'did:web:evil\u001b[2J\u202e#k' })}.${b64url(b)}.c2ln`
    )
    const thrown = await s.sign(ddo).catch((e) => e)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the point of the test
    expect(thrown.message).not.to.match(/[\u001b\u202e]/)
    expect(thrown.message).to.contain('\\u001b')
    expect(thrown.hint).to.match(/keyId/)
  })

  it('names the issuer mismatch with a code and who fixes it', async () => {
    const { s, ddo } = vcSigner(() => '')
    const thrown = await s
      .sign({ ...ddo, issuer: 'did:web:other.test' })
      .catch((e) => e)
    expect(thrown.code).to.equal('issuer_mismatch')
    expect(thrown.hint).to.match(/Developer/)
  })
})

describe('server text in errors (S4)', () => {
  it('sanitizes the address and origins of the pre-flight', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path === 'auth/account'
          ? json(200, {
              method: 'evm-address',
              address: '0xabc\u202e\u001b[31m',
              walletId: 'w-address',
              scopes: ['present'],
              verifiers: [
                {
                  clientId: 'c',
                  responseUriOrigin: 'https://other.test\u2028x'
                }
              ],
              presentableCredentials: []
            })
          : undefined
    })
    const thrown = await withSignIn(gateway)
      .credentials.prepare(preparation())
      .catch((e) => e)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the point of the test
    expect(thrown.message).not.to.match(/[\u001b\u202e\u2028]/)
  })
})

describe('gateway URL (S5)', () => {
  const wallet = new Wallet(KEY)
  for (const gateway of [
    'https://wallet.test.invalid/api/address-gateway\u0000',
    'https://wallet.test.invalid/api\\address-gateway',
    'https://user:pw@wallet.test.invalid/api/address-gateway',
    'https://wallet.test.invalid:/api/address-gateway',
    'https://Wallet.Test.Invalid/api/address-gateway',
    'https://wallet.test.invalid:443/api/address-gateway',
    'https://wallet.test.invalid/api/../api/address-gateway',
    'https://wallet.test.invalid/api/address%2Dgateway',
    'https://wallet.test.invalid/api/address gateway'
  ])
    it(`refuses ${JSON.stringify(gateway)}`, () => {
      expect(() => new AddressSignIn({ gateway, signer: wallet })).to.throw(
        WaltIdWalletError
      )
    })

  it('accepts the URL as a parser reads it, with or without a trailing slash', () => {
    for (const gateway of [
      GATEWAY,
      `${GATEWAY}/`,
      'https://wallet.test.invalid:8443/api/address-gateway',
      'http://localhost:3000/api/address-gateway'
    ])
      expect(new AddressSignIn({ gateway, signer: wallet }).gateway).to.equal(
        gateway.replace(/\/$/, '')
      )
  })
})

describe('the session stays private (S6) and signOut (S7)', () => {
  it('shows no token in console.log, util.inspect or JSON', async () => {
    const gateway = mockGateway()
    const { credentials } = withSignIn(gateway)
    const { signIn } = credentials
    await credentials.prepare(preparation())
    const token = await signIn.getToken()
    for (const text of [
      inspect(credentials, { depth: 10 }),
      JSON.stringify(credentials),
      inspect(signIn, { depth: 10, showHidden: true }),
      JSON.stringify(signIn),
      String(signIn)
    ])
      expect(text).not.to.contain(token)
    expect(inspect(signIn)).to.contain('AddressSignIn')
    expect(Object.keys(signIn)).not.to.include('session')
  })

  it('signOut() during a sign-in waits for it and revokes the new token', async () => {
    const gateway = mockGateway()
    const { signIn } = signInWith(gateway)
    const pending = signIn.getToken()
    await signIn.signOut()
    const token = await pending
    expect(gateway.revoked).to.deep.equal([token])
  })
})

describe('verifier comparison (S8)', () => {
  function account(origin: string) {
    return mockGateway({
      handle: (call) =>
        call.path === 'auth/account'
          ? json(200, {
              method: 'evm-address',
              address: ADDRESS.toLowerCase(),
              walletId: 'w-address',
              scopes: ['present'],
              verifiers: [{ clientId: 'c', responseUriOrigin: origin }],
              presentableCredentials: [
                { id: 'c', type: [], format: 'jwt_vc_json', store: 'org' }
              ]
            })
          : undefined
    })
  }

  it('normalises case and default ports', async () => {
    await withSignIn(
      account('https://Verifier.Test.Invalid:443')
    ).credentials.prepare(preparation(ADDRESS, 'VERIFIER.test.invalid'))
    await withSignIn(
      account('https://verifier.test.invalid:8443')
    ).credentials.prepare(preparation(ADDRESS, 'verifier.test.invalid:8443'))
    const thrown = await withSignIn(
      account('https://verifier.test.invalid:8443')
    )
      .credentials.prepare(preparation(ADDRESS, 'verifier.test.invalid'))
      .catch((e) => e)
    expect(thrown.details.code).to.equal('verifier_not_allowed')
  })

  it('checks both the announced and the expected verifier', async () => {
    const thrown = await withSignIn(account(`https://${VERIFIER_HOST}`), {
      expectedVerifierHost: 'other.test.invalid'
    })
      .credentials.prepare(preparation())
      .catch((e) => e)
    expect(thrown.details.code).to.equal('verifier_not_allowed')
    expect(thrown.message).to.contain('other.test.invalid')
  })
})

describe('contract details (C1, C2, C4, C5)', () => {
  it('a pinned walletId of another wallet is not-permitted wallet_mismatch', async () => {
    const thrown = await withSignIn(mockGateway(), { walletId: 'w-other' })
      .credentials.prepare(preparation())
      .catch((e) => e)
    expect(thrown.reason).to.equal('not-permitted')
    expect(thrown.details.code).to.equal('wallet_mismatch')
  })

  it('sends gateway segment characters as they are, so htu matches, and refuses others', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path.endsWith('/reject-handle')
          ? new Response(null, { status: 200 })
          : undefined
    })
    const { client } = signInWith(gateway)
    await client.rejectPresentation('w:1@a+b', { handle: 'h' })
    expect(gateway.problems).to.deep.equal([])
    expect(paths(gateway).at(-1)).to.equal(
      'wallet/w:1@a+b/credentials/present/reject-handle'
    )
    const thrown = await client
      .rejectPresentation('w 1', { handle: 'h' })
      .catch((e) => e)
    expect(thrown.message).to.match(/accepts only letters, digits/)
  })

  it('a signer without a provider is a sign-in failure with a clear message', async () => {
    const gateway = mockGateway()
    const credentials = WalletApi2CredentialProvider.withAddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY),
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const thrown = await credentials.prepare(preparation()).catch((e) => e)
    expect(thrown.reason).to.equal('sign-in')
    expect(thrown.details.code).to.equal('signer_without_provider')
    expect(thrown.message).to.match(/pass chainId/)
    const smart = await new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY),
      chainId: 1,
      smartAccount: true
    })
      .getToken()
      .catch((e) => e)
    expect(smart.code).to.equal('signer_without_provider')
  })

  it('honours the caller AbortSignal and the overall sign-in timeout', async () => {
    const gateway = mockGateway()
    const { wallet: abortWallet } = signer()
    const readAddress = vi.spyOn(abortWallet, 'getAddress')
    const { signIn } = signInWith(gateway, { signer: abortWallet })
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    expect(
      (await signIn.getToken(controller.signal).catch((e) => e)).message
    ).to.equal('stop')
    expect(readAddress).not.toHaveBeenCalled()
    await signIn.getToken()
    await expect(signIn.getToken(controller.signal)).rejects.toThrow('stop')

    const { wallet } = signer()
    vi.spyOn(wallet, 'signMessage').mockImplementation(
      () => new Promise(() => undefined)
    )
    const slow = new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      signInTimeoutMs: 50,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const thrown = await slow.getToken().catch((e) => e)
    expect(thrown.code).to.equal('sign_in_timeout')
  })

  it('backs off while renewals fail in the last minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'))
    let down = false
    const gateway = mockGateway({
      handle: (call) =>
        down && call.path === 'auth/address/challenge'
          ? refusal('unavailable')
          : undefined
    })
    const { signIn } = signInWith(gateway)
    const token = await signIn.getToken()
    down = true
    vi.setSystemTime(new Date('2026-11-23T10:59:10Z'))
    for (let i = 0; i < 5; i++) expect(await signIn.getToken()).to.equal(token)
    expect(
      paths(gateway).filter((p) => p === 'auth/address/challenge')
    ).to.have.length(2)
    vi.setSystemTime(new Date('2026-11-23T10:59:16Z'))
    await signIn.getToken()
    expect(
      paths(gateway).filter((p) => p === 'auth/address/challenge')
    ).to.have.length(3)
  })
})

describe('gateway answers nautilus does not trust', () => {
  it('a redirect on challenge, token or a token route: nothing signed or sent onward', async () => {
    for (const target of [
      'auth/address/challenge',
      'auth/address/token',
      'auth/account'
    ]) {
      const gateway = mockGateway({
        handle: (call) =>
          call.path === target
            ? new Response(null, {
                status: 302,
                headers: { location: 'https://evil.test/collect' }
              })
            : undefined
      })
      const { signIn, signMessage } = signInWith(gateway)
      const thrown = await signIn.check().catch((e) => e)
      expect(thrown, target).to.be.instanceOf(WaltIdWalletError)
      expect(gateway.calls.every((c) => !c.path.includes('evil'))).to.equal(
        true
      )
      if (target === 'auth/address/challenge')
        expect(signMessage).not.toHaveBeenCalled()
    }
  })

  const answers: [string, Record<string, unknown>][] = [
    ['no address', { address: undefined }],
    ['tokenType Bearer', { tokenType: 'Bearer' }],
    ['no tokenType', { tokenType: undefined }],
    ['an absurd expiresIn', { expiresIn: 10 ** 9 }],
    ['a fractional expiresIn', { expiresIn: 1.5 }],
    ['a walletId with a slash', { walletId: 'w/../x' }]
  ]
  for (const [name, change] of answers)
    it(`refuses a token answer with ${name}`, async () => {
      const gateway = mockGateway({
        handle: (call) =>
          call.path === 'auth/address/token'
            ? json(200, {
                accessToken: `pxa_${'a'.repeat(43)}`,
                tokenType: 'DPoP',
                tokenId: 'tk_1',
                expiresIn: 3600,
                scopes: ['present'],
                address: ADDRESS.toLowerCase(),
                organizationId: 'o',
                walletId: 'w-address',
                ...change
              })
            : undefined
      })
      const thrown = await signInWith(gateway)
        .signIn.getToken()
        .catch((e) => e)
      expect(thrown.code).to.equal('wrong_endpoint')
    })

  it("the gateway's own dpop_invalid at the token endpoint (no proof)", async () => {
    const gateway = mockGateway()
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      headers.delete('dpop')
      return gateway.fetchImpl(input, { ...init, headers })
    })
    const thrown = await new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY, fakeProvider()),
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
      .getToken()
      .catch((e) => e)
    expect(thrown.code).to.equal('dpop_invalid')
    expect(thrown.status).to.equal(401)
  })

  it('not_found from the gateway names the route, the switch and the version', async () => {
    const gateway = mockGateway()
    const { client } = signInWith(gateway)
    const thrown = await client.listWallets().catch((e) => e)
    expect(thrown.code).to.equal('not_found')
    expect(thrown.hint).to.match(/does not serve the route/)
  })
})
