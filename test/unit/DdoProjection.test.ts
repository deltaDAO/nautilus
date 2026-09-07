import type { ServiceV5 } from '@oceanprotocol/ddo-js'
import { DDOManager } from '@oceanprotocol/ddo-js'
import { describe, expect, it } from 'vitest'
import { fromLanguageValue, toLanguageValue } from '../../src/ddo/language.js'
import {
  DDO_VERSION,
  mergeServices,
  project,
  stripDerivedFields,
  timestamp
} from '../../src/ddo/project.js'
import { getMetadata } from '../../src/ddo/read.js'
import {
  ASSET_DID,
  CHAIN_ID,
  getAssetFixture,
  NFT_ADDRESS,
  SERVICE_ID
} from '../fixtures/Asset.js'

const service: ServiceV5 = {
  id: SERVICE_ID,
  type: 'access',
  name: 'Access Service',
  datatokenAddress: '0xfF4AE9869Cafb5Ff725f962F3Bbc22Fb303A8aD8',
  serviceEndpoint: 'https://node.test.invalid',
  files: 'encrypted',
  timeout: 86400,
  state: 0,
  credentials: [] as unknown as ServiceV5['credentials']
}

function baseState() {
  return {
    version: DDO_VERSION,
    context: ['https://www.w3.org/ns/credentials/v2'],
    metadata: {
      type: 'dataset',
      name: 'Test Dataset',
      description: 'A description',
      providedBy: 'deltaDAO AG',
      license: 'https://example.org/terms'
    },
    credentials: {},
    language: {}
  }
}

describe('DDO v5 projection', () => {
  it('nests everything the DDO used to carry at the top level under credentialSubject', () => {
    const ddo = project(baseState(), {
      create: true,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service]
    })

    const subject = ddo.credentialSubject as Record<string, unknown>

    expect(ddo).to.have.property('credentialSubject')
    expect(subject.chainId).to.equal(CHAIN_ID)
    expect(subject.nftAddress).to.equal(NFT_ADDRESS)
    expect(subject.metadata).to.be.an('object')
    expect(subject.services).to.have.length(1)

    // The v4 shape put these at the root; nothing should be left there.
    expect(ddo).to.not.have.property('chainId')
    expect(ddo).to.not.have.property('nftAddress')
    expect(ddo).to.not.have.property('metadata')
    expect(ddo).to.not.have.property('services')
  })

  it('derives a did:ope: identifier, not the v4 did:op:', () => {
    const ddo = project(baseState(), {
      create: true,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service]
    })

    expect(ddo.id).to.equal(ASSET_DID)
    expect(ddo.id).to.match(/^did:ope:/)
  })

  it('is a Verifiable Credential envelope', () => {
    const ddo = project(baseState(), {
      create: true,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service]
    })

    expect(ddo['@context']).to.deep.equal([
      'https://www.w3.org/ns/credentials/v2'
    ])
    expect(ddo.type).to.deep.equal(['VerifiableCredential'])
    expect(ddo).to.have.property('issuer')
    expect(ddo.version).to.equal('5.0.0')
  })

  it('wraps a plain description into a language-tagged object', () => {
    const state = baseState()
    state.language = { language: 'de', direction: 'ltr' }

    const ddo = project(state, {
      create: true,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service]
    })

    expect(getMetadata(ddo).description).to.deep.equal({
      '@value': 'A description',
      '@language': 'de',
      '@direction': 'ltr'
    })
  })

  it('wraps a plain license string into the v5 license object', () => {
    const ddo = project(baseState(), {
      create: true,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service]
    })

    expect(getMetadata(ddo).license).to.deep.equal({
      name: 'https://example.org/terms'
    })
  })

  it('stamps created on publish and only updated on edit', () => {
    const created = project(baseState(), {
      create: true,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service],
      now: '2026-01-01T00:00:00Z'
    })

    const baseline = created
    const edited = project(baseState(), {
      create: false,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service],
      baseline,
      now: '2026-06-01T00:00:00Z'
    })

    expect(getMetadata(edited).created).to.equal('2026-01-01T00:00:00Z')
    expect(getMetadata(edited).updated).to.equal('2026-06-01T00:00:00Z')
  })

  it('merges over the baseline on edit, so one field can change alone', () => {
    const baseline = getAssetFixture() as unknown as Record<string, unknown>

    const state = baseState()
    state.metadata = { name: 'Renamed' } as typeof state.metadata

    const edited = project(state, {
      create: false,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service],
      baseline
    })

    const metadata = getMetadata(edited)

    expect(metadata.name).to.equal('Renamed')
    // Untouched fields survive — the ocean-cli's shallow merge would have dropped these.
    expect(metadata.author).to.equal('deltaDAO')
    expect(metadata.providedBy).to.equal('deltaDAO AG')
    expect(fromLanguageValue(metadata.description)).to.contain(
      'nautilus test suite'
    )
  })

  it('refuses to create a DDO without a chainId and nftAddress', () => {
    expect(() =>
      project(baseState(), {
        create: true,
        chainId: 0,
        nftAddress: '',
        services: [service]
      })
    ).to.throw(/chainId and nftAddress are required/)
  })

  it('emits second-precision timestamps, as the v5 schema expects', () => {
    expect(timestamp(new Date('2026-01-01T00:00:00.123Z'))).to.equal(
      '2026-01-01T00:00:00Z'
    )
  })
})

describe('stripDerivedFields', () => {
  it('removes everything the indexer derives, so it is never signed', () => {
    const stripped = stripDerivedFields(
      getAssetFixture() as unknown as Record<string, unknown>
    )
    const subject = stripped.credentialSubject as Record<string, unknown>

    expect(stripped).to.not.have.property('indexedMetadata')
    expect(subject).to.not.have.property('datatokens')
    expect(subject).to.not.have.property('event')
    expect(subject).to.not.have.property('stats')

    // What the publisher actually authored is untouched.
    expect(subject.metadata).to.be.an('object')
    expect(subject.services).to.have.length(1)
  })

  it('does not mutate its input', () => {
    const asset = getAssetFixture() as unknown as Record<string, unknown>

    stripDerivedFields(asset)

    expect(asset).to.have.property('indexedMetadata')
  })
})

describe('mergeServices', () => {
  const other: ServiceV5 = { ...service, id: 'second-service' }

  it('keeps baseline services that were not rebuilt', () => {
    expect(mergeServices([service, other], [])).to.have.length(2)
  })

  it('replaces a baseline service by id', () => {
    const replacement = { ...service, timeout: 100 }
    const merged = mergeServices([service, other], [replacement])

    expect(merged).to.have.length(2)
    expect(merged.find((s) => s.id === SERVICE_ID)?.timeout).to.equal(100)
  })

  it('appends services that are not on the baseline', () => {
    const merged = mergeServices([service], [other])

    expect(merged.map((s) => s.id)).to.deep.equal([
      SERVICE_ID,
      'second-service'
    ])
  })

  it('drops removed ids', () => {
    const merged = mergeServices([service, other], [], ['second-service'])

    expect(merged.map((s) => s.id)).to.deep.equal([SERVICE_ID])
  })
})

describe('language values', () => {
  it('round-trips a plain string', () => {
    expect(fromLanguageValue(toLanguageValue('hello'))).to.equal('hello')
  })

  it('passes an existing language value through unchanged', () => {
    const value = { '@value': 'x', '@language': 'fr', '@direction': 'ltr' }

    expect(toLanguageValue(value)).to.equal(value)
  })

  it('reads the un-prefixed form the node index returns', () => {
    // ocean-node's Elasticsearch mapping stores these without the `@`, so a value
    // round-tripped through a search response arrives in this shape.
    const indexed = { value: 'from-index', language: 'en', direction: 'ltr' }

    expect(fromLanguageValue(indexed as never)).to.equal('from-index')
  })
})

describe('DDOManager compatibility', () => {
  it('projects into something ddo-js recognises as a v5 DDO', () => {
    const ddo = project(baseState(), {
      create: true,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      services: [service]
    })

    const managed = DDOManager.getDDOClass(ddo)
    const fields = managed.getDDOFields()

    expect(fields.chainId).to.equal(CHAIN_ID)
    expect(fields.nftAddress).to.equal(NFT_ADDRESS)
    expect(fields.services).to.have.length(1)
  })
})
