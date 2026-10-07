/**
 * The envelope size check.
 *
 * The node accepts JSON requests up to 100 KB (express's default), including the indexer's
 * `POST /api/services/decrypt` that carries the envelope ciphertext back to the node. A
 * larger envelope gets a 413 and the asset is not indexed, so nautilus refuses it before
 * the metadata transaction (and, from an upper bound of the signed DDO, before the mint).
 */

import { Wallet } from 'ethers'
import { describe, expect, it } from 'vitest'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import { PLACEHOLDER_ADDRESS } from '../../src/Nautilus/Asset/NautilusDDO.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import {
  assertDdoFitsDecryptLimit,
  buildEnvelope,
  ECIES_OVERHEAD_BYTES,
  envelopeCiphertextLengthFor,
  envelopeDecryptBodyBytes,
  JWS_SIGNING_ALLOWANCE,
  MAX_DECRYPT_BODY_BYTES,
  maxDecryptableJwsLength,
  maxJwsLengthFor,
  NODE_DECRYPT_BODY_LIMIT_BYTES,
  nodeCiphertextLength
} from '../../src/publish/envelope.js'
import { Eip191VcSigner } from '../../src/signing/vc.js'
import { CHAIN_ID, DATATOKEN_ADDRESS, NFT_ADDRESS } from '../fixtures/Asset.js'
import { createNodeMock, mockEncrypt } from '../mocks/node.js'

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
    ).rejects.toThrow(/too large for the node to index.*102400 bytes.*413/)
    expect(node.calls.encrypt).to.have.length(0)
  })
})

describe('assertDdoFitsDecryptLimit', () => {
  const wallet = new Wallet(
    '0x0123456789012345678901234567890123456789012345678901234567890123'
  )
  const issuer = wallet.address

  /** A DDO whose `description` is `length` characters. */
  const ddoOf = (length: number) => ({
    id: 'did:ope:3b8c2b6cbd2d0b6b2d2a1f7f2f6f3a9f8c1e0d4b5a6c7d8e9f0a1b2c3d4e5f6a',
    version: '5.0.0',
    issuer,
    description: 'x'.repeat(length)
  })

  /** The length of the JWS the default signer returns for `ddo`. */
  const signedLength = async (ddo: Record<string, unknown>) =>
    (await new Eip191VcSigner(wallet).sign(ddo)).jwt.length

  it('passes an ordinary DDO', () => {
    expect(() => assertDdoFitsDecryptLimit(ddoOf(100), issuer)).not.toThrow()
  })

  it('refuses a DDO whose JSON alone is too large', () => {
    expect(() => assertDdoFitsDecryptLimit(ddoOf(20_000), issuer)).toThrow(
      /too large for the node to index.*Checked before any transaction/
    )
  })

  it('counts the credential claims, header and signature, not just the DDO', async () => {
    // The largest description whose signed JWS still fits, and one more character.
    let length = 17_600
    while ((await signedLength(ddoOf(length + 1))) <= maxDecryptableJwsLength())
      length++
    expect(await signedLength(ddoOf(length))).to.be.at.most(
      maxDecryptableJwsLength()
    )
    const tooLarge = ddoOf(length + 1)

    // The DDO's own JSON in base64url fits: a check of that alone passes this DDO, and
    // the signed envelope would then be refused only after the mint.
    const bareJws =
      Buffer.from(JSON.stringify(tooLarge)).toString('base64url').length + 2
    expect(bareJws).to.be.at.most(maxDecryptableJwsLength())
    await expect(
      buildEnvelope(
        createNodeMock().client,
        (await new Eip191VcSigner(wallet).sign(tooLarge)).jwt
      )
    ).rejects.toThrow(/too large for the node to index/)

    expect(() => assertDdoFitsDecryptLimit(tooLarge, issuer)).toThrow(
      /too large for the node to index/
    )
  })

  it('is an upper bound for the default signer, at most JWS_SIGNING_ALLOWANCE above it', async () => {
    for (const length of [0, 1, 2, 3, 1_000, 17_000, 17_001, 17_002]) {
      const ddo = ddoOf(length)
      const actual = await signedLength(ddo)

      expect(maxJwsLengthFor(ddo, issuer)).to.be.at.least(actual)
      expect(maxJwsLengthFor(ddo, issuer) - actual).to.be.below(
        JWS_SIGNING_ALLOWANCE
      )
    }
  })

  it('never passes a DDO whose envelope the default signer makes too large', async () => {
    const node = createNodeMock()

    for (let length = 17_500; length < 18_500; length += 37) {
      const ddo = ddoOf(length)
      let fits = true
      try {
        assertDdoFitsDecryptLimit(ddo, issuer)
      } catch {
        fits = false
      }

      if (fits)
        await buildEnvelope(
          node.client,
          (await new Eip191VcSigner(wallet).sign(ddo)).jwt
        )
    }
  })

  it('leaves room for walt.id: a 200-character key id and a 4096-bit RSA signature', () => {
    const header = Buffer.from(
      JSON.stringify({ typ: 'JWT', kid: 'k'.repeat(200), alg: 'RS512' })
    ).toString('base64url')
    const signature = Buffer.alloc(512).toString('base64url')

    expect(header.length + signature.length + 2).to.be.at.most(
      JWS_SIGNING_ALLOWANCE
    )
  })
})

describe('nodeCiphertextLength', () => {
  it('is the length of the node’s ECIES output in hex', () => {
    const plaintext = JSON.stringify({ files: ['ü'] })

    expect(nodeCiphertextLength(plaintext)).to.equal(
      mockEncrypt(JSON.parse(plaintext)).length
    )
  })
})

describe('the pre-transaction DDO', () => {
  it('is as large as the published one, files included', async () => {
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Sized Dataset')
      .setProvidedBy('deltaDAO AG')
      .setDescription('A description')
      .addService(
        new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
          serviceType: ServiceTypes.ACCESS
        })
          .setServiceEndpoint('https://node.test.invalid')
          .setName('Access Service')
          .setPricing({ type: 'free' })
          .addFile({
            type: 'url',
            url: 'https://files.test.invalid/a.csv',
            method: 'GET',
            headers: { Authorization: 'Bearer ü-token' }
          })
          .build()
      )
      .build()

    // Files encrypted the way ocean-node 4.2 does it: ECIES output, in hex.
    const node = createNodeMock()
    node.client.encrypt = (async (data: unknown) =>
      mockEncrypt(data)) as typeof node.client.encrypt

    const now = '2026-01-01T00:00:00Z'
    const preflight = asset.ddo.getPreflightDDO({
      create: true,
      chainId: CHAIN_ID,
      nftAddress: PLACEHOLDER_ADDRESS,
      datatokenAddress: PLACEHOLDER_ADDRESS,
      now
    })
    asset.ddo.services[0].datatokenAddress = DATATOKEN_ADDRESS
    const published = await asset.ddo.getDDO(node.client, {
      create: true,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      now
    })

    expect(Buffer.byteLength(JSON.stringify(preflight))).to.equal(
      Buffer.byteLength(JSON.stringify(published))
    )
  })
})
