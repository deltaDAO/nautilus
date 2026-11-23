import { Wallet } from 'ethers'
import { CompactSign, compactVerify, exportJWK, generateKeyPair } from 'jose'
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
import { createNftWithService, writeMetadata } from '../../src/publish/index.js'
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
    createNftWithService: vi.fn(),
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

async function setup(
  options: {
    didWebHolder?: boolean
    walletId?: string
    corruptSignature?: boolean
  } = {}
) {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const signed: string[] = []
  const gateway = mockGateway({
    didWebHolder: options.didWebHolder ?? true,
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
      if (options.corruptSignature) {
        const [header, payload, encoded] = jws.split('.')
        const signature = Buffer.from(encoded, 'base64url')
        signature[0] ^= 1
        return new Response(
          `${header}.${payload}.${signature.toString('base64url')}`
        )
      }
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
    walletId: options.walletId,
    issuer: ISSUER,
    resolveVerificationKey: (kid) =>
      kid === `${ISSUER}#key-1` ? exportJWK(publicKey) : undefined,
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

function newAsset() {
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
  return new AssetBuilder()
    .setType('dataset')
    .setName('Dataset signed over the gateway')
    .setProvidedBy('deltaDAO AG')
    .setDescription('A description')
    .addService(service)
    .build()
}

describe('publishing with WalletApi2VcSigner', () => {
  it.each([
    [{ didWebHolder: false }, 'did_web_holder_disabled'],
    [{ walletId: 'other-wallet' }, 'wallet_mismatch']
  ] as const)('publish refuses %j before minting', async (options, code) => {
    const { nautilus, signed } = await setup(options)
    const asset = newAsset()

    await expect(nautilus.publish(asset)).rejects.toMatchObject({ code })
    expect(createNftWithService).not.toHaveBeenCalled()
    expect(signed).to.have.length(0)
  })

  it('rejects a corrupted signature before writing metadata', async () => {
    const { nautilus, signed } = await setup({ corruptSignature: true })
    const asset = new AssetBuilder(
      getAssetFixture({ issuer: undefined })
    ).build()
    vi.mocked(writeMetadata).mockClear()
    await expect(nautilus.edit(asset)).rejects.toMatchObject({
      code: 'signature_invalid'
    })
    expect(signed).to.have.length(1)
    expect(writeMetadata).not.toHaveBeenCalled()
  })

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
    const asset = newAsset()
    // As publish() does after minting: the service names its datatoken.
    asset.ddo.services[0].datatokenAddress = DATATOKEN_ADDRESS
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
