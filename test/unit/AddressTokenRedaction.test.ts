import { EmbeddedJWK, jwtVerify } from 'jose'
import { afterEach, describe, expect, it } from 'vitest'
import { quoteText } from '../../src/identity/waltid/addressErrors.js'
import { SignInMessageMismatch } from '../../src/identity/waltid/addressMessage.js'
import { WaltIdWalletError } from '../../src/identity/waltid/client.js'
import { DpopKey } from '../../src/identity/waltid/dpop.js'
import type { DebugEvent } from '../../src/log/debug.js'
import { debugRaw, resetDebug, setDebug } from '../../src/log/debug.js'
import { sanitize } from '../../src/node/messages.js'
import {
  challenge,
  GATEWAY,
  mockGateway,
  preparation,
  refusal,
  sha256url,
  withSignIn
} from '../mocks/addressGateway.js'

afterEach(() => {
  resetDebug({})
})

describe('redaction of address tokens, DPoP proofs, signatures and the ephemeral key', () => {
  it('prints no token, proof, signature or key at any debug tier', async () => {
    for (const level of ['sensitive', 'secrets'] as const) {
      const events: DebugEvent[] = []
      setDebug({ level, sink: (event) => events.push(event) })
      const gateway = mockGateway({
        handle: (call, count) =>
          call.path.endsWith('/submit-handle') && count === 1
            ? refusal('token_expired')
            : undefined
      })
      const { credentials } = withSignIn(gateway)
      await credentials.prepare(preparation())
      await credentials.present(challenge())

      const token = await credentials.signIn.getToken()
      const proof = gateway.proofs.at(-1) as string
      debugRaw('wallet', `wallet/w${token}/keys/k-${proof}`, {
        [`w${token}`]: 'account',
        [`eyJ-prefix-${proof}`]: 'proof',
        headers: { Authorization: `DPoP ${token}`, DPoP: proof },
        dpop: proof,
        text: `sent Authorization: DPoP ${token} with DPoP: ${proof}`,
        key: await DpopKey.create()
      })

      expect(events.at(-1)).toMatchObject({
        tier: level,
        message: 'wallet/w<redacted>/keys/k-<redacted>',
        data: { 'w<redacted>': 'account', '<redacted>': 'proof' }
      })
      const printed = JSON.stringify(events)
      expect(events.length).to.be.greaterThan(0)
      for (const secret of [
        ...gateway.tokens.keys(),
        ...gateway.proofs,
        ...gateway.signatures
      ])
        expect(printed).not.to.contain(secret)
      expect(printed).not.to.match(/pxa_[A-Za-z0-9_-]{8}/)
      expect(printed).not.to.match(/"d":/)
      resetDebug({})
    }
  })

  it('masks short alphabetic Bearer and Basic credentials', () => {
    for (const scheme of ['Bearer', 'Basic']) {
      expect(
        sanitize(`upstream rejected ${scheme} sesame`, 300, null)
      ).to.equal(`upstream rejected ${scheme} <redacted>`)
    }
  })

  it('redacts them from error text', () => {
    const token = `pxa_${'a'.repeat(43)}`
    const text = sanitize(
      `refused Authorization: DPoP ${token}, wallet${token}`,
      500,
      null
    )
    expect(text).not.to.contain(token)
    expect(text).to.contain('<redacted>')
  })

  it('masks identifiers before quoting and truncating diagnostics', async () => {
    const token = 'pxa_abcdefghijklmnopqrstuvwxyz'
    const proof = await (await DpopKey.create()).proof('GET', GATEWAY, token)
    for (const secret of [token, proof]) {
      expect(quoteText(`key-${secret}`, 15)).to.equal('"key-<redacted>"')
      const error = new WaltIdWalletError(`wallet/${secret}`, 'refused')
      expect(error.message).to.contain('wallet/<redacted>')
      const mismatch = new SignInMessageMismatch('URI', 'gateway', secret)
      expect(mismatch.message).to.contain('<redacted>')
      expect(JSON.stringify(mismatch)).not.to.contain(secret)
    }
  })

  it('a DPoP key shows only its thumbprint', async () => {
    const key = await DpopKey.create()
    expect(JSON.parse(JSON.stringify(key))).to.deep.equal({
      thumbprint: key.thumbprint
    })
    expect(Object.keys(key)).not.to.include('privateKey')
    const proof = await key.proof('POST', `${GATEWAY}/x?y=1#z`, 'pxa_t')
    const { payload } = await jwtVerify(proof, EmbeddedJWK)
    expect(payload.htu).to.equal(`${GATEWAY}/x`)
    expect(payload.ath).to.equal(sha256url('pxa_t'))
  })
})
