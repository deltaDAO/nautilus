/**
 * The envelope size check (NODE-FAILURE-CASES case 4).
 *
 * ocean-node 4.2 parses every JSON request with express's default 100 KB limit, including
 * the indexer's own `POST /api/services/decrypt` that carries the envelope ciphertext back
 * to the node. A larger envelope gets a 413 and the asset is never indexed, so nautilus
 * refuses it before the metadata transaction (and, from the DDO, before the mint).
 */
import { describe, expect, it } from 'vitest'
import {
  assertDdoFitsDecryptLimit,
  buildEnvelope,
  ECIES_OVERHEAD_BYTES,
  envelopeCiphertextLengthFor,
  envelopeDecryptBodyBytes,
  MAX_DECRYPT_BODY_BYTES,
  maxDecryptableJwsLength,
  NODE_DECRYPT_BODY_LIMIT_BYTES
} from '../../src/publish/envelope.js'
import { createNodeMock } from '../mocks/node.js'

/** A compact JWS of exactly `length` characters. */
function jwsOfLength(length: number): string {
  const header = 'eyJhbGciOiJFUzI1NksifQ'
  const signature = 'c2lnbmF0dXJl'
  return `${header}.${'a'.repeat(length - header.length - signature.length - 2)}.${signature}`
}

/** The body the indexer sends, as `BaseProcessor.decryptDDO` builds it on 4.2. */
function nodeDecryptBody(encryptedData: string): string {
  const txId = ''
  const metadataHash = ''
  return JSON.stringify({
    transactionId: txId,
    chainId: 11155420,
    decrypterAddress: '0xbcE5a1Bd3a7AE2Bf2d0A9a8e9Ff5aB3d7C2D3135',
    dataNftAddress: '0x96C51CAAa8f8Abf9FC201739D5f5021AeF8a526b',
    encryptedDocument: txId ? undefined : encryptedData,
    flags: 2,
    documentHash: metadataHash || undefined,
    signature: `0x${'ab'.repeat(65)}`,
    nonce: '266'
  })
}

describe('the decrypt request size', () => {
  it('predicts the envelope ciphertext length exactly', async () => {
    const node = createNodeMock()
    const jws = jwsOfLength(2_900)

    const envelope = JSON.parse(await buildEnvelope(node.client, jws)) as {
      encryptedData: string
    }

    expect(envelope.encryptedData.length).to.equal(
      envelopeCiphertextLengthFor(jws.length)
    )
    // ECIES adds 97 bytes on 4.2; the mock does the same.
    expect(ECIES_OVERHEAD_BYTES).to.equal(97)
  })

  it('bounds the body the indexer actually sends, closely', () => {
    const ciphertext = `0x${'cd'.repeat(5_000)}`
    const actual = Buffer.byteLength(nodeDecryptBody(ciphertext))
    const bound = envelopeDecryptBodyBytes(ciphertext.length)

    expect(bound).to.be.at.least(actual)
    expect(bound - actual).to.be.below(64)
  })

  it('keeps a margin below the node’s 100 KB limit', () => {
    expect(NODE_DECRYPT_BODY_LIMIT_BYTES).to.equal(102_400)
    expect(MAX_DECRYPT_BODY_BYTES).to.be.below(NODE_DECRYPT_BODY_LIMIT_BYTES)

    const max = maxDecryptableJwsLength()
    expect(
      envelopeDecryptBodyBytes(envelopeCiphertextLengthFor(max))
    ).to.be.at.most(MAX_DECRYPT_BODY_BYTES)
    expect(
      envelopeDecryptBodyBytes(envelopeCiphertextLengthFor(max + 1))
    ).to.be.above(MAX_DECRYPT_BODY_BYTES)
    // About 4 × the JWS: roughly 24 000 characters.
    expect(max).to.be.within(20_000, 25_000)
  })
})

describe('buildEnvelope', () => {
  it('builds the largest envelope that fits', async () => {
    const node = createNodeMock()

    await buildEnvelope(node.client, jwsOfLength(maxDecryptableJwsLength()))

    expect(node.calls.metadataEncrypt).to.have.length(1)
  })

  it('refuses a JWS that is too large, before asking the node to encrypt it', async () => {
    const node = createNodeMock()

    await expect(
      buildEnvelope(node.client, jwsOfLength(maxDecryptableJwsLength() + 1))
    ).rejects.toThrow(
      /too large for ocean-node 4\.2 to index.*102400 bytes.*413/
    )
    expect(node.calls.encrypt).to.have.length(0)
  })
})

describe('assertDdoFitsDecryptLimit', () => {
  it('passes an ordinary DDO', () => {
    expect(() =>
      assertDdoFitsDecryptLimit({ id: 'did:ope:x', description: 'short' })
    ).not.toThrow()
  })

  it('refuses a DDO whose JSON alone is too large', () => {
    expect(() =>
      assertDdoFitsDecryptLimit({
        id: 'did:ope:x',
        description: 'x'.repeat(20_000)
      })
    ).toThrow(/too large for ocean-node 4\.2 to index/)
  })
})
