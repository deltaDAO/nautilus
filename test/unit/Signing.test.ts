import { Wallet } from 'ethers'
import { describe, expect, it } from 'vitest'
import type { WaltIdWallet } from '../../src/identity/waltid/client.js'
import {
  decodeCredential,
  Eip191VcSigner,
  WaltIdVcSigner
} from '../../src/signing/vc.js'
import { getAssetFixture } from '../fixtures/Asset.js'

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'

function ddo() {
  return getAssetFixture() as unknown as Record<string, unknown>
}

describe('Eip191VcSigner', () => {
  it('produces a three-part compact JWT', async () => {
    const wallet = new Wallet(PRIVATE_KEY)
    const { jwt } = await new Eip191VcSigner(wallet).sign(ddo())

    expect(jwt.split('.')).to.have.length(3)
  })

  it('declares the non-standard ETH-EIP191 algorithm', async () => {
    // Not a JOSE-registered alg: the signature is a personal_sign over header.payload.
    // It exists so publishing works without an SSI wallet.
    const wallet = new Wallet(PRIVATE_KEY)
    const { jwt } = await new Eip191VcSigner(wallet).sign(ddo())

    const header = JSON.parse(
      Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8')
    )

    expect(header).to.deep.equal({ alg: 'ETH-EIP191', typ: 'JWT' })
  })

  it('issues from the signer address when there is no DID', async () => {
    const wallet = new Wallet(PRIVATE_KEY)
    const { issuer, jwt } = await new Eip191VcSigner(wallet).sign(ddo())

    expect(issuer).to.equal(wallet.address)
    expect(decodeCredential(jwt).issuer).to.equal(wallet.address)
  })

  it('wraps the DDO as a VerifiableCredential with matching JWT claims', async () => {
    const wallet = new Wallet(PRIVATE_KEY)
    const source = ddo()
    const { jwt } = await new Eip191VcSigner(wallet).sign(source)

    const payload = decodeCredential(jwt)

    expect(payload.type).to.deep.equal(['VerifiableCredential'])
    expect(payload.sub).to.equal(source.id)
    expect(payload.jti).to.equal(source.id)
    expect(payload.iss).to.equal(wallet.address)
    expect(payload.credentialSubject).to.deep.equal(source.credentialSubject)
  })

  it('does not mutate the DDO it signs', async () => {
    const wallet = new Wallet(PRIVATE_KEY)
    const source = ddo()

    await new Eip191VcSigner(wallet).sign(source)

    expect(source).to.not.have.property('iss')
    expect(source).to.not.have.property('jti')
  })
})

describe('WaltIdVcSigner', () => {
  it('signs with the wallet key and issues from the holder DID', async () => {
    const signed: unknown[] = []

    const wallet = {
      async sign(
        walletId: string,
        keyId: string,
        payload: unknown,
        token: string
      ) {
        signed.push({ walletId, keyId, payload, token })
        return 'header.payload.signature'
      }
    } as unknown as WaltIdWallet

    const signer = new WaltIdVcSigner({
      wallet,
      walletId: 'w1',
      keyId: 'k1',
      did: 'did:key:holder',
      token: 'session-token'
    })

    const result = await signer.sign(ddo())

    expect(result.issuer).to.equal('did:key:holder')
    expect(result.jwt).to.equal('header.payload.signature')
    expect(signed[0]).to.deep.include({
      walletId: 'w1',
      keyId: 'k1',
      token: 'session-token'
    })
    expect(
      (signed[0] as { payload: Record<string, unknown> }).payload.issuer
    ).to.equal('did:key:holder')
  })

  it('fails loudly when walt.id returns nothing', async () => {
    const wallet = {
      async sign() {
        return ''
      }
    } as unknown as WaltIdWallet

    const signer = new WaltIdVcSigner({
      wallet,
      walletId: 'w1',
      keyId: 'k1',
      did: 'did:key:holder',
      token: 't'
    })

    let message = ''
    try {
      await signer.sign(ddo())
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).to.match(/no signature/i)
  })
})

describe('decodeCredential', () => {
  it('rejects something that is not a compact JWT', () => {
    expect(() => decodeCredential('not-a-jwt')).to.throw(
      /three dot-separated parts/
    )
  })
})
