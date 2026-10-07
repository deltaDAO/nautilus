/**
 * The transport rule on `OceanNodeClient` itself.
 *
 * `Nautilus.create` refused a plain `http://` node on a non-loopback host, but a client
 * built directly (or through `forEndpoint` for a service's own node) did not, so node auth
 * and the plaintext pointer could still travel in clear.
 */

import { Wallet } from 'ethers'
import { describe, expect, it } from 'vitest'
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

    it('still refuses plain http without it', async () => {
      const error = await createNautilus().catch((thrown: unknown) => thrown)

      expect((error as Error).message).to.match(
        /oceanNodeUri uses plain http:\/\//
      )
    })
  })
})
