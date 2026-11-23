import { Wallet } from 'ethers'
import { CompactSign, compactVerify, generateKeyPair } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import { validate } from '../../src/ddo/index.js'
import { AddressSignIn } from '../../src/identity/waltid/addressSignIn.js'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import { Nautilus } from '../../src/Nautilus/Nautilus.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { assertSignedDdo } from '../../src/publish/envelope.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import { decodeCredential } from '../../src/signing/vc.js'
import { WalletApi2VcSigner } from '../../src/signing/walletApi2.js'
import {
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  getAssetFixture,
  NFT_ADDRESS,
  OWNER_ADDRESS
} from '../fixtures/Asset.js'
import {
  fakeProvider,
  GATEWAY,
  ISSUER,
  KEY,
  mockGateway
} from '../mocks/addressGateway.js'
import { createNodeMock } from '../mocks/node.js'

/**
 * Publishing with the real WalletApi2VcSigner: the projected DDO goes through
 * `prepareDocument`, the real SHACL validation (not mocked here), the address gateway's
 * sign route (a real ES256 JWS over the exact body) and `assertSignedDdo`. Only the chain
 * writes are stubbed, as in PublishIssuer.test.ts.
 */

vi.mock('../../src/publish/index.js', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    writeMetadata: vi.fn(async () => ({ hash: '0xsetmetadata' })),
    waitForMetadataPermission: vi.fn(async () => undefined)
  }
})

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    Nft: class {
      async getMetadata() {
        return ['https://node.test.invalid', '0x', 0, true]
      }
      async getNftPermissions() {
        return {
          manager: true,
          deployERC20: true,
          updateMetadata: true,
          store: true
        }
      }
    }
  }
})

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const signed: string[] = []
  const gateway = mockGateway({
    ddoSigning: true,
    scopes: ['present', 'sign-ddo'],
    handle: async (call) => {
      if (!call.path.endsWith('/sign')) return undefined
      signed.push(call.body)
      const jws = await new CompactSign(new TextEncoder().encode(call.body))
        .setProtectedHeader({
          alg: 'ES256',
          typ: 'JWT',
          kid: `${ISSUER}#key-1`
        })
        .sign(privateKey)
      return new Response(jws, { status: 200 })
    }
  })
  const signIn = new AddressSignIn({
    gateway: GATEWAY,
    signer: new Wallet(KEY, fakeProvider()),
    scopes: ['present', 'sign-ddo'],
    fetchImpl: gateway.fetchImpl as unknown as typeof fetch
  })
  const ddoSigner = new WalletApi2VcSigner({
    signIn,
    keyId: 'key-1',
    issuer: ISSUER,
    fetchImpl: gateway.fetchImpl as unknown as typeof fetch
  })

  const wallet = new Wallet(
    '0x0123456789012345678901234567890123456789012345678901234567890123'
  )
  const signer = wallet.connect({
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) })
  } as never)
  const remoteStore = {
    put: async () => ({
      type: 'url',
      url: 'https://store.test.invalid/ddo',
      method: 'GET'
    })
  } as unknown as RemoteStore
  const nautilus = await Nautilus.create(signer, {
    remoteStore,
    ddoSigner,
    config: {
      oceanNodeUri: 'https://node.test.invalid',
      nftFactoryAddress: NFT_ADDRESS,
      fixedRateExchangeAddress: DATATOKEN_ADDRESS,
      dispenserAddress: OWNER_ADDRESS
    }
  })
  ;(nautilus as unknown as { node: OceanNodeClient }).node =
    createNodeMock().client
  return { nautilus, publicKey, signed, gateway }
}

async function check(
  response: { ddo: Record<string, unknown>; credential?: { jwt: string } },
  publicKey: CryptoKey | Parameters<typeof compactVerify>[1],
  signed: string[]
) {
  const jwt = response.credential?.jwt as string
  // A real signature over exactly what was posted
  const { payload } = await compactVerify(jwt, publicKey as never)
  expect(new TextDecoder().decode(payload)).to.equal(signed[0])
  // Only the fields wallet-api2 accepts, no JWT claims
  const body = JSON.parse(signed[0])
  expect(Object.keys(body)).to.have.members([
    '@context',
    'id',
    'type',
    'issuer',
    'version',
    'credentialSubject'
  ])
  expect(body.credentialSubject).not.to.have.any.keys(
    'id',
    'version',
    'datatokens'
  )
  // The document returned is the document validated and signed
  expect(decodeCredential(jwt)).to.deep.equal(
    JSON.parse(JSON.stringify(response.ddo))
  )
  expect(() => assertSignedDdo(jwt, response.ddo)).not.to.throw()
  expect((await validate(response.ddo)).valid).to.equal(true)
  expect(response.ddo.issuer).to.equal(ISSUER)
}

describe('publishing with WalletApi2VcSigner', () => {
  it('edit: prepares, validates, signs over the gateway and checks the JWS', async () => {
    const { nautilus, publicKey, signed, gateway } = await setup()
    const asset = new AssetBuilder(
      getAssetFixture({ issuer: undefined })
    ).build()

    const response = await nautilus.edit(asset)

    expect(signed).to.have.length(1)
    expect(gateway.problems).to.deep.equal([])
    await check(response as never, publicKey, signed)
  })

  it('publish: the metadata write of a new asset does the same', async () => {
    const { nautilus, publicKey, signed } = await setup()
    const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      serviceType: ServiceTypes.ACCESS
    })
      .setServiceEndpoint('https://node.test.invalid')
      .setName('Access Service')
      .setPricing({ type: 'free' })
      .addFile({
        type: 'url',
        url: 'https://data.test.invalid/file.csv',
        method: 'GET'
      })
      .build()
    // As publish() does after minting: the service names its datatoken.
    service.datatokenAddress = DATATOKEN_ADDRESS
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Dataset signed over the gateway')
      .setProvidedBy('deltaDAO AG')
      .setDescription('A description')
      .addService(service)
      .build()
    const internals = nautilus as unknown as {
      writeAsset(params: Record<string, unknown>): Promise<{
        ddo: Record<string, unknown>
        credential?: { jwt: string }
      }>
      options: { ddoSigner: unknown }
    }

    const response = await internals.writeAsset({
      asset,
      nftAddress: NFT_ADDRESS,
      create: true,
      lifecycleState: 0,
      remoteStore: {
        put: async () => ({
          type: 'url',
          url: 'https://store.test.invalid/ddo',
          method: 'GET'
        })
      },
      ddoSigner: internals.options.ddoSigner,
      issuer: ISSUER,
      log: { emit: () => undefined, child: () => undefined }
    })

    await check(response, publicKey, signed)
  })
})
