import { Wallet } from 'ethers'
import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  EmbeddedJWK,
  type JWK,
  jwtVerify
} from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WalletApi2CredentialProvider } from '../../src/identity/WalletApi2Provider.js'
import { CredentialPresentationError } from '../../src/identity/WaltIdProvider.js'
import { addressCodeReason } from '../../src/identity/waltid/addressErrors.js'
import {
  buildSignInMessage,
  checkSignInMessage
} from '../../src/identity/waltid/addressMessage.js'
import { AddressSignIn } from '../../src/identity/waltid/addressSignIn.js'
import {
  assertLegacyNonce,
  WaltIdHttpWallet,
  WaltIdWalletError
} from '../../src/identity/waltid/client.js'
import {
  staticTokenSource,
  WalletApi2HttpClient
} from '../../src/identity/waltid/wallet2.js'
import {
  ADDRESS,
  type Call,
  CHAIN,
  challenge,
  codeStatus,
  DOMAIN,
  fakeProvider,
  GATEWAY,
  json,
  KEY,
  kotlinMessage,
  mockGateway,
  paths,
  preparation,
  refusal,
  sha256url,
  signer,
  VERIFIER_HOST,
  withSignIn
} from '../mocks/addressGateway.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('the EIP-4361 sign-in message', () => {
  it("equals wallet-api2's AddressChallenges.message byte for byte (cross-repository fixture)", () => {
    // Derived by hand from AddressChallenges.message() in pontusx-identity
    // (waltid-wallet-api2/.../auth/address/AddressChallenges.kt) for domain
    // "wallet.example.org", uri "https://wallet.example.org/api/address-gateway" and the
    // payload a = 0x70997970c51812dc3a010c7d01b50e0d17dc79c8, c = 32456,
    // j = NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs, s = [present, sign-ddo],
    // n = 9f2c4e6a8b0d1f3e5a7c9e1b3d5f7a9c, i = 1795428000, e = i + 300: lines joined by
    // "\n" (append(...).append('\n')), a blank line after the address and after the
    // statement, Instant.toString() without fractional seconds, "Resources:" followed by
    // "\n- " entries (scopes in canonical order, then the thumbprint), no final line break.
    const fixture =
      'wallet.example.org wants you to sign in with your Ethereum account:\n' +
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8\n' +
      '\n' +
      'Sign in to the Pontus-X SSI wallet of this address for up to 4 hours, to present credentials to data services and to sign asset descriptions (DDOs) for publishing. This signature cannot move funds or send transactions.\n' +
      '\n' +
      'URI: https://wallet.example.org/api/address-gateway\n' +
      'Version: 1\n' +
      'Chain ID: 32456\n' +
      'Nonce: 9f2c4e6a8b0d1f3e5a7c9e1b3d5f7a9c\n' +
      'Issued At: 2026-11-23T10:00:00Z\n' +
      'Expiration Time: 2026-11-23T10:05:00Z\n' +
      'Resources:\n' +
      '- urn:pontusx:wallet2:scope:present\n' +
      '- urn:pontusx:wallet2:scope:sign-ddo\n' +
      '- urn:ietf:params:oauth:jwk-thumbprint:sha-256:NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs'

    const fields = {
      gateway: 'https://wallet.example.org/api/address-gateway',
      address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
      chainId: 32456,
      jkt: 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs',
      // In any order: the message lists them canonically, as wallet-api2 does.
      scopes: ['sign-ddo', 'present'],
      nonce: '9f2c4e6a8b0d1f3e5a7c9e1b3d5f7a9c',
      issuedAt: 1795428000,
      expiresAt: 1795428300
    }
    expect(buildSignInMessage(fields)).to.equal(fixture)
    expect(
      checkSignInMessage(fixture, fields, { nowSeconds: 1795428100 })
    ).to.deep.equal({
      nonce: fields.nonce,
      issuedAt: fields.issuedAt,
      expiresAt: fields.expiresAt
    })
  })

  it('names the port in the domain when the gateway URL does', () => {
    const message = buildSignInMessage({
      gateway: 'http://localhost:3000/api/address-gateway',
      address: ADDRESS,
      chainId: 1,
      jkt: 'x'.repeat(43),
      scopes: ['present'],
      nonce: '0'.repeat(32),
      issuedAt: 0,
      expiresAt: 300
    })
    expect(message.split('\n')[0]).to.equal(
      'localhost:3000 wants you to sign in with your Ethereum account:'
    )
    expect(message).not.to.contain('sign asset descriptions')
  })
})

describe('AddressSignIn', () => {
  it('signs in with a checked message, an EIP-191 signature and a DPoP proof, and caches the token', async () => {
    const gateway = mockGateway()
    const { wallet, signMessage } = signer()
    const signIn = new AddressSignIn({
      gateway: `${GATEWAY}/`,
      signer: wallet,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })

    const token = await signIn.getToken()
    expect(token).to.match(/^pxa_[A-Za-z0-9_-]{43}$/)
    expect(await signIn.getToken()).to.equal(token)
    expect(paths(gateway)).to.deep.equal([
      'auth/address/challenge',
      'auth/address/token'
    ])
    expect(gateway.problems).to.deep.equal([])
    expect(signMessage).toHaveBeenCalledTimes(1)

    const sent = JSON.parse(gateway.calls[0].body)
    expect(Object.keys(sent)).to.have.members([
      'address',
      'chainId',
      'jkt',
      'scopes'
    ])
    expect(sent.address).to.equal(ADDRESS)
    expect(sent.chainId).to.equal(CHAIN) // from the signer's provider
    expect(sent.scopes).to.deep.equal(['present'])
    expect(sent.jkt).to.match(/^[A-Za-z0-9_-]{43}$/)

    // The sign-in proof: dpop+jwt, ES256, the public key only, no ath
    const proof = gateway.calls[1].headers.get('dpop') as string
    const header = decodeProtectedHeader(proof)
    expect(header.jwk).to.have.all.keys('kty', 'crv', 'x', 'y')
    expect(await calculateJwkThumbprint(header.jwk as JWK, 'sha256')).to.equal(
      sent.jkt
    )

    expect(signIn.walletId).to.equal('w-address')
    expect(signIn.address).to.equal(ADDRESS)
  })

  it('sends a fresh proof with ath, htm and the gateway htu (no query) on every call', async () => {
    const gateway = mockGateway()
    const { wallet } = signer()
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const account = await signIn.check()
    await signIn.check()
    expect(account.walletId).to.equal('w-address')
    expect(account.verifiers[0].responseUriOrigin).to.equal(
      `https://${VERIFIER_HOST}`
    )

    const calls = gateway.calls.filter((call) => call.path === 'auth/account')
    expect(calls).to.have.length(2)
    const token = (await signIn.getToken()) as string
    for (const call of calls) {
      expect(call.headers.get('authorization')).to.equal(`DPoP ${token}`)
      const { payload } = await jwtVerify(
        call.headers.get('dpop') as string,
        EmbeddedJWK
      )
      expect(payload).to.include({
        htm: 'GET',
        htu: `${GATEWAY}/auth/account`,
        ath: sha256url(token)
      })
      expect(String(payload.jti).length).to.be.at.most(64)
    }
    expect(calls[0].headers.get('dpop')).not.to.equal(
      calls[1].headers.get('dpop')
    )
    expect(gateway.problems).to.deep.equal([])
  })

  it('needs chainId when the signer has no provider', async () => {
    const gateway = mockGateway()
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY),
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const thrown = await signIn.getToken().catch((e) => e)
    expect(thrown.message).to.match(/pass chainId/)
    expect(gateway.calls).to.have.length(0)

    const withChain = new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY),
      chainId: 32457,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    await withChain.getToken()
    expect(JSON.parse(gateway.calls[0].body).chainId).to.equal(32457)
  })

  it('refuses options it cannot use', () => {
    const wallet = new Wallet(KEY)
    expect(
      () =>
        new AddressSignIn({
          gateway: 'http://wallet.example.org/api/address-gateway',
          signer: wallet
        })
    ).to.throw(/http:\/\//)
    expect(
      () => new AddressSignIn({ gateway: `${GATEWAY}?x=1`, signer: wallet })
    ).to.throw(/without query/)
    expect(
      () => new AddressSignIn({ gateway: GATEWAY, signer: wallet, scopes: [] })
    ).to.throw(/scopes/)
    expect(
      () =>
        new AddressSignIn({
          gateway: GATEWAY,
          signer: wallet,
          scopes: ['admin' as never]
        })
    ).to.throw(/scopes/)
    expect(
      () =>
        new AddressSignIn({
          gateway: 'http://127.0.0.1:3000/api/address-gateway',
          signer: wallet
        })
    ).not.to.throw()
  })

  describe('refuses a message that is not exactly the expected one, before signing', () => {
    const cases: [string, (message: string) => string, RegExp][] = [
      [
        'another domain',
        (m) => m.replace(`${DOMAIN} wants`, 'localhost:7001 wants'),
        /domain line[\s\S]*localhost:7001/
      ],
      [
        'another URI',
        (m) =>
          m.replace(
            `URI: ${GATEWAY}`,
            'URI: http://localhost/api/address-gateway'
          ),
        /URI \(line 6\)[\s\S]*Expected "URI: https:\/\/wallet\.test\.invalid\/api\/address-gateway", got "URI: http:\/\/localhost\/api\/address-gateway"/
      ],
      [
        'another address',
        (m) => m.replace(ADDRESS, '0x1111111111111111111111111111111111111111'),
        /address \(line 2\)/
      ],
      [
        'a lower-case address',
        (m) => m.replace(ADDRESS, ADDRESS.toLowerCase()),
        /address \(line 2\)/
      ],
      [
        'another chain',
        (m) => m.replace(`Chain ID: ${CHAIN}`, 'Chain ID: 1'),
        /chain id/
      ],
      [
        'another statement',
        (m) =>
          m.replace(
            'present credentials to data services',
            'present credentials to data services and to sign asset descriptions (DDOs) for publishing'
          ),
        /statement/
      ],
      [
        'an extra scope',
        (m) =>
          m.replace(
            'Resources:\n',
            'Resources:\n- urn:pontusx:wallet2:scope:sign-ddo\n'
          ),
        /resource line|extra line/
      ],
      [
        'another key thumbprint',
        (m) => m.replace(/sha-256:[\w-]+$/, `sha-256:${'A'.repeat(43)}`),
        /resource line 14/
      ],
      ['a trailing line break', (m) => `${m}\n`, /extra line 15/],
      [
        'a malformed nonce',
        (m) => m.replace(/Nonce: \w+/, 'Nonce: xyz'),
        /nonce/
      ],
      [
        'an expired window',
        (m) =>
          m.replace(
            /Issued At: .*\nExpiration Time: .*/,
            'Issued At: 2020-01-01T00:00:00Z\nExpiration Time: 2020-01-01T00:05:00Z'
          ),
        /issue time[\s\S]*check this machine's clock/
      ],
      [
        'a window longer than 5 minutes',
        (m) =>
          m.replace(
            /Expiration Time: .*/,
            'Expiration Time: 2999-01-01T00:00:00Z'
          ),
        /validity/
      ]
    ]
    for (const [name, rewrite, expected] of cases)
      it(name, async () => {
        const gateway = mockGateway({ message: rewrite })
        const { wallet, signMessage } = signer()
        const signIn = new AddressSignIn({
          gateway: GATEWAY,
          signer: wallet,
          fetchImpl: gateway.fetchImpl as unknown as typeof fetch
        })
        const thrown = await signIn.getToken().catch((e) => e)
        expect(thrown).to.be.instanceOf(WaltIdWalletError)
        expect(thrown.code).to.equal('message_unexpected')
        expect(thrown.message).to.match(expected)
        expect(signMessage).not.toHaveBeenCalled()
        expect(paths(gateway)).to.deep.equal(['auth/address/challenge'])
      })

    it('a challenge whose expiresAt disagrees with the message', async () => {
      const gateway = mockGateway()
      // Rewrite the answer's expiresAt through a wrapping fetch.
      const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
        const response = await gateway.fetchImpl(input, init)
        if (!String(input).endsWith('/challenge')) return response
        const body = await response.json()
        return json(200, { ...body, expiresAt: '2999-01-01T00:00:00Z' })
      })
      const { wallet, signMessage } = signer()
      const thrown = await new AddressSignIn({
        gateway: GATEWAY,
        signer: wallet,
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
        .getToken()
        .catch((e) => e)
      expect(thrown.code).to.equal('message_unexpected')
      expect(thrown.message).to.match(/expiresAt/)
      expect(signMessage).not.toHaveBeenCalled()
    })
  })

  it('signs in again 60 s before the token expires, and shares one sign-in between concurrent callers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'))
    const gateway = mockGateway({ expiresIn: 3600 })
    const { wallet, signMessage } = signer()
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })

    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => signIn.getToken())
    )
    expect(new Set(tokens).size).to.equal(1)
    expect(signMessage).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-11-23T10:58:59Z'))
    expect(await signIn.getToken()).to.equal(tokens[0])
    expect(signMessage).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-11-23T10:59:01Z'))
    const renewed = await Promise.all([signIn.getToken(), signIn.getToken()])
    expect(renewed[0]).not.to.equal(tokens[0])
    expect(renewed[1]).to.equal(renewed[0])
    expect(signMessage).toHaveBeenCalledTimes(2)
    // A new ephemeral key for each sign-in
    const jkts = gateway.calls
      .filter((call) => call.path === 'auth/address/challenge')
      .map((call) => JSON.parse(call.body).jkt)
    expect(new Set(jkts).size).to.equal(2)
  })

  it('keeps the token while a renewal fails and the token still has time left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z'))
    let down = false
    const gateway = mockGateway({
      handle: (call) =>
        down && call.path === 'auth/address/challenge'
          ? refusal('unavailable')
          : undefined
    })
    const { wallet } = signer()
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const token = await signIn.getToken()
    down = true
    vi.setSystemTime(new Date('2026-11-23T10:59:30Z'))
    expect(await signIn.getToken()).to.equal(token)
    vi.setSystemTime(new Date('2026-11-23T11:00:00Z'))
    const thrown = await signIn.getToken().catch((e) => e)
    expect(thrown.code).to.equal('unavailable')
  })

  it('invalidate() forgets only the current token', async () => {
    const gateway = mockGateway()
    const { wallet } = signer()
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const first = await signIn.getToken()
    signIn.invalidate('pxa_someone-elses-older-token-0000000000000000000')
    expect(await signIn.getToken()).to.equal(first)
    signIn.invalidate(first)
    expect(await signIn.getToken()).not.to.equal(first)
  })

  it('signOut() revokes the token with a proof and forgets it', async () => {
    const gateway = mockGateway()
    const { wallet } = signer()
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const token = await signIn.getToken()
    await signIn.signOut()
    const logout = gateway.calls.find(
      (call) => call.path === 'auth/logout'
    ) as Call
    expect(logout.headers.get('authorization')).to.equal(`DPoP ${token}`)
    expect(gateway.problems).to.deep.equal([])
    expect(await signIn.getToken()).not.to.equal(token)
  })

  it('smartAccount: true refuses an undeployed account before anything is sent', async () => {
    const gateway = mockGateway()
    const { wallet, signMessage } = signer(fakeProvider('0x'))
    const thrown = await new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      smartAccount: true,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
      .getToken()
      .catch((e) => e)
    expect(thrown.code).to.equal('smart_account_not_deployed')
    expect(thrown.message).to.match(/Deploy the account or sign in with an EOA/)
    expect(thrown.message).to.match(/ERC-6492/)
    expect(gateway.calls).to.have.length(0)
    expect(signMessage).not.toHaveBeenCalled()
  })

  it('explains sign_in_failed from the code on chain, and sends no smart-account flag', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path === 'auth/address/token'
          ? refusal('sign_in_failed')
          : undefined
    })
    const provider = fakeProvider('0x6080')
    const { wallet } = signer(provider)
    const thrown = await new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
      .getToken()
      .catch((e) => e)
    expect(thrown.code).to.equal('sign_in_failed')
    expect(thrown.message).to.match(/is a contract/)
    expect(JSON.parse(gateway.calls[0].body)).not.to.have.property(
      'smartAccount'
    )

    const plain = mockGateway({
      handle: (call) =>
        call.path === 'auth/address/token'
          ? refusal('sign_in_failed')
          : undefined
    })
    const quiet = fakeProvider()
    const off = await new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY, quiet),
      smartAccount: false,
      fetchImpl: plain.fetchImpl as unknown as typeof fetch
    })
      .getToken()
      .catch((e) => e)
    expect(off.code).to.equal('sign_in_failed')
    expect(quiet.getCode).not.toHaveBeenCalled()
  })

  it('says wrong_endpoint when the URL is not an address gateway', async () => {
    const html = vi.fn(
      async () => new Response('<html>Not found</html>', { status: 404 })
    )
    const thrown = await new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY),
      chainId: CHAIN,
      fetchImpl: html as unknown as typeof fetch
    })
      .getToken()
      .catch((e) => e)
    expect(thrown.code).to.equal('wrong_endpoint')
    expect(thrown.status).to.equal(404)

    // A gateway that is switched off answers its own not_found
    const off = vi.fn(async () =>
      json(404, {
        error: 'not_found',
        message:
          'Sign-in with organization addresses is not enabled on this wallet.',
        hint: 'Check the gateway URL.'
      })
    )
    const disabled = await new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY),
      chainId: CHAIN,
      fetchImpl: off as unknown as typeof fetch
    })
      .getToken()
      .catch((e) => e)
    expect(disabled.code).to.equal('not_found')
    expect(disabled.hint).to.match(
      /does not serve the route[\s\S]*ADDRESS_GATEWAY_ENABLED[\s\S]*nautilus version/
    )
  })
})

describe('WalletApi2HttpClient with token sources', () => {
  it('retries once after a 401, with a new sign-in', async () => {
    const gateway = mockGateway({
      handle: (call, count) =>
        call.path.endsWith('/reject-handle') && count === 1
          ? refusal('token_expired')
          : undefined
    })
    const { wallet, signMessage } = signer()
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const client = new WalletApi2HttpClient({
      apiUrl: GATEWAY,
      token: signIn,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    await client.rejectPresentation('w-address', { handle: 'h' })
    expect(paths(gateway).filter((p) => p !== 'auth/logout')).to.deep.equal([
      'auth/address/challenge',
      'auth/address/token',
      'wallet/w-address/credentials/present/reject-handle',
      'auth/address/challenge',
      'auth/address/token',
      'wallet/w-address/credentials/present/reject-handle'
    ])
    expect(signMessage).toHaveBeenCalledTimes(2)
    // The refused token is revoked in the background, so it does not count as a session
    await vi.waitFor(() => expect(gateway.revoked).to.have.length(1))
  })

  it('retries only once', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path.endsWith('/reject-handle')
          ? refusal('token_invalid')
          : undefined
    })
    const { wallet } = signer()
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: wallet,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const client = new WalletApi2HttpClient({
      apiUrl: GATEWAY,
      token: signIn,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const thrown = await client
      .rejectPresentation('w-address', { handle: 'h' })
      .catch((e) => e)
    expect(thrown.code).to.equal('token_invalid')
    expect(thrown.status).to.equal(401)
    expect(
      paths(gateway).filter((p) => p.endsWith('/reject-handle'))
    ).to.have.length(2)
  })

  it('keeps the Hanko bearer behaviour: no retry, Authorization: Bearer', async () => {
    for (const token of [
      'hanko-jwt',
      async () => 'hanko-jwt',
      staticTokenSource('hanko-jwt')
    ]) {
      const fetchImpl = vi.fn(async () =>
        json(401, { error: 'Please log in.' })
      )
      const client = new WalletApi2HttpClient({
        apiUrl: 'https://wallet-api.test.invalid',
        token,
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
      const thrown = await client.listWallets().catch((e) => e)
      expect(thrown.status).to.equal(401)
      expect(thrown.code).to.equal(undefined)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      const init = (
        fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
      )[1]
      expect((init.headers as Record<string, string>).Authorization).to.equal(
        'Bearer hanko-jwt'
      )
    }
  })

  it('refuses to send an address token to another URL (wrong_endpoint)', () => {
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY)
    })
    const thrown = (() => {
      try {
        new WalletApi2HttpClient({
          apiUrl: 'https://wallet-api.test.invalid',
          token: signIn
        })
      } catch (error) {
        return error as WaltIdWalletError
      }
    })()
    expect(thrown?.code).to.equal('wrong_endpoint')
    expect(
      () =>
        new WalletApi2CredentialProvider({
          walletApi: 'https://wallet-api.test.invalid',
          token: signIn
        })
    ).to.throw(/only sent there/)
  })

  it('reads a 401 without an address error under a DPoP token as wrong_endpoint', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path === 'auth/account'
          ? new Response('Unauthorized', { status: 401 })
          : undefined
    })
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY, fakeProvider()),
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    const thrown = await signIn.check().catch((e) => e)
    expect(thrown.code).to.equal('wrong_endpoint')
  })
})

describe('WalletApi2CredentialProvider.withAddressSignIn', () => {
  it('presents from the address wallet with the address token, without listing wallets', async () => {
    const gateway = mockGateway()
    const { credentials } = withSignIn(gateway)
    expect(credentials.signIn).to.be.instanceOf(AddressSignIn)

    await credentials.prepare(preparation())
    await credentials.present(challenge())

    expect(paths(gateway)).to.deep.equal([
      'auth/address/challenge',
      'auth/address/token',
      'auth/account',
      'wallet/w-address/credentials/present/preview-handle',
      'wallet/w-address/credentials/present/submit-handle'
    ])
    // No query parameters (the gateway refuses them), e.g. no includeDetails
    expect(gateway.calls.every((call) => !call.path.includes('?'))).to.equal(
      true
    )
    expect(gateway.problems).to.deep.equal([])
  })

  it('runs the pre-flight once per provider', async () => {
    const gateway = mockGateway()
    const { credentials } = withSignIn(gateway)
    await credentials.prepare(preparation())
    await credentials.prepare(preparation())
    expect(paths(gateway).filter((p) => p === 'auth/account')).to.have.length(1)
  })

  it('fails prepare() when the signer is not the consumer', async () => {
    const gateway = mockGateway()
    const { credentials } = withSignIn(gateway)
    const other = '0x0DB823218e337a6817e6D7740eb17635DEAdafAF'
    const thrown = await credentials.prepare(preparation(other)).catch((e) => e)
    expect(thrown).to.be.instanceOf(CredentialPresentationError)
    expect(thrown.reason).to.equal('sign-in')
    expect(thrown.details.code).to.equal('signer_mismatch')
    expect(thrown.message).to.contain(
      `Signed in as ${ADDRESS}, but the order is for ${other}`
    )
  })

  it('fails prepare() when a pinned walletId is not the address wallet', async () => {
    const gateway = mockGateway()
    const { credentials } = withSignIn(gateway, { walletId: 'w-other' })
    const thrown = await credentials.prepare(preparation()).catch((e) => e)
    expect(thrown.message).to.contain(
      `walletId w-other is not the wallet of ${ADDRESS} (w-address)`
    )
  })

  it('fails prepare() when the address may not present to this node, or holds nothing to present', async () => {
    const gateway = mockGateway()
    const { credentials } = withSignIn(gateway)
    const thrown = await credentials
      .prepare(preparation(ADDRESS, 'other-verifier.test.invalid'))
      .catch((e) => e)
    expect(thrown.reason).to.equal('not-permitted')
    expect(thrown.details.code).to.equal('verifier_not_allowed')
    expect(thrown.message).to.match(/Admin: add that verifier/)

    const empty = mockGateway({
      handle: (call) =>
        call.path === 'auth/account'
          ? json(200, {
              method: 'evm-address',
              address: ADDRESS.toLowerCase(),
              walletId: 'w-address',
              scopes: ['present'],
              verifiers: [
                { clientId: 'c', responseUriOrigin: `https://${VERIFIER_HOST}` }
              ],
              presentableCredentials: []
            })
          : undefined
    })
    const second = await withSignIn(empty)
      .credentials.prepare(preparation())
      .catch((e) => e)
    expect(second.reason).to.equal('no-matching-credential')
    expect(second.details.code).to.equal('no_presentable_credentials')
    expect(second.message).to.match(/access list \(Wallet UI → Credentials\)/)

    const none = mockGateway({
      handle: (call) =>
        call.path === 'auth/account'
          ? json(200, {
              method: 'evm-address',
              address: ADDRESS,
              walletId: 'w-address',
              verifiers: [],
              presentableCredentials: []
            })
          : undefined
    })
    const third = await withSignIn(none)
      .credentials.prepare(preparation())
      .catch((e) => e)
    expect(third.reason).to.equal('not-permitted')
    expect(third.message).to.match(/may present to no verifier/)
  })

  it('reports an access-list grant removed before submit', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path.endsWith('/submit-handle')
          ? refusal('credential_not_on_access_list')
          : undefined
    })
    const thrown = await withSignIn(gateway)
      .credentials.present(challenge())
      .catch((e) => e)
    expect(thrown.reason).to.equal('no-matching-credential')
    expect(thrown.message).to.contain('access list')
    expect(thrown.details.code).to.equal('credential_not_on_access_list')
    expect(thrown.details.hint).to.equal(
      'Developer or admin: fix credential_not_on_access_list.'
    )
  })

  it('previews again once after handle_evicted', async () => {
    const gateway = mockGateway({
      handle: (call, count) =>
        call.path.endsWith('/submit-handle') && count === 1
          ? refusal('handle_evicted')
          : undefined
    })
    const { credentials } = withSignIn(gateway)
    await credentials.present(challenge())
    expect(paths(gateway).filter((p) => p.includes('/present/'))).to.deep.equal(
      [
        'wallet/w-address/credentials/present/preview-handle',
        'wallet/w-address/credentials/present/submit-handle',
        'wallet/w-address/credentials/present/preview-handle',
        'wallet/w-address/credentials/present/submit-handle'
      ]
    )

    const twice = mockGateway({
      handle: (call) =>
        call.path.endsWith('/submit-handle')
          ? refusal('handle_evicted')
          : undefined
    })
    const thrown = await withSignIn(twice)
      .credentials.present(challenge())
      .catch((e) => e)
    expect(thrown.details.code).to.equal('handle_evicted')
    expect(
      paths(twice).filter((p) => p.endsWith('/submit-handle'))
    ).to.have.length(2)
  })

  it('adds the access-list hint to no-matching-credential', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path.endsWith('/preview-handle')
          ? json(200, {
              handle: 'handle-0123456789',
              preview: {
                valid: true,
                responseUri: `https://${VERIFIER_HOST}/r`,
                transactionData: [],
                credentialOptions: [],
                credentialRequirements: [{ options: [['legal_person']] }]
              }
            })
          : undefined
    })
    const thrown = await withSignIn(gateway)
      .credentials.present(challenge())
      .catch((e) => e)
    expect(thrown.reason).to.equal('no-matching-credential')
    expect(thrown.message).to.contain(
      'Organisation credentials appear only if an admin put this address on their access list (Wallet UI → Credentials).'
    )
  })

  it('adds the access-list hint when wallet-api2 finds no credential combination (access_denied)', async () => {
    const gateway = mockGateway({
      handle: (call) =>
        call.path.endsWith('/preview-handle')
          ? json(200, {
              handle: 'handle-0123456789',
              preview: {
                valid: false,
                error: {
                  code: 'access_denied',
                  message:
                    'The wallet has no credential combination that satisfies this request'
                },
                responseUri: `https://${VERIFIER_HOST}/r`,
                transactionData: [],
                credentialOptions: []
              }
            })
          : undefined
    })
    const thrown = await withSignIn(gateway)
      .credentials.present(challenge())
      .catch((e) => e)
    expect(thrown.reason).to.equal('no-matching-credential')
    expect(thrown.details).to.deep.equal({ errorCode: 'access_denied' })
    expect(thrown.message).to.contain(
      'Organisation credentials appear only if an admin put this address on their access list (Wallet UI → Credentials).'
    )
    expect(paths(gateway).some((p) => p.endsWith('/reject-handle'))).to.equal(
      true
    )
  })

  const SIGN_IN = [
    'chain_not_supported',
    'challenge_invalid',
    'challenge_expired',
    'message_mismatch',
    'dpop_invalid',
    'sign_in_failed',
    'nonce_used',
    'address_not_linked',
    'sign_in_not_allowed_for_organization',
    'sign_in_disabled',
    'too_many_sessions'
  ]
  for (const code of SIGN_IN)
    it(`maps the sign-in refusal ${code} to reason sign-in`, async () => {
      const gateway = mockGateway({
        handle: (call) =>
          call.path === 'auth/address/token' ? refusal(code) : undefined
      })
      const thrown = await withSignIn(gateway)
        .credentials.prepare(preparation())
        .catch((e) => e)
      expect(thrown).to.be.instanceOf(CredentialPresentationError)
      expect(thrown.reason).to.equal('sign-in')
      expect(thrown.details.code).to.equal(code)
      expect(thrown.details.hint).to.equal(`Developer or admin: fix ${code}.`)
      expect(thrown.details.status).to.equal(codeStatus(code))
    })

  const ON_PREVIEW: [string, string][] = [
    ['token_invalid', 'sign-in'],
    ['token_expired', 'sign-in'],
    ['hanko_token_not_accepted', 'sign-in'],
    ['not_found', 'sign-in'],
    ['verifier_not_allowed', 'not-permitted'],
    ['response_mode_not_allowed', 'not-permitted'],
    ['did_web_holder_disabled', 'not-permitted'],
    ['key_not_allowed', 'not-permitted'],
    ['consumer_mismatch', 'not-permitted'],
    ['credential_not_on_access_list', 'no-matching-credential'],
    ['route_not_allowed', 'not-permitted'],
    ['scope_not_enabled', 'not-permitted'],
    ['not_a_ddo', 'not-permitted'],
    ['holder_changed', 'not-permitted'],
    ['invalid_request', 'wallet-failed'],
    ['handle_expired', 'wallet-failed'],
    ['rate_limited', 'wallet-failed'],
    ['capacity_exhausted', 'wallet-failed'],
    ['unavailable', 'wallet-failed'],
    ['step_up_required', 'wallet-failed']
  ]
  for (const [code, reason] of ON_PREVIEW)
    it(`maps ${code} on preview-handle to reason ${reason}`, async () => {
      const gateway = mockGateway({
        handle: (call) =>
          call.path.endsWith('/preview-handle')
            ? code === 'rate_limited'
              ? json(
                  429,
                  { error: code, message: 'Too many requests.', hint: 'Wait.' },
                  { 'retry-after': '3' }
                )
              : refusal(code)
            : undefined
      })
      const thrown = await withSignIn(gateway)
        .credentials.present(challenge())
        .catch((e) => e)
      expect(thrown).to.be.instanceOf(CredentialPresentationError)
      expect(thrown.reason).to.equal(reason)
      expect(thrown.details.code).to.equal(code)
      if (code === 'rate_limited') expect(thrown.details.retryAfter).to.equal(3)
    })

  it('has a reason for every code', () => {
    for (const code of [
      ...SIGN_IN,
      'token_invalid',
      'token_expired',
      'hanko_token_not_accepted',
      'wrong_endpoint',
      'message_unexpected',
      'signer_mismatch',
      'smart_account_not_deployed',
      'signer_without_provider',
      'sign_in_timeout'
    ])
      expect(addressCodeReason(code)).to.equal('sign-in')
    expect(addressCodeReason('wallet_mismatch')).to.equal('not-permitted')
    expect(addressCodeReason('no_presentable_credentials')).to.equal(
      'no-matching-credential'
    )
    expect(addressCodeReason('handle_evicted')).to.equal('wallet-failed')
  })

  it('keeps wallet-setup for a Hanko token refused with 401', async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: 'Please log in.' }))
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
  })
})

describe('legacy walt.id signing guard', () => {
  it('signs only a one-line nonce', () => {
    for (const nonce of [
      `Sign in: 0x${'ab'.repeat(32)}`,
      '15c72cd0-8c84-45dc-aae2-a310f6075a8f',
      'eyJhbGciOiJIUzI1NiJ9.eyJub25jZSI6IjEifQ.c2ln'
    ])
      expect(assertLegacyNonce(nonce)).to.equal(nonce)
    for (const text of [
      kotlinMessage({
        a: ADDRESS,
        c: CHAIN,
        j: 'x'.repeat(43),
        s: ['present'],
        n: '0'.repeat(32),
        i: 0,
        e: 300
      }),
      'wallet.example.org wants you to sign in with your Ethereum account: 0xabc',
      'Sign in: 0xab\nTransfer everything',
      'Please sign this to approve the transfer',
      'x'.repeat(2000),
      ''
    ])
      expect(() => assertLegacyNonce(text)).to.throw(WaltIdWalletError)
  })

  it('never personal_signs a Sign-In with Ethereum message from a legacy wallet', async () => {
    const siwe = kotlinMessage({
      a: ADDRESS,
      c: CHAIN,
      j: 'x'.repeat(43),
      s: ['present'],
      n: '0'.repeat(32),
      i: 0,
      e: 300
    })
    const fetchImpl = vi.fn(async () => new Response(siwe, { status: 200 }))
    const { wallet, signMessage } = signer()
    const thrown = await new WaltIdHttpWallet({
      apiUrl: 'https://legacy.test.invalid',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
      .authenticate(wallet)
      .catch((e) => e)
    expect(thrown.code).to.equal('message_unexpected')
    expect(thrown.message).to.match(/Sign-In with Ethereum/)
    expect(signMessage).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
