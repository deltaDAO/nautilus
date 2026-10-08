/**
 * The transport rule on `OceanNodeClient` itself.
 *
 * `Nautilus.create` refused a plain `http://` node on a non-loopback host, but a client
 * built directly (or through `forEndpoint` for a service's own node) did not, so node auth
 * and the plaintext pointer could still travel in clear.
 */

import { ProviderInstance } from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Nautilus } from '../../src/Nautilus/Nautilus.js'
import {
  OceanNodeClient,
  OceanNodeError
} from '../../src/node/OceanNodeClient.js'

const create = (nodeUri: string, allowInsecureTransport?: boolean) =>
  new OceanNodeClient({
    nodeUri,
    chainId: 32456,
    auth: Wallet.createRandom(),
    allowInsecureTransport
  })

function thrownBy(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

describe('OceanNodeClient transport rule', () => {
  it('refuses plain http on a non-loopback host with an OceanNodeError', () => {
    for (const uri of [
      'http://ocean-node.example.com',
      'HTTP://10.0.0.5:8001/',
      'http://host.docker.internal:8001'
    ]) {
      const error = thrownBy(() => create(uri))

      expect(error, uri).to.be.instanceOf(OceanNodeError)
      expect((error as OceanNodeError).operation).to.equal('create')
      expect((error as Error).message).to.match(
        /^\[ocean-node\] create: nodeUri uses plain http:\/\/ .*allowInsecureTransport: true/
      )
    }
  })

  it('refuses the spellings fetch reads as plain http://', () => {
    for (const uri of [
      'http:ocean-node.example.com',
      'http:/ocean-node.example.com',
      'http:\\\\ocean-node.example.com',
      'ht\ttp://ocean-node.example.com',
      'http\n://ocean-node.example.com'
    ]) {
      const error = thrownBy(() => create(uri))

      expect(error, JSON.stringify(uri)).to.be.instanceOf(OceanNodeError)
      expect((error as Error).message, JSON.stringify(uri)).to.match(
        /^\[ocean-node\] create: nodeUri (uses plain http:\/\/|contains a control character)/
      )
    }
  })

  it('accepts https, loopback http and P2P node ids', () => {
    for (const uri of [
      'https://ocean-node.example.com',
      'http://localhost:8001',
      'http://127.0.0.1:8001',
      'http://[::1]:8001',
      'http://node.localhost:8001',
      '16Uiu2HAmPeerIdOnly',
      '/ip4/10.0.0.5/tcp/9000/p2p/16Uiu2HAmPeerIdOnly'
    ])
      expect(create(uri).nodeUri, uri).to.equal(uri)
  })

  it('accepts plain http anywhere with allowInsecureTransport: true', () => {
    expect(create('http://ocean-node.example.com', true).nodeUri).to.equal(
      'http://ocean-node.example.com'
    )
  })

  it('rejects an http URL that does not parse', () => {
    expect(thrownBy(() => create('http://'))).to.be.instanceOf(OceanNodeError)
  })

  describe('a per-call nodeUri (a service endpoint)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    const FILE = { type: 'url', url: 'https://data.example/x', method: 'GET' }

    it('refuses plain http in encrypt and getFileInfo before sending anything', async () => {
      const encrypt = vi.spyOn(ProviderInstance, 'encrypt')
      const fileInfo = vi.spyOn(ProviderInstance, 'getFileInfo')
      const client = create('https://ocean-node.example.com')

      for (const endpoint of [
        'http://other-node.example.com',
        'http:other-node.example.com'
      ]) {
        const encrypted = await client
          .encrypt({ a: 1 }, undefined, undefined, endpoint)
          .catch((thrown: unknown) => thrown)
        const checked = await client
          .getFileInfo(FILE as never, false, undefined, endpoint)
          .catch((thrown: unknown) => thrown)

        expect(encrypted, endpoint).to.be.instanceOf(OceanNodeError)
        expect((encrypted as OceanNodeError).operation).to.equal('encrypt')
        expect((encrypted as Error).message).to.match(
          /nodeUri uses plain http:\/\/.*allowInsecureTransport: true/
        )
        expect(checked, endpoint).to.be.instanceOf(OceanNodeError)
        expect((checked as OceanNodeError).operation).to.equal('getFileInfo')
      }

      expect(encrypt).not.toHaveBeenCalled()
      expect(fileInfo).not.toHaveBeenCalled()
    })

    it('sends to https and loopback endpoints, and anywhere with allowInsecureTransport', async () => {
      const encrypt = vi
        .spyOn(ProviderInstance, 'encrypt')
        .mockResolvedValue('0xabcd')
      const fileInfo = vi
        .spyOn(ProviderInstance, 'getFileInfo')
        .mockResolvedValue([])

      const strict = create('https://ocean-node.example.com')
      for (const endpoint of [
        'https://other-node.example.com',
        'http://127.0.0.1:8001'
      ]) {
        expect(
          await strict.encrypt({ a: 1 }, undefined, undefined, endpoint)
        ).to.equal('0xabcd')
        await strict.getFileInfo(FILE as never, false, undefined, endpoint)
      }

      const insecure = create('https://ocean-node.example.com', true)
      await insecure.encrypt(
        { a: 1 },
        undefined,
        undefined,
        'http://other-node.example.com'
      )
      await insecure.getFileInfo(
        FILE as never,
        false,
        undefined,
        'http://other-node.example.com'
      )

      expect(encrypt).toHaveBeenCalledTimes(3)
      expect(fileInfo).toHaveBeenCalledTimes(3)
    })
  })

  describe('forEndpoint', () => {
    it('applies the rule to the other node', () => {
      const client = create('https://ocean-node.example.com')

      expect(
        thrownBy(() => client.forEndpoint('http://other-node.example.com'))
      ).to.be.instanceOf(OceanNodeError)
      expect(
        client.forEndpoint('https://other-node.example.com').nodeUri
      ).to.equal('https://other-node.example.com')
      expect(client.forEndpoint('http://127.0.0.1:8001/').nodeUri).to.equal(
        'http://127.0.0.1:8001'
      )
    })

    it('carries allowInsecureTransport over', () => {
      const client = create('http://ocean-node.example.com', true)

      expect(
        client.forEndpoint('http://other-node.example.com').nodeUri
      ).to.equal('http://other-node.example.com')
    })
  })

  describe('through Nautilus.create', () => {
    const ADDRESS = '0x0000000000000000000000000000000000000001'

    const createNautilus = (allowInsecureTransport?: boolean) =>
      Nautilus.create(
        Wallet.createRandom().connect({
          getNetwork: async () => ({ chainId: 32456n })
        } as never),
        {
          allowInsecureTransport,
          config: {
            oceanNodeUri: 'http://ocean-node.example.com',
            nftFactoryAddress: ADDRESS,
            fixedRateExchangeAddress: ADDRESS,
            dispenserAddress: ADDRESS
          }
        }
      )

    it('hands allowInsecureTransport to its node client', async () => {
      const node = (await createNautilus(true)).getNodeClient()

      expect(node.nodeUri).to.equal('http://ocean-node.example.com')
      expect(
        node.forEndpoint('http://other-node.example.com').nodeUri
      ).to.equal('http://other-node.example.com')
    })

    it('hands requestTimeoutMs to its node client', async () => {
      const nautilus = await Nautilus.create(
        Wallet.createRandom().connect({
          getNetwork: async () => ({ chainId: 32456n })
        } as never),
        {
          requestTimeoutMs: 4321,
          config: {
            oceanNodeUri: 'https://ocean-node.example.com',
            nftFactoryAddress: ADDRESS,
            fixedRateExchangeAddress: ADDRESS,
            dispenserAddress: ADDRESS
          }
        }
      )

      expect(
        (nautilus.getNodeClient() as unknown as { requestTimeoutMs: number })
          .requestTimeoutMs
      ).to.equal(4321)
    })

    it('still refuses plain http without it', async () => {
      const error = await createNautilus().catch((thrown: unknown) => thrown)

      expect((error as Error).message).to.match(
        /oceanNodeUri uses plain http:\/\//
      )
    })
  })
})
