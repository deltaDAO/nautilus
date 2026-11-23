import { Wallet } from 'ethers'
import { describe, expect, it } from 'vitest'
import { assertValid } from '../../src/ddo/index.js'
import { AddressSignIn } from '../../src/identity/waltid/addressSignIn.js'
import { assertSignedDdo } from '../../src/publish/envelope.js'
import { WalletApi2VcSigner } from '../../src/signing/walletApi2.js'
import { getAssetFixture } from '../fixtures/Asset.js'
import {
  b64url,
  type Call,
  fakeProvider,
  GATEWAY,
  ISSUER,
  KEY,
  mockGateway,
  refusal
} from '../mocks/addressGateway.js'

describe('WalletApi2VcSigner', () => {
  function ddoFixture(): Record<string, unknown> {
    const asset = getAssetFixture() as unknown as Record<string, unknown>
    return { ...asset, issuer: '' }
  }

  function vcSigner(
    gateway: ReturnType<typeof mockGateway>,
    scopes: ('present' | 'sign-ddo')[] = ['present', 'sign-ddo']
  ) {
    const signIn = new AddressSignIn({
      gateway: GATEWAY,
      signer: new Wallet(KEY, fakeProvider()),
      scopes,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
    return new WalletApi2VcSigner({
      signIn,
      keyId: 'key-1',
      issuer: ISSUER,
      fetchImpl: gateway.fetchImpl as unknown as typeof fetch
    })
  }

  it('posts only the fields wallet-api2 accepts and returns the verified JWS', async () => {
    const gateway = mockGateway({ scopes: ['present', 'sign-ddo'] })
    const signer = vcSigner(gateway)
    const prepared = signer.prepareDocument(ddoFixture())
    expect(Object.keys(prepared)).to.have.members([
      '@context',
      'id',
      'type',
      'version',
      'issuer',
      'credentialSubject'
    ])
    expect(Object.keys(prepared.credentialSubject as object)).to.have.members([
      'chainId',
      'nftAddress',
      'metadata',
      'services',
      'credentials'
    ])
    // Still a valid DDO, and the document the publish flow validates is the one signed
    await assertValid(prepared)
    prepared.issuer = ISSUER

    const { jwt, issuer } = await signer.sign(prepared)
    expect(issuer).to.equal(ISSUER)

    const sign = gateway.calls.find((call) =>
      call.path.endsWith('/sign')
    ) as Call
    expect(sign.path).to.equal('wallet/w-address/keys/key-1/sign')
    const body = JSON.parse(sign.body)
    expect(
      Object.keys(body).every((key) =>
        [
          '@context',
          'id',
          'type',
          'issuer',
          'version',
          'credentialSubject',
          'additionalDdos'
        ].includes(key)
      )
    ).to.equal(true)
    expect(body).not.to.have.any.keys('iss', 'sub', 'jti')
    expect(body.type).to.deep.equal(['VerifiableCredential'])
    expect(sign.headers.get('authorization')).to.match(/^DPoP pxa_/)
    expect(gateway.problems).to.deep.equal([])
    expect(() => assertSignedDdo(jwt, prepared)).not.to.throw()
    expect(JSON.parse(gateway.calls[0].body).scopes).to.deep.equal([
      'present',
      'sign-ddo'
    ])
  })

  it('refuses a DDO with fields wallet-api2 would refuse, before sending it', async () => {
    const gateway = mockGateway()
    const thrown = await vcSigner(gateway)
      .sign(ddoFixture())
      .catch((e) => e)
    expect(thrown.message).to.match(
      /indexedMetadata[\s\S]*credentialSubject\.id/
    )
    expect(gateway.calls).to.have.length(0)
  })

  it('checks requested scopes and current address grants in the issuer preflight', async () => {
    const allowed = mockGateway({
      scopes: ['present', 'sign-ddo'],
      ddoSigning: true
    })
    await expect(
      vcSigner(allowed, ['present']).getIssuer()
    ).rejects.toMatchObject({
      code: 'scope_not_enabled'
    })
    expect(allowed.calls).to.have.length(0)
    for (const options of [
      { scopes: ['present'], ddoSigning: true },
      { scopes: ['present', 'sign-ddo'], ddoSigning: false }
    ]) {
      const gateway = mockGateway(options)
      await expect(vcSigner(gateway).getIssuer()).rejects.toMatchObject({
        code: 'scope_not_enabled'
      })
      expect(gateway.calls.at(-1)?.path).to.equal('auth/account')
    }
    expect(await vcSigner(allowed).getIssuer()).to.equal(ISSUER)
  })

  it('refuses without the sign-ddo scope, and passes the server scope_not_enabled on', async () => {
    const gateway = mockGateway()
    const signer = vcSigner(gateway, ['present'])
    const prepared = { ...signer.prepareDocument(ddoFixture()), issuer: ISSUER }
    const thrown = await signer.sign(prepared).catch((e) => e)
    expect(thrown.code).to.equal('scope_not_enabled')
    expect(gateway.calls).to.have.length(0)

    const refusing = mockGateway({
      handle: (call) =>
        call.path === 'auth/address/token'
          ? refusal('scope_not_enabled')
          : undefined
    })
    const second = await vcSigner(refusing)
      .sign(prepared)
      .catch((e) => e)
    expect(second.code).to.equal('scope_not_enabled')
    expect(second.status).to.equal(403)

    const notDdo = mockGateway({
      handle: (call) =>
        call.path.endsWith('/sign') ? refusal('not_a_ddo') : undefined
    })
    const third = await vcSigner(notDdo)
      .sign(prepared)
      .catch((e) => e)
    expect(third.code).to.equal('not_a_ddo')
  })

  it('refuses a JWS of another key or another document', async () => {
    const prepared = () => {
      const s = vcSigner(mockGateway())
      return { ...s.prepareDocument(ddoFixture()), issuer: ISSUER }
    }
    const otherKid = mockGateway({
      handle: (call) =>
        call.path.endsWith('/sign')
          ? new Response(
              `${b64url(JSON.stringify({ alg: 'ES256', kid: 'did:web:evil.test#k' }))}.${b64url(call.body)}.c2ln`
            )
          : undefined
    })
    expect(
      (
        await vcSigner(otherKid)
          .sign(prepared())
          .catch((e) => e)
      ).message
    ).to.match(/not with a verification method of did:web:org\.test/)

    const otherDoc = mockGateway({
      handle: (call) =>
        call.path.endsWith('/sign')
          ? new Response(
              `${b64url(JSON.stringify({ alg: 'ES256', kid: `${ISSUER}#k` }))}.${b64url('{"id":"x"}')}.c2ln`
            )
          : undefined
    })
    expect(
      (
        await vcSigner(otherDoc)
          .sign(prepared())
          .catch((e) => e)
      ).message
    ).to.match(/other than the DDO credential/)

    const huge = mockGateway({
      handle: (call) =>
        call.path.endsWith('/sign')
          ? new Response(
              `${b64url(JSON.stringify({ alg: 'ES256', kid: `${ISSUER}#k` }))}.${b64url(call.body)}.${'a'.repeat(2000)}`
            )
          : undefined
    })
    expect(
      (
        await vcSigner(huge)
          .sign(prepared())
          .catch((e) => e)
      ).message
    ).to.match(/more than the 1024/)
  })
})
