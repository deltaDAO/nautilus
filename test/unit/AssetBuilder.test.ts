import { describe, expect, it } from 'vitest'
import { LifecycleStates } from '../../src/@types/Nautilus.js'
import { CredentialListTypes } from '../../src/ddo/types.js'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import {
  getAssetFixture,
  OWNER_ADDRESS,
  SERVICE_ID
} from '../fixtures/Asset.js'

function aService() {
  return new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint('https://node.test.invalid')
    .setName('Access Service')
    .setPricing({ type: 'free' })
    .build()
}

function aBuilder() {
  return new AssetBuilder()
    .setType('dataset')
    .setName('Test Dataset')
    .setProvidedBy('deltaDAO AG')
    .addService(aService())
}

describe('AssetBuilder', () => {
  it('builds a minimal dataset', () => {
    const asset = aBuilder().build()

    expect(asset.ddo.metadata.name).to.equal('Test Dataset')
    expect(asset.ddo.metadata.type).to.equal('dataset')
    expect(asset.ddo.metadata.providedBy).to.equal('deltaDAO AG')
    expect(asset.ddo.services).to.have.length(1)
  })

  it('chains every setter', () => {
    const asset = aBuilder()
      .setDescription('A description')
      .setDisplayTitle('A nicer title')
      .setAuthor('deltaDAO')
      .setCopyrightHolder('deltaDAO AG')
      .setLicense('https://example.org/terms')
      .addTags(['a', 'b'])
      .addCategories(['testing'])
      .build()

    expect(asset.ddo.metadata.description).to.equal('A description')
    expect(asset.ddo.metadata.displayTitle).to.equal('A nicer title')
    expect(asset.ddo.metadata.tags).to.deep.equal(['a', 'b'])
  })

  it('rejects a new asset with no name, type or providedBy', () => {
    // providedBy is required by the v5 schema and did not exist in v4.
    expect(() => new AssetBuilder().addService(aService()).build()).to.throw(
      /name, type, providedBy/
    )
  })

  it('rejects a new asset with no service', () => {
    expect(() =>
      new AssetBuilder()
        .setType('dataset')
        .setName('x')
        .setProvidedBy('y')
        .build()
    ).to.throw(/at least one service/)
  })

  it('rejects an algorithm with no container metadata', () => {
    expect(() =>
      new AssetBuilder()
        .setType('algorithm')
        .setName('x')
        .setProvidedBy('y')
        .addService(aService())
        .build()
    ).to.throw(/algorithm\.container/)
  })

  it('deduplicates tags and categories', () => {
    const asset = aBuilder().addTags(['a', 'a']).addTags(['a', 'b']).build()

    expect(asset.ddo.metadata.tags).to.deep.equal(['a', 'b'])
  })

  it('accepts links as an array and stores the v5 map', () => {
    // v4 stored links as string[]; v5 stores a { label: url } record.
    const asset = aBuilder()
      .addLinks(['https://a.example', 'https://b.example'])
      .build()

    expect(Object.values(asset.ddo.metadata.links || {})).to.deep.equal([
      'https://a.example',
      'https://b.example'
    ])
  })

  it('accepts links as a labelled map', () => {
    const asset = aBuilder().addLinks({ docs: 'https://docs.example' }).build()

    expect(asset.ddo.metadata.links).to.deep.equal({
      docs: 'https://docs.example'
    })
  })

  it('setContentLanguage now configures the language tag rather than a metadata field', () => {
    const asset = aBuilder().setContentLanguage('de', 'ltr').build()

    expect(asset.ddo.language).to.deep.equal({
      language: 'de',
      direction: 'ltr'
    })
    expect(asset.ddo.metadata).to.not.have.property('contentLanguage')
  })

  it('defaults the language to en/ltr', () => {
    const asset = aBuilder().build()

    expect(asset.ddo.language).to.deep.equal({
      language: 'en',
      direction: 'ltr'
    })
  })

  it('does not leak NFT data between assets built in the same process', () => {
    // v1 assigned the shared default object by reference, so the second asset inherited
    // the first one's token name.
    const first = aBuilder().setNftTokenName('First NFT').build()
    const second = aBuilder().build()

    expect(first.nftCreateData.name).to.equal('First NFT')
    expect(second.nftCreateData.name).to.not.equal('First NFT')
  })

  it('sets NFT fields individually and wholesale', () => {
    const asset = aBuilder()
      .setNftTokenSymbol('SYM')
      .setNftTokenUri('ipfs://x')
      .setNftTokenTransferable(true)
      .setNftTokenTemplate(1)
      .build()

    expect(asset.nftCreateData.symbol).to.equal('SYM')
    expect(asset.nftCreateData.tokenURI).to.equal('ipfs://x')
    expect(asset.nftCreateData.transferable).to.equal(true)
    expect(asset.nftCreateData.templateIndex).to.equal(1)
  })

  it('requires an owner before NFT params can be produced', () => {
    expect(() => aBuilder().build().getNftParams()).to.throw(/no owner/)
    expect(
      aBuilder().setOwner(OWNER_ADDRESS).build().getNftParams().owner
    ).to.equal(OWNER_ADDRESS)
  })

  it('records the lifecycle state', () => {
    const asset = aBuilder()
      .setLifecycleState(LifecycleStates.ASSET_UNLISTED)
      .build()

    expect(asset.lifecycleState).to.equal(LifecycleStates.ASSET_UNLISTED)
  })

  it('builds address credentials on both lists', () => {
    const asset = aBuilder()
      .addCredentialAddresses(CredentialListTypes.ALLOW, ['0x1'])
      .addCredentialAddresses(CredentialListTypes.DENY, ['0x2'])
      .build()

    expect(asset.ddo.credentials.allow?.[0]).to.deep.equal({
      type: 'address',
      values: [{ address: '0x1' }]
    })
    expect(asset.ddo.credentials.deny?.[0]).to.deep.equal({
      type: 'address',
      values: [{ address: '0x2' }]
    })
  })

  it('removes address credentials again', () => {
    const asset = aBuilder()
      .addCredentialAddresses(CredentialListTypes.ALLOW, ['0x1', '0x2'])
      .removeCredentialAddresses(CredentialListTypes.ALLOW, ['0x1'])
      .build()

    expect(asset.ddo.credentials.allow?.[0]).to.deep.equal({
      type: 'address',
      values: [{ address: '0x2' }]
    })
  })

  it('builds the SSI policy block the policy server expects', () => {
    const asset = aBuilder()
      .addRequestCredentials(CredentialListTypes.ALLOW, [
        { type: 'VerifiableId', format: 'jwt_vc_json' }
      ])
      .setVcPolicies(CredentialListTypes.ALLOW, ['signature'])
      .setVpPolicies(CredentialListTypes.ALLOW, ['holder-binding'])
      .build()

    const entry = asset.ddo.credentials.allow?.find(
      (candidate) => candidate.type === 'SSIpolicy'
    )

    expect(entry).to.exist
    expect(JSON.stringify(entry)).to.contain('request_credentials')
    expect(JSON.stringify(entry)).to.contain('vc_policies')
    expect(JSON.stringify(entry)).to.contain('vp_policies')
  })

  it('sets credential match rules', () => {
    const asset = aBuilder()
      .setCredentialMatchRules({ match_allow: 'any', match_deny: 'all' })
      .build()

    expect(asset.ddo.credentials.match_allow).to.equal('any')
    expect(asset.ddo.credentials.match_deny).to.equal('all')
  })

  it('adds an access-list credential', () => {
    const asset = aBuilder()
      .addCredentialAccessList(CredentialListTypes.ALLOW, {
        chainId: 32456,
        accessList: '0xList'
      })
      .build()

    expect(asset.ddo.credentials.allow?.[0]).to.deep.include({
      type: 'accessList'
    })
  })

  it('sets the issuer', () => {
    expect(
      aBuilder().setIssuer('did:web:example.org').build().ddo.issuer
    ).to.equal('did:web:example.org')
  })
})

describe('AssetBuilder in edit mode', () => {
  it('seeds from a resolved asset, including its owner and state', () => {
    const asset = new AssetBuilder(getAssetFixture()).build()

    expect(asset.owner).to.equal(OWNER_ADDRESS)
    expect(asset.lifecycleState).to.equal(0)
    expect(asset.ddo.getOriginalDDO()).to.exist
  })

  it('carries the published credentials forward', () => {
    const asset = new AssetBuilder(getAssetFixture()).build()

    expect(asset.ddo.credentials.allow?.[0]).to.deep.include({
      type: 'address'
    })
  })

  it('does not require name, type or providedBy, because the baseline has them', () => {
    expect(() => new AssetBuilder(getAssetFixture()).build()).to.not.throw()
  })

  it('drops indexer-derived fields from the baseline immediately', () => {
    const baseline = new AssetBuilder(getAssetFixture())
      .build()
      .ddo.getOriginalDDO()

    expect(baseline).to.not.have.property('indexedMetadata')
    expect(baseline?.credentialSubject).to.not.have.property('datatokens')
  })

  it('exposes the published services', () => {
    const asset = new AssetBuilder(getAssetFixture()).build()

    expect(asset.ddo.getBaselineServices().map((s) => s.id)).to.deep.equal([
      SERVICE_ID
    ])
  })

  it('stages a service removal', () => {
    const asset = new AssetBuilder(getAssetFixture())
      .removeService(SERVICE_ID)
      .build()

    expect(asset.ddo.removeServices).to.deep.equal([SERVICE_ID])
  })

  it('keeps credential mutations out of the resolved asset', () => {
    // `getCredentials()` hands back the asset's own object, and the policy helpers mutate
    // entries in place — seeding by reference wrote builder changes into the caller's asset.
    const source = getAssetFixture()
    const before = structuredClone(source.credentialSubject.credentials)

    new AssetBuilder(source).addCredentialAddresses(CredentialListTypes.ALLOW, [
      '0x2'
    ])

    expect(source.credentialSubject.credentials).to.deep.equal(before)
  })

  it('reset() discards credential mutations instead of replaying them', () => {
    const builder = new AssetBuilder(getAssetFixture())

    builder.addCredentialAddresses(CredentialListTypes.ALLOW, ['0x2'])
    builder.reset()

    const allow = builder.build().ddo.credentials.allow

    expect(
      allow?.find((entry) => entry.type === 'address')?.values
    ).to.deep.equal([{ address: '*' }])
  })

  it('reset() returns to the loaded asset, not to an empty one', () => {
    // v1's reset() discarded the edit-mode state entirely.
    const builder = new AssetBuilder(getAssetFixture())
    builder.setName('Renamed')
    builder.reset()

    const asset = builder.build()

    expect(asset.ddo.metadata.name).to.equal(undefined)
    expect(asset.ddo.getOriginalDDO()).to.exist
    expect(asset.owner).to.equal(OWNER_ADDRESS)
  })
})
