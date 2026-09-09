import type { MetadataV5, ServiceV5 } from '@oceanprotocol/ddo-js'
import { describe, expect, it } from 'vitest'
import { project } from '../../src/ddo/project.js'

/** The projected metadata, for tests that need to break a required field. */
function metadataOf(ddo: Record<string, unknown>): Partial<MetadataV5> {
  return (ddo.credentialSubject as { metadata: Partial<MetadataV5> }).metadata
}

import {
  assertValid,
  DdoValidationError,
  formatValidationErrors,
  getValidationReport,
  validate
} from '../../src/ddo/validate.js'
import { CHAIN_ID, NFT_ADDRESS, SERVICE_ID } from '../fixtures/Asset.js'

const service = {
  id: SERVICE_ID,
  type: 'access',
  name: 'Access Service',
  datatokenAddress: '0xfF4AE9869Cafb5Ff725f962F3Bbc22Fb303A8aD8',
  serviceEndpoint: 'https://node.test.invalid',
  files: 'encrypted',
  timeout: 86400,
  state: 0,
  credentials: []
} as unknown as ServiceV5

function buildDdo(metadataOverrides: Record<string, unknown> = {}) {
  return project(
    {
      version: '5.0.0',
      context: ['https://www.w3.org/ns/credentials/v2'],
      metadata: {
        type: 'dataset',
        name: 'Valid Dataset',
        providedBy: 'deltaDAO AG',
        description: 'A description',
        ...metadataOverrides
      },
      credentials: {},
      language: {}
    },
    {
      create: true,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service]
    }
  )
}

describe('local DDO validation', () => {
  it('accepts a DDO the builders produce', async () => {
    const { valid, errors } = await validate(buildDdo())

    expect(errors).to.deep.equal({})
    expect(valid).to.equal(true)
  })

  it('names the missing field rather than the failing shape', async () => {
    // `name` and `providedBy` are the two the v5 SHACL shape actually requires.
    const ddo = buildDdo()
    delete metadataOf(ddo).name

    const { valid, errors } = await validate(ddo)

    expect(valid).to.equal(false)
    expect(Object.keys(errors)).to.include('name')
  })

  // Worth an explicit test: ddo-js computes this check but discards it when the SHACL
  // shape conforms, and the v5 shape only constrains the DID's prefix and length. Nautilus
  // re-does it, because the indexer rejects an asset whose DID does not derive correctly.
  it('rejects a DID that does not derive from the nftAddress and chainId', async () => {
    const ddo = buildDdo()
    ddo.id =
      'did:ope:0000000000000000000000000000000000000000000000000000000000000000'

    const { valid, errors } = await validate(ddo)

    expect(valid).to.equal(false)
    expect(errors.id?.join(' ')).to.match(
      /does not derive from nftAddress and chainId/i
    )
  })

  it('rejects an invalid nftAddress with a clean message, not a raw ethers error', async () => {
    const ddo = buildDdo()
    ;(ddo.credentialSubject as Record<string, unknown>).nftAddress = ''

    const { valid, errors } = await validate(ddo)

    expect(valid).to.equal(false)
    expect(errors.nftAddress?.join(' ')).to.match(
      /nftAddress is missing or invalid/i
    )
    expect(JSON.stringify(errors)).to.not.match(/invalid address/i)
  })

  it('rejects a document with no credentialSubject at all', async () => {
    const { valid, errors } = await validate({
      id: 'did:ope:abc',
      version: '5.0.0'
    })

    expect(valid).to.equal(false)
    expect(Object.keys(errors)).to.satisfy(
      (keys: string[]) =>
        keys.includes('credentialSubject') || keys.includes('general')
    )
  })

  it('formats field errors into one readable line, without the SHACL dump', () => {
    const message = formatValidationErrors({
      name: ['Less than 1 values'],
      chainId: ['chainId is missing or invalid.'],
      fullReport: ['<a very long n-quads dump>']
    })

    expect(message).to.equal(
      'name: Less than 1 values; chainId: chainId is missing or invalid.'
    )
    expect(message).to.not.contain('n-quads')
  })

  it('keeps the SHACL report reachable for debugging', () => {
    expect(getValidationReport({ fullReport: ['the report'] })).to.equal(
      'the report'
    )
    expect(getValidationReport({})).to.equal(undefined)
  })

  it('assertValid throws a DdoValidationError carrying the field errors', async () => {
    const ddo = buildDdo()
    delete metadataOf(ddo).providedBy

    try {
      await assertValid(ddo)
      expect.fail('assertValid should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(DdoValidationError)
      expect((error as DdoValidationError).errors).to.have.property(
        'providedBy'
      )
      expect((error as Error).message).to.contain('providedBy')
    }
  })

  it('assertValid resolves for a valid DDO', async () => {
    await assertValid(buildDdo())
  })
})
