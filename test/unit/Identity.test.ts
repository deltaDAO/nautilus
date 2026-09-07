import { describe, expect, it } from 'vitest'
import {
  emptyPolicyServerPayload,
  NoopCredentialProvider,
  StaticCredentialProvider
} from '../../src/identity/CredentialProvider.js'
import { MemorySessionStore } from '../../src/identity/session.js'
import {
  PolicyServerAction,
  WaltIdCredentialProvider,
  type WaltIdCredentialProviderOptions
} from '../../src/identity/WaltIdProvider.js'
import type { WaltIdWallet } from '../../src/identity/waltid/client.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import {
  ASSET_DID,
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
  initializeCalls: unknown[]
}

/** A node stub that plays a policy-server conversation back. */
function nodeStub(options: {
  initiate?: unknown | null
  presentationDefinition?: unknown
  checkSession?: unknown
}): NodeStub {
  const passthroughCalls: NodeStub['passthroughCalls'] = []
  const initializeCalls: unknown[] = []

  const client = {
    nodeUri: 'https://node.test.invalid',

    async initializePolicyVerification(request: unknown) {
      initializeCalls.push(request)
      return options.initiate === undefined ? null : options.initiate
    },

    async policyServerPassthrough(action: {
      action?: string
      sessionId?: string
    }) {
      passthroughCalls.push(action)

      if (action.action === PolicyServerAction.GET_PD)
        return {
          message: options.presentationDefinition ?? { input_descriptors: [] }
        }

      if (action.action === PolicyServerAction.CHECK_SESSION_ID)
        return options.checkSession

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

  return { client, passthroughCalls, initializeCalls }
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

const challenge = {
  asset: getAssetFixture(),
  serviceId: SERVICE_ID,
  consumerAddress: OWNER_ADDRESS
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

describe('NoopCredentialProvider', () => {
  it('resolves nothing, so flows need no null check', async () => {
    expect(await new NoopCredentialProvider().resolve()).to.equal(null)
  })
})

describe('StaticCredentialProvider', () => {
  it('replays a session the caller already holds', async () => {
    const payload = await new StaticCredentialProvider('held-session').resolve()

    expect(payload.sessionId).to.equal('held-session')
  })
})

describe('WaltIdCredentialProvider', () => {
  it('treats a node with no policy-server endpoint as ungated', async () => {
    // initializePSVerification returns null when the node does not advertise it — the
    // clean feature test for "this deployment has no policy server".
    const { client } = nodeStub({})

    expect(await provider(client, walletStub()).resolve(challenge)).to.equal(
      null
    )
  })

  it('short-circuits when the server says verification already succeeded', async () => {
    const { client, passthroughCalls } = nodeStub({
      initiate: {
        message: {
          redirectUri: 'https://policy.example/success?id=existing-session'
        }
      }
    })

    const payload = await provider(client, walletStub()).resolve(challenge)

    expect(payload?.sessionId).to.equal('existing-session')
    // No presentation definition was fetched, and the wallet was never touched.
    expect(passthroughCalls).to.have.length(0)
  })

  it("uses the server's session id, never one of its own", async () => {
    // Policy-server session ids embed sha256(consumerAddress:documentId:serviceId). An
    // invented one is rejected with ADDRESS_NOT_ALLOWED. The ocean-cli gets this wrong.
    const { client } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize?state=ignored-state'
        }
      }
    })

    const payload = await provider(client, walletStub()).resolve(challenge)

    expect(payload?.sessionId).to.equal(SERVER_SESSION)
  })

  it("falls back to the openid4vp 'state' param when no sessionId field is sent", async () => {
    const { client } = nodeStub({
      initiate: {
        message: `openid4vp://authorize?state=${SERVER_SESSION}&response_uri=x`
      }
    })

    const payload = await provider(client, walletStub()).resolve(challenge)

    expect(payload?.sessionId).to.equal(SERVER_SESSION)
  })

  it('walks the exchange: getPD, match, resolve, present', async () => {
    const calls: string[] = []
    const { client, passthroughCalls } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize'
        }
      },
      presentationDefinition: { input_descriptors: [{ id: 'VerifiableId' }] }
    })

    const wallet = walletStub({
      async matchCredentials() {
        calls.push('match')
        return [{ id: 'credential-1' }]
      },
      async resolvePresentationRequest() {
        calls.push('resolve')
        return 'resolved'
      },
      async usePresentationRequest() {
        calls.push('present')
        return { redirectUri: 'https://verifier.example/ok' }
      }
    })

    await provider(client, wallet).resolve(challenge)

    expect(passthroughCalls[0]?.action).to.equal(PolicyServerAction.GET_PD)
    expect(calls).to.deep.equal(['match', 'resolve', 'present'])
  })

  it('presents every matching credential by default', async () => {
    let presented: string[] = []

    const { client } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize'
        }
      }
    })

    const wallet = walletStub({
      async usePresentationRequest(_w, _d, _r, selectedCredentials) {
        presented = selectedCredentials
        return { redirectUri: 'ok' }
      }
    })

    await provider(client, wallet).resolve(challenge)

    expect(presented).to.deep.equal(['credential-1', 'credential-2'])
  })

  it('lets a caller choose which credentials to present', async () => {
    let presented: string[] = []

    const { client } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize'
        }
      }
    })

    const wallet = walletStub({
      async usePresentationRequest(_w, _d, _r, selectedCredentials) {
        presented = selectedCredentials
        return { redirectUri: 'ok' }
      }
    })

    await provider(client, wallet, {
      onSelectCredentials: async (matches) => [matches[1]]
    }).resolve(challenge)

    expect(presented).to.deep.equal(['credential-2'])
  })

  it('uses the first DID by default and honours a chooser', async () => {
    const used: string[] = []

    const { client } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize'
        }
      }
    })

    const wallet = walletStub({
      async usePresentationRequest(_w, did) {
        used.push(did)
        return { redirectUri: 'ok' }
      }
    })

    await provider(client, wallet).resolve(challenge)
    await provider(client, wallet, {
      onSelectDid: async (dids) => dids[1].did
    }).resolve(challenge)

    expect(used).to.deep.equal(['did:key:first', 'did:key:second'])
  })

  it('names the missing credential when the wallet holds none', async () => {
    const { client } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize'
        }
      }
    })

    const wallet = walletStub({
      async matchCredentials() {
        return []
      },
      async unmatchedCredentials() {
        return [{ id: 'UniversityDegree' }]
      }
    })

    await expectThrowsAsync(
      () => provider(client, wallet).resolve(challenge),
      /no credential satisfying the requested presentation definition/
    )
  })

  it('fails when the verifier rejects the presentation', async () => {
    const { client } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize'
        }
      }
    })

    const wallet = walletStub({
      async usePresentationRequest() {
        return { errorMessage: 'policy holder-binding failed' }
      }
    })

    await expectThrowsAsync(
      () => provider(client, wallet).resolve(challenge),
      /policy holder-binding failed/
    )
  })

  it('treats an error redirect as a rejection', async () => {
    const { client } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize'
        }
      }
    })

    const wallet = walletStub({
      async usePresentationRequest() {
        return { redirectUri: 'https://verifier.example/error?reason=x' }
      }
    })

    await expectThrowsAsync(
      () => provider(client, wallet).resolve(challenge),
      /rejected the presentation/
    )
  })

  it('caches the session, so a second access skips the wallet entirely', async () => {
    let matchCount = 0

    const { client } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize'
        }
      }
    })

    const wallet = walletStub({
      async matchCredentials() {
        matchCount++
        return [{ id: 'credential-1' }]
      }
    })

    const instance = provider(client, wallet)

    await instance.resolve(challenge)
    await instance.resolve(challenge)

    expect(matchCount).to.equal(1)
  })

  it('keys the cache by consumer address, not just by asset and service', async () => {
    // The market's cache omits the address, so switching accounts hands the node a
    // session minted for a different requester.
    let matchCount = 0

    const { client } = nodeStub({
      initiate: {
        message: {
          sessionId: SERVER_SESSION,
          redirectUri: 'openid4vp://authorize'
        }
      }
    })

    const wallet = walletStub({
      async matchCredentials() {
        matchCount++
        return [{ id: 'credential-1' }]
      }
    })

    const instance = provider(client, wallet)

    await instance.resolve(challenge)
    await instance.resolve({ ...challenge, consumerAddress: '0xSomeoneElse' })

    expect(matchCount).to.equal(2)
  })

  it('passes documentId and serviceId to the node when initiating', async () => {
    const { client, initializeCalls } = nodeStub({ initiate: null })

    await provider(client, walletStub()).resolve(challenge)

    expect(initializeCalls[0]).to.deep.include({
      documentId: ASSET_DID,
      serviceId: SERVICE_ID,
      consumerAddress: OWNER_ADDRESS
    })
  })

  it('explains a failure by naming the policy that did not pass', async () => {
    const { client } = nodeStub({
      checkSession: {
        message: {
          policyResults: {
            results: [
              {
                policyResults: [
                  { is_success: true, policy: 'signature' },
                  {
                    is_success: false,
                    policy: 'revoked-status-list',
                    description: 'credential is revoked'
                  }
                ]
              }
            ]
          }
        }
      }
    })

    const explanation = await provider(client, walletStub()).explainFailure('s')

    expect(explanation).to.equal('revoked-status-list: credential is revoked')
  })

  it('needs either a wallet implementation or a wallet API URL', () => {
    const { client } = nodeStub({})

    expect(() => new WaltIdCredentialProvider(client, {})).to.throw(
      /walletApi URL or a wallet implementation/
    )
  })
})

describe('MemorySessionStore', () => {
  const key = { did: 'did:ope:a', serviceId: 's', consumerAddress: '0xAbC' }

  it('is case-insensitive on the consumer address', () => {
    const store = new MemorySessionStore()
    store.set(key, { sessionId: 'x', skipped: false })

    expect(store.get({ ...key, consumerAddress: '0xabc' })?.sessionId).to.equal(
      'x'
    )
  })

  it('separates different services', () => {
    const store = new MemorySessionStore()
    store.set(key, { sessionId: 'x', skipped: false })

    expect(store.get({ ...key, serviceId: 'other' })).to.equal(undefined)
  })
})
