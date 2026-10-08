import { describe, expect, it } from 'vitest'
import { emptyPolicyServerPayload } from '../../src/identity/CredentialProvider.js'
import { MemorySessionStore } from '../../src/identity/session.js'
import {
  WaltIdCredentialProvider,
  type WaltIdCredentialProviderOptions
} from '../../src/identity/WaltIdProvider.js'
import type { WaltIdWallet } from '../../src/identity/waltid/client.js'
import {
  type OceanNodeClient,
  PolicyServerAction
} from '../../src/node/OceanNodeClient.js'
import {
  getAssetFixture,
  OWNER_ADDRESS,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'

const CONTEXT_HASH = 'a'.repeat(64)
const SERVER_SESSION = `${CONTEXT_HASH}-${'b'.repeat(64)}`

interface NodeStub {
  client: OceanNodeClient
  passthroughCalls: { action?: string; sessionId?: string }[]
}

/**
 * A node stub that answers the provider's one policy-server question: the presentation
 * definition. Opening and checking the session is nautilus's job (PolicySession.test.ts).
 */
function nodeStub(
  options: { presentationDefinition?: unknown; nodeUri?: string } = {}
): NodeStub {
  const passthroughCalls: NodeStub['passthroughCalls'] = []

  const client = {
    nodeUri: options.nodeUri ?? 'https://node.test.invalid',

    async policyServerPassthrough(action: {
      action?: string
      sessionId?: string
    }) {
      passthroughCalls.push(action)

      if (action.action === PolicyServerAction.GET_PD)
        return {
          message: options.presentationDefinition ?? { input_descriptors: [] }
        }

      return undefined
    },

    requireSigner() {
      return {
        async getAddress() {
          return OWNER_ADDRESS
        }
      }
    }
  } as unknown as OceanNodeClient

  return { client, passthroughCalls }
}

/** A wallet stub that always matches and always succeeds. */
function walletStub(overrides: Partial<WaltIdWallet> = {}): WaltIdWallet {
  return {
    async authenticate() {
      return { token: 'wallet-token' }
    },
    async isSessionValid() {
      return true
    },
    async logout() {},
    async listWallets() {
      return [{ id: 'wallet-1' }]
    },
    async listKeys() {
      return [{ keyId: { id: 'key-1' } }]
    },
    async listDids() {
      return [{ did: 'did:key:first' }, { did: 'did:key:second' }]
    },
    async sign() {
      return 'jwt'
    },
    async matchCredentials() {
      return [{ id: 'credential-1' }, { id: 'credential-2' }]
    },
    async unmatchedCredentials() {
      return []
    },
    async resolvePresentationRequest() {
      return 'resolved-request'
    },
    async usePresentationRequest() {
      return { redirectUri: 'https://verifier.example/success' }
    },
    ...overrides
  } as WaltIdWallet
}

function provider(
  node: OceanNodeClient,
  wallet: WaltIdWallet,
  options: Partial<WaltIdCredentialProviderOptions> = {}
) {
  return new WaltIdCredentialProvider(node, {
    wallet,
    signer: {
      async getAddress() {
        return OWNER_ADDRESS
      }
    } as never,
    ...options
  })
}

/**
 * A challenge for one node, as `PolicySessionResolver` hands it over: the session is open,
 * and the redirect is the openid4vp request to answer.
 */
function challengeFor(client: OceanNodeClient) {
  return {
    asset: getAssetFixture(),
    serviceId: SERVICE_ID,
    consumerAddress: OWNER_ADDRESS,
    node: client,
    sessionId: SERVER_SESSION,
    redirectUri: 'openid4vp://authorize?state=x'
  }
}

describe('policy server payload', () => {
  it('sends the redirect URIs empty, so the server uses its own defaults', () => {
    expect(emptyPolicyServerPayload('abc')).to.deep.equal({
      sessionId: 'abc',
      successRedirectUri: '',
      errorRedirectUri: '',
      responseRedirectUri: '',
      presentationDefinitionUri: ''
    })
  })
})

describe('WaltIdCredentialProvider', () => {
  it('walks the exchange: getPD for the session, match, resolve, present', async () => {
    const calls: string[] = []
    let resolvedRequest = ''
    const { client, passthroughCalls } = nodeStub({
      presentationDefinition: { input_descriptors: [{ id: 'VerifiableId' }] }
    })

    const wallet = walletStub({
      async matchCredentials() {
        calls.push('match')
        return [{ id: 'credential-1' }]
      },
      async resolvePresentationRequest(_w, request) {
        calls.push('resolve')
        resolvedRequest = request
        return 'resolved'
      },
      async usePresentationRequest() {
        calls.push('present')
        return { redirectUri: 'https://verifier.example/ok' }
      }
    })

    await provider(client, wallet).present(challengeFor(client))

    expect(passthroughCalls).to.deep.equal([
      { action: PolicyServerAction.GET_PD, sessionId: SERVER_SESSION }
    ])
    expect(calls).to.deep.equal(['match', 'resolve', 'present'])
    expect(resolvedRequest).to.equal('openid4vp://authorize?state=x')
  })

  it('asks the node in the challenge for the presentation definition, not its own', async () => {
    // Only the policy server behind the node that opened the session knows it. A provider
    // talking to the node it was constructed with asked a policy server that never saw it.
    const configured = nodeStub()
    const serviceNode = nodeStub({ nodeUri: 'https://service.test.invalid' })

    await provider(configured.client, walletStub()).present(
      challengeFor(serviceNode.client)
    )

    expect(configured.passthroughCalls).to.have.length(0)
    expect(serviceNode.passthroughCalls).to.have.length(1)
  })

  it('never opens a session or checks it itself', async () => {
    const { client, passthroughCalls } = nodeStub()

    await provider(client, walletStub()).present(challengeFor(client))

    expect(passthroughCalls.map((call) => call.action)).to.deep.equal([
      PolicyServerAction.GET_PD
    ])
  })

  it('presents every matching credential by default', async () => {
    let presented: string[] = []
    const { client } = nodeStub()

    const wallet = walletStub({
      async usePresentationRequest(_w, _d, _r, selectedCredentials) {
        presented = selectedCredentials
        return { redirectUri: 'ok' }
      }
    })

    await provider(client, wallet).present(challengeFor(client))

    expect(presented).to.deep.equal(['credential-1', 'credential-2'])
  })

  it('lets a caller choose which credentials to present', async () => {
    let presented: string[] = []
    const { client } = nodeStub()

    const wallet = walletStub({
      async usePresentationRequest(_w, _d, _r, selectedCredentials) {
        presented = selectedCredentials
        return { redirectUri: 'ok' }
      }
    })

    await provider(client, wallet, {
      onSelectCredentials: async (matches) => [matches[1]]
    }).present(challengeFor(client))

    expect(presented).to.deep.equal(['credential-2'])
  })

  it('uses the first DID by default and honours a chooser', async () => {
    const used: string[] = []
    const { client } = nodeStub()

    const wallet = walletStub({
      async usePresentationRequest(_w, did) {
        used.push(did)
        return { redirectUri: 'ok' }
      }
    })

    await provider(client, wallet).present(challengeFor(client))
    await provider(client, wallet, {
      onSelectDid: async (dids) => dids[1].did
    }).present(challengeFor(client))

    expect(used).to.deep.equal(['did:key:first', 'did:key:second'])
  })

  it('names the missing credential when the wallet holds none', async () => {
    const { client } = nodeStub()

    const wallet = walletStub({
      async matchCredentials() {
        return []
      },
      async unmatchedCredentials() {
        return [{ id: 'UniversityDegree' }]
      }
    })

    await expectThrowsAsync(
      () => provider(client, wallet).present(challengeFor(client)),
      /no credential satisfying the requested presentation definition/
    )
  })

  it('fails when the verifier rejects the presentation', async () => {
    const { client } = nodeStub()

    const wallet = walletStub({
      async usePresentationRequest() {
        return { errorMessage: 'policy holder-binding failed' }
      }
    })

    await expectThrowsAsync(
      () => provider(client, wallet).present(challengeFor(client)),
      /policy holder-binding failed/
    )
  })

  it('treats an error redirect as a rejection', async () => {
    const { client } = nodeStub()

    const wallet = walletStub({
      async usePresentationRequest() {
        return { redirectUri: 'https://verifier.example/error?reason=x' }
      }
    })

    await expectThrowsAsync(
      () => provider(client, wallet).present(challengeFor(client)),
      /rejected the presentation/
    )
  })

  it('fails when the policy server sends no presentation definition', async () => {
    const client = {
      ...nodeStub().client,
      async policyServerPassthrough() {
        return {}
      }
    } as unknown as OceanNodeClient

    await expectThrowsAsync(
      () => provider(client, walletStub()).present(challengeFor(client)),
      /returned no presentation definition/
    )
  })

  it('needs either a wallet implementation or a wallet API URL', () => {
    const { client } = nodeStub()

    expect(() => new WaltIdCredentialProvider(client, {})).to.throw(
      /walletApi URL or a wallet implementation/
    )
  })
})

describe('MemorySessionStore', () => {
  const key = {
    did: 'did:ope:a',
    serviceId: 's',
    consumerAddress: '0xAbC',
    nodeUri: 'https://node-a.test.invalid'
  }

  const entry = { sessionId: 'x', createdAt: 1, presented: false }

  it('keys the consumer address as it is: the policy server hashes it case and all', () => {
    const store = new MemorySessionStore()
    store.set(key, entry)

    expect(store.get(key)).to.deep.equal(entry)
    expect(store.get({ ...key, consumerAddress: '0xabc' })).to.equal(undefined)
  })

  it('keeps the time the session was opened and whether it was presented', () => {
    const store = new MemorySessionStore()
    store.set(key, { sessionId: 'x', createdAt: 42, presented: true })

    expect(store.get(key)).to.deep.equal({
      sessionId: 'x',
      createdAt: 42,
      presented: true
    })
  })

  it('cannot be confused by a separator inside a field', () => {
    const store = new MemorySessionStore()
    store.set({ ...key, did: 'a|b', serviceId: 'c' }, entry)

    expect(store.get({ ...key, did: 'a', serviceId: 'b|c' })).to.equal(
      undefined
    )
  })

  it('separates different services', () => {
    const store = new MemorySessionStore()
    store.set(key, entry)

    expect(store.get({ ...key, serviceId: 'other' })).to.equal(undefined)
  })

  it('separates different nodes', () => {
    // A session id is minted by one policy server and meaningless to another.
    const store = new MemorySessionStore()
    store.set(key, entry)

    expect(
      store.get({ ...key, nodeUri: 'https://node-b.test.invalid' })
    ).to.equal(undefined)
  })
})
