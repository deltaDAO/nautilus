/**
 * A rejected presentation (N3 of the beta.2 run): the wallet's 400 answer carries the
 * verifier's error page, `…/error?id=<policy-server session id>`, and says only
 * "Presentation failed". nautilus keeps the wallet's message alone, asks the verifier's
 * record which policy failed, and names it.
 *
 * The wallet is the real `WaltIdHttpWallet` against a stubbed `fetch`, the provider the real
 * `WaltIdCredentialProvider`, the resolver the real `PolicySessionResolver`; the node is a
 * stub, except where the real `OceanNodeClient` reads a hostile verifier record.
 */

import { ProviderInstance } from '@oceanprotocol/lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialProvider } from '../../src/identity/CredentialProvider.js'
import { PolicySessionResolver } from '../../src/identity/PolicySessionResolver.js'
import { addRequestCredentials } from '../../src/identity/policy.js'
import { MemorySessionStore } from '../../src/identity/session.js'
import {
  CredentialPresentationError,
  WaltIdCredentialProvider
} from '../../src/identity/WaltIdProvider.js'
import {
  WaltIdHttpWallet,
  type WaltIdWallet
} from '../../src/identity/waltid/client.js'
import { setDebug } from '../../src/log/debug.js'
import { redactSecrets, sessionIdRemover } from '../../src/node/messages.js'
import {
  OceanNodeClient,
  PolicyDeniedError,
  PolicyServerAction,
  type PolicySessionCheck
} from '../../src/node/OceanNodeClient.js'
import {
  CHAIN_ID,
  getAssetFixture,
  OWNER_ADDRESS,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { cpuBudget, cpuTime } from '../helpers.js'
import { FAKE } from '../secretScan.js'

const NODE = 'https://node.test.invalid'
const SID = FAKE.sessionId
const VERIFIER = 'verifier.internal.test.invalid'
/** walt.id's answer when the verifier refused the presentation (`ExchangeController`). */
const VERIFIER_400 = JSON.stringify({
  redirectUri: `http://${VERIFIER}:7003/error?id=${SID}&state=${SID}`,
  errorMessage: 'Presentation failed - redirecting to error page'
})
/** The verifier's record of the session: only `holder-binding` failed, on a credential without `sub`. */
const HOLDER_BINDING_NPE: PolicySessionCheck = {
  verified: false,
  policyResults: [
    {
      credential: 'VerifiablePresentation',
      policy: 'signature',
      success: true
    },
    {
      credential: 'VerifiablePresentation',
      policy: 'holder-binding',
      success: false,
      error: 'java.lang.NullPointerException'
    },
    { credential: 'VerifiableId', policy: 'signature', success: true }
  ]
}

/** A real HTTP wallet whose `usePresentationRequest` is answered with `body`. */
function httpWallet(status: number, body: string) {
  return new WaltIdHttpWallet({
    apiUrl: 'https://wallet.test.invalid',
    fetchImpl: (async () => new Response(body, { status })) as typeof fetch
  })
}

/** A wallet that holds a `VerifiableId` and presents through `http`. */
function walletPresentingThrough(http: WaltIdHttpWallet): WaltIdWallet {
  return {
    authenticate: async () => ({ token: 'session-token' }),
    isSessionValid: async () => true,
    logout: async () => undefined,
    listWallets: async () => [{ id: 'wallet-1' }],
    listKeys: async () => [],
    listDids: async () => [{ did: 'did:key:holder' }],
    sign: async () => 'jwt',
    matchCredentials: async () => [
      {
        id: 'credential-1',
        parsedDocument: { type: ['VerifiableCredential', 'VerifiableId'] }
      }
    ],
    unmatchedCredentials: async () => [],
    resolvePresentationRequest: async () => 'openid4vp://resolved',
    usePresentationRequest: http.usePresentationRequest.bind(http)
  }
}

/** An asset whose `SSIpolicy` asks for a `VerifiableId`. */
function ssiAsset() {
  const asset = getAssetFixture()
  asset.credentialSubject.credentials = addRequestCredentials(
    asset.credentialSubject.credentials as never,
    'allow' as never,
    [{ type: 'VerifiableId', format: 'jwt_vc_json' }]
  ) as never
  return asset
}

/**
 * A node with a policy server that opens session `SID` and answers `checkSessionId` with
 * `check` (or throws it).
 */
function policyNode(check: PolicySessionCheck | Error) {
  const calls = { initiate: 0, checked: [] as string[] }
  const openid4vp = `openid4vp://authorize?${new URLSearchParams({
    response_type: 'vp_token',
    state: SID,
    response_mode: 'direct_post',
    presentation_definition_uri: `https://ps.test.invalid/pd/${SID}`,
    response_uri: `https://ps.test.invalid/verify/${SID}`
  })}`

  const node = {
    nodeUri: NODE,
    policySessionAddress: (address: string) => address,
    hasPolicyServer: async () => true,
    initializePolicyVerification: async () => {
      calls.initiate++
      return {
        success: true,
        httpStatus: 200,
        message: { sessionId: SID, redirectUri: openid4vp }
      }
    },
    checkPolicySession: async (sessionId: string) => {
      calls.checked.push(sessionId)
      if (check instanceof Error) throw check
      return check
    },
    policyServerPassthrough: async (action: { action?: string }) =>
      action.action === PolicyServerAction.GET_PD
        ? {
            message: {
              id: 'definition',
              input_descriptors: [
                {
                  id: 'VerifiableId',
                  constraints: {
                    fields: [
                      {
                        path: ['$.vc.type'],
                        filter: { type: 'string', pattern: 'VerifiableId' }
                      }
                    ]
                  }
                }
              ]
            }
          }
        : undefined
  } as unknown as OceanNodeClient

  return { node, calls }
}

function waltIdProvider(node: OceanNodeClient, wallet: WaltIdWallet) {
  return new WaltIdCredentialProvider(node, {
    wallet,
    signer: { getAddress: async () => OWNER_ADDRESS } as never
  })
}

function resolve(node: OceanNodeClient, resolver: PolicySessionResolver) {
  return resolver.resolve({
    node,
    asset: ssiAsset(),
    serviceId: SERVICE_ID,
    consumerAddress: OWNER_ADDRESS
  })
}

/** Everything an error carries that a caller could log: message, fields, and its causes. */
function everything(error: unknown): string {
  const parts: string[] = []
  let current = error as Record<string, unknown> | undefined
  for (let depth = 0; current && depth < 10; depth++) {
    parts.push(
      String(current.message),
      String(current.stack),
      JSON.stringify({
        details: current.details,
        reason: current.reason,
        policyResults: current.policyResults
      })
    )
    current = current.cause as Record<string, unknown> | undefined
  }
  return parts.join('\n')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the wallet's 400 answer to a presentation", () => {
  it('keeps only the errorMessage: no redirect URI, session id or verifier host', async () => {
    const result = await httpWallet(400, VERIFIER_400).usePresentationRequest(
      'wallet-1',
      'did:key:holder',
      'openid4vp://resolved',
      ['credential-1'],
      'session-token'
    )

    expect(result).to.deep.equal({
      errorMessage: 'Presentation failed - redirecting to error page',
      rejectedBy: 'verifier'
    })
  })

  it("reads a 400 without a redirectUri as the wallet's own failure", async () => {
    const result = await httpWallet(
      400,
      JSON.stringify({ errorMessage: 'No DID to use supplied' })
    ).usePresentationRequest('w', 'did', 'req', ['c'], 'session-token')

    expect(result).to.deep.equal({
      errorMessage: 'No DID to use supplied',
      rejectedBy: 'wallet'
    })
  })

  it('redacts and bounds the errorMessage, and keeps nothing of a body that is not JSON', async () => {
    const hostile = await httpWallet(
      400,
      JSON.stringify({
        redirectUri: null,
        errorMessage: `\u001b[31mfailed\u001b[0m at https://${VERIFIER}/error?id=${SID} ${FAKE.jwt} ${'x'.repeat(2000)}`
      })
    ).usePresentationRequest('w', 'did', 'req', ['c'], 'session-token')

    expect(hostile.rejectedBy).to.equal('verifier')
    expect(hostile.errorMessage).to.match(/^failed at https:\/\/verifier/)
    expect(hostile.errorMessage?.length).to.be.at.most(501)
    expect(hostile.errorMessage).not.to.contain('\u001b')
    expect(hostile.errorMessage).not.to.match(/error\?id=|eyJ/)
    expect(hostile.errorMessage).not.to.contain(SID)

    const text = await httpWallet(
      400,
      `<html>error?id=${SID}</html>`
    ).usePresentationRequest('w', 'did', 'req', ['c'], 'session-token')
    expect(text).to.deep.equal({
      errorMessage: "the wallet's answer is not JSON (HTTP 400)",
      rejectedBy: 'wallet'
    })
  })

  it('throws a CredentialPresentationError with reason verifier-rejected and details.errorMessage only', async () => {
    const { node } = policyNode(HOLDER_BINDING_NPE)
    const challenge = {
      asset: ssiAsset(),
      serviceId: SERVICE_ID,
      consumerAddress: OWNER_ADDRESS,
      node,
      sessionId: SID,
      redirectUri: `openid4vp://authorize?${new URLSearchParams({
        response_uri: `https://ps.test.invalid/verify/${SID}`
      })}`
    }

    const thrown = await waltIdProvider(
      node,
      walletPresentingThrough(httpWallet(400, VERIFIER_400))
    )
      .present(challenge)
      .catch((error) => error)

    expect(thrown).to.be.instanceOf(CredentialPresentationError)
    expect(thrown.reason).to.equal('verifier-rejected')
    expect(thrown.message).to.equal(
      'The verifier rejected the presentation: Presentation failed - redirecting to error page'
    )
    expect(thrown.details).to.deep.equal({
      errorMessage: 'Presentation failed - redirecting to error page'
    })
    expect(everything(thrown)).not.to.match(/error\?id=|redirectUri/)
    expect(everything(thrown)).not.to.contain(VERIFIER)
    expect(everything(thrown)).not.to.contain(SID)
  })
})

describe('a failed presentation names the failed policy', () => {
  it('throws a PolicyDeniedError naming holder-binding: java.lang.NullPointerException, without the session id or the verifier', async () => {
    const { node, calls } = policyNode(HOLDER_BINDING_NPE)
    const resolver = new PolicySessionResolver({
      credentials: waltIdProvider(
        node,
        walletPresentingThrough(httpWallet(400, VERIFIER_400))
      )
    })

    const thrown = await resolve(node, resolver).catch((error) => error)

    expect(calls.checked).to.deep.equal([SID])
    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.reason).to.equal(
      'the node reports that the verifier did not accept the presentation (holder-binding: java.lang.NullPointerException)'
    )
    expect(thrown.message).to.contain(
      'holder-binding: java.lang.NullPointerException'
    )
    expect(thrown.policyResults).to.deep.equal(HOLDER_BINDING_NPE.policyResults)
    expect(thrown.cause).to.be.instanceOf(CredentialPresentationError)
    expect(thrown.cause.reason).to.equal('verifier-rejected')
    expect(thrown.cause.details.errorMessage).to.equal(
      'Presentation failed - redirecting to error page'
    )

    const text = everything(thrown)
    expect(text).not.to.contain(SID)
    expect(text).not.to.contain('error?id=')
    expect(text).not.to.contain(VERIFIER)
  })

  it('rethrows the original error when the verifier reports no failed policy', async () => {
    const failure = new CredentialPresentationError(
      'The verifier rejected the presentation: Presentation failed - redirecting to error page',
      { errorMessage: 'Presentation failed - redirecting to error page' },
      'verifier-rejected'
    )
    const credentials: CredentialProvider = {
      present: async () => {
        throw failure
      }
    }

    for (const check of [
      { verified: false, policyResults: [] },
      {
        verified: false,
        policyResults: [{ policy: 'signature', success: true }]
      },
      { verified: true, policyResults: HOLDER_BINDING_NPE.policyResults }
    ]) {
      const { node, calls } = policyNode(check)
      const thrown = await resolve(
        node,
        new PolicySessionResolver({ credentials })
      ).catch((error) => error)

      expect(calls.checked).to.deep.equal([SID])
      expect(thrown).to.equal(failure)
    }
  })

  it('rethrows the original error when the check itself fails', async () => {
    const failure = new CredentialPresentationError(
      'The verifier rejected the presentation.',
      undefined,
      'verifier-rejected'
    )
    const { node, calls } = policyNode(new Error('node unreachable'))

    const thrown = await resolve(
      node,
      new PolicySessionResolver({
        credentials: {
          present: async () => {
            throw failure
          }
        }
      })
    ).catch((error) => error)

    expect(calls.checked).to.deep.equal([SID])
    expect(thrown).to.equal(failure)
  })

  it('caches no rejected session: the next attempt opens a new one', async () => {
    const { node, calls } = policyNode(HOLDER_BINDING_NPE)
    const store = new MemorySessionStore()
    const resolver = new PolicySessionResolver({
      credentials: waltIdProvider(
        node,
        walletPresentingThrough(httpWallet(400, VERIFIER_400))
      ),
      sessionStore: store,
      persistPresentedSessions: true
    })

    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        await resolve(node, resolver).catch((error) => error)
      ).to.be.instanceOf(PolicyDeniedError)

    expect(calls.initiate).to.equal(2)
    expect(
      store.get({
        nodeUri: NODE,
        did: ssiAsset().id,
        serviceId: SERVICE_ID,
        consumerAddress: OWNER_ADDRESS
      })
    ).to.equal(undefined)
  })

  it('lists what fits of many failed policies and counts the rest', async () => {
    const policyResults = Array.from({ length: 12 }, (_, index) => ({
      policy: `policy-${index}`,
      success: false,
      error: `failure number ${index} ${'detail '.repeat(20)}`
    }))
    const { node } = policyNode({ verified: false, policyResults })

    const thrown = await resolve(
      node,
      new PolicySessionResolver({
        credentials: {
          present: async () => {
            throw new Error('Presentation failed')
          }
        }
      })
    ).catch((error) => error)

    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.reason).to.match(
      /^the node reports that the verifier did not accept the presentation \(policy-0: failure number 0 .*; \d+ more in policyResults\)$/
    )
    expect(thrown.policyResults).to.have.length(12)
  })
})

describe("the node's per-policy results", () => {
  it('bounds a hostile record: at most 50 results, failures kept, no control characters, names bounded', async () => {
    const ansi = '\u001b[2J\u001b]8;;https://evil.test.invalid\u0007'
    const results = [
      {
        credential: `${ansi}VerifiableId${'y'.repeat(500)}`,
        policyResults: Array.from({ length: 1000 }, (_, index) => ({
          policy: `${ansi}policy-${index}\u202e${'z'.repeat(100)}`,
          is_success: index !== 999,
          error:
            index === 999
              ? `${ansi}refused\nat java.lang.Thread.run(${SID})`
              : null
        }))
      }
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              httpStatus: 200,
              message: {
                verificationResult: false,
                policyResults: { results }
              }
            }),
            { status: 200 }
          )
      )
    )

    // A 2xx answer: an error answer is cut at 64 KiB, before it could hold this many.
    const check = await new OceanNodeClient({
      nodeUri: NODE,
      chainId: CHAIN_ID,
      auth: 'a-session-token',
      consumerAddress: OWNER_ADDRESS
    }).checkPolicySession(SID)

    expect(check.verified).to.equal(false)
    expect(check.policyResults).to.have.length(50)
    expect(
      check.policyResults.filter((result) => !result.success)
    ).to.have.length(1)
    const failed = check.policyResults.find((result) => !result.success)
    expect(failed?.policy.startsWith('policy-999')).to.equal(true)
    expect(failed?.error).to.equal('refused')

    for (const result of check.policyResults) {
      expect(result.policy.length).to.be.at.most(101)
      expect(result.credential?.length).to.be.at.most(101)
      expect(JSON.stringify(result)).not.to.match(
        /\\u001b|\\u0007|\u202e|evil\.test/
      )
    }
  })
})

describe("a hostile node's per-policy results, in bounded time", () => {
  it('reads a 256 KB record in milliseconds, over HTTP and over P2P (security regression)', async () => {
    // Fields built to be slow: a run of hex (`a`) with a separator just before 8,192, the
    // read limit every field used to have. A session-id pattern that looked back over the
    // run and a cut-word drop that rescanned it made such a record cost 3.8 s over HTTP and
    // 18 s over P2P, on every gated access. Names and errors are now read at 8 times their
    // bound (800 characters), so each field costs little.
    const field = `${'a'.repeat(8_190)} bx`
    const record = (entries: number) => ({
      success: true,
      httpStatus: 200,
      message: {
        verificationResult: false,
        policyResults: {
          results: Array.from({ length: entries }, (_, index) => ({
            credential: field,
            policyResults: [
              { policy: `${field}${index}`, is_success: false, error: field }
            ]
          }))
        }
      }
    })
    // Over HTTP a 2xx answer is read up to 256 KiB.
    const body = JSON.stringify(record(10))
    expect(body.length).to.be.within(240_000, 256 * 1024)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 }))
    )
    // Over P2P ocean.js sets no size limit; the client keeps 50 results.
    vi.spyOn(ProviderInstance, 'PolicyServerPassthrough').mockResolvedValue(
      record(50) as never
    )
    // The reading is timed, not the debug channel's hand-over of each raw field, which
    // runs only when a user turns debug on: off here, also under NAUTILUS_TEST_DEBUG.
    setDebug({ level: 'off' })

    for (const [label, nodeUri, entries] of [
      ['HTTP', NODE, 10],
      ['P2P', '16Uiu2HAmPeer', 50]
    ] as const) {
      const client = new OceanNodeClient({
        nodeUri,
        chainId: CHAIN_ID,
        auth: 'a-session-token',
        consumerAddress: OWNER_ADDRESS
      })
      let check: PolicySessionCheck | undefined
      const elapsed = await cpuTime(async () => {
        check = await client.checkPolicySession(SID)
      })

      expect(elapsed, label).to.be.below(cpuBudget(50))
      expect(check?.policyResults, label).to.have.length(entries)
      for (const result of check?.policyResults ?? []) {
        expect(result.policy.length).to.be.at.most(101)
        expect(result.credential?.length ?? 0).to.be.at.most(101)
        expect(result.error?.length ?? 0).to.be.at.most(101)
      }
    }
  })
})

describe("a huge session id in the node's per-policy results, in bounded time", () => {
  it('is removed from 300 cut fields in milliseconds (security regression)', async () => {
    // The node chooses the id, and `checkPolicySession` removes it from each policy and
    // credential name and each error, twice. Folding the letter case of the whole id and
    // reading all of it for the start a cut left, for each field, cost 6 s for 50 results
    // with a 500 KB id.
    const sessionId = `${'Q'.repeat(500_000)}e-${'f'.repeat(40)}`
    const field = `${'x'.repeat(50)}-${'q'.repeat(49)}…`

    let removed: string[] = []
    const elapsed = await cpuTime(async () => {
      const remove = sessionIdRemover(sessionId)
      removed = Array.from({ length: 300 }, () => remove(field))
    })

    expect(elapsed).to.be.below(cpuBudget(50))
    for (const text of removed)
      expect(text).to.equal(`${'x'.repeat(50)}-<redacted>…`)

    // And through the client: each error is cut at 100 characters inside the id's start.
    vi.spyOn(ProviderInstance, 'PolicyServerPassthrough').mockResolvedValue({
      success: false,
      httpStatus: 400,
      message: {
        verificationResult: false,
        policyResults: {
          results: Array.from({ length: 50 }, () => ({
            credential: 'VerifiableId',
            policyResults: [
              {
                policy: 'signature',
                is_success: false,
                error: `${'x'.repeat(50)}-${'q'.repeat(700)}`
              }
            ]
          }))
        }
      }
    } as never)
    const check = await new OceanNodeClient({
      nodeUri: '16Uiu2HAmPeer',
      chainId: CHAIN_ID,
      auth: 'a-session-token',
      consumerAddress: OWNER_ADDRESS
    }).checkPolicySession(sessionId)

    expect(check.policyResults).to.have.length(50)
    for (const result of check.policyResults)
      expect(result.error).to.equal(`${'x'.repeat(50)}-<redacted>…`)
  })
})

describe("CredentialPresentationError's reason", () => {
  it('says which step failed', async () => {
    const { node } = policyNode(HOLDER_BINDING_NPE)
    const challenge = {
      asset: ssiAsset(),
      serviceId: SERVICE_ID,
      consumerAddress: OWNER_ADDRESS,
      node,
      sessionId: SID,
      redirectUri: `openid4vp://authorize?${new URLSearchParams({
        response_uri: `https://ps.test.invalid/verify/${SID}`
      })}`
    }
    const base = walletPresentingThrough(httpWallet(400, VERIFIER_400))
    const reasonOf = (
      wallet: Partial<WaltIdWallet>,
      redirectUri = challenge.redirectUri
    ) =>
      waltIdProvider(node, { ...base, ...wallet })
        .present({ ...challenge, redirectUri })
        .catch((error: CredentialPresentationError) => error.reason)

    expect(await reasonOf({ matchCredentials: async () => [] })).to.equal(
      'no-matching-credential'
    )
    expect(await reasonOf({ listWallets: async () => [] })).to.equal(
      'wallet-setup'
    )
    expect(await reasonOf({ listDids: async () => [] })).to.equal(
      'wallet-setup'
    )
    expect(await reasonOf({}, 'https://not-openid4vp.test.invalid')).to.equal(
      'request-invalid'
    )
    expect(
      await reasonOf({
        usePresentationRequest: walletPresentingThrough(
          httpWallet(
            400,
            JSON.stringify({ errorMessage: 'No DID to use supplied' })
          )
        ).usePresentationRequest
      })
    ).to.equal('wallet-failed')
    expect(
      await waltIdProvider(node, base)
        .present(challenge)
        .catch((error: CredentialPresentationError) => error.reason)
    ).to.equal('verifier-rejected')
    expect(
      await new WaltIdCredentialProvider(node, {
        wallet: base,
        signer: { getAddress: async () => OWNER_ADDRESS } as never,
        onSelectCredentials: async () => []
      })
        .present(challenge)
        .catch((error: CredentialPresentationError) => error.reason)
    ).to.equal('none-selected')
  })
})

/** The harness's reading of a refusal (`tests/check.ts`): the failed policies, or nothing. */
const HARNESS_REFUSAL = /did not accept the presentation \((.*)\)\s*$/

/** A resolver whose provider fails with `error`, against a node answering `check`. */
async function refusal(check: PolicySessionCheck | Error, error: unknown) {
  const { node, calls } = policyNode(check)
  const thrown = await resolve(
    node,
    new PolicySessionResolver({
      credentials: {
        present: async () => {
          throw error
        }
      }
    })
  ).catch((caught) => caught)
  return { thrown, calls }
}

describe("a refusal's reason fits PolicyDeniedError's bound", () => {
  it('keeps the closing parenthesis with three mid-length failures', async () => {
    const { thrown } = await refusal(
      {
        verified: false,
        policyResults: [
          {
            credential: 'VerifiableId',
            policy: 'allowed-issuer',
            success: false,
            error: 'No issuer found in credential: did:key:z6Mkfake'
          },
          {
            credential: 'VerifiableId',
            policy: 'schema',
            success: false,
            error: 'credentialSubject.birthDate is required here'
          },
          {
            credential: 'VerifiableId',
            policy: 'expired',
            success: false,
            error: 'expired'
          }
        ]
      },
      new Error('Presentation failed')
    )

    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.reason.length).to.be.at.most(200)
    expect(thrown.reason).to.match(/\)$/)
    expect(HARNESS_REFUSAL.exec(thrown.reason)?.[1]).to.match(
      /^allowed-issuer: No issuer found/
    )
  })

  it('never cuts the reason, whatever the number and length of the failures', async () => {
    for (const count of [1, 2, 3, 5, 12, 50])
      for (const length of [0, 10, 45, 79, 80, 81, 150, 400]) {
        const { thrown } = await refusal(
          {
            verified: false,
            policyResults: Array.from({ length: count }, (_, index) => ({
              policy: `p${index}`,
              success: false,
              ...(length ? { error: 'e'.repeat(length) } : {})
            }))
          },
          new Error('Presentation failed')
        )
        const what = `${count} failures of ${length}`

        expect(thrown.reason.length, what).to.be.at.most(200)
        expect(thrown.reason, what).not.to.match(/…$/)
        expect(HARNESS_REFUSAL.exec(thrown.reason)?.[1], what).to.match(/^p0/)
      }
  })
})

describe('the read after a failed presentation', () => {
  it('runs only when the verifier refused, or for a custom provider', async () => {
    for (const reason of [
      'no-matching-credential',
      'none-selected',
      'wallet-setup',
      'request-invalid',
      'wallet-failed'
    ] as const) {
      const failure = new CredentialPresentationError(
        'failed',
        undefined,
        reason
      )
      const { thrown, calls } = await refusal(HOLDER_BINDING_NPE, failure)

      expect(calls.checked, reason).to.deep.equal([])
      expect(thrown, reason).to.equal(failure)
    }

    for (const failure of [
      new CredentialPresentationError(
        'refused',
        undefined,
        'verifier-rejected'
      ),
      new Error('a custom provider failed')
    ]) {
      const { thrown, calls } = await refusal(HOLDER_BINDING_NPE, failure)

      expect(calls.checked).to.deep.equal([SID])
      expect(thrown).to.be.instanceOf(PolicyDeniedError)
      expect(thrown.cause).to.equal(failure)
    }
  })

  it('is cut when the node never answers, with the debug channel off', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() =>
      AbortSignal.abort(new Error('timed out'))
    )
    const failure = new Error('Presentation failed')
    const { node } = policyNode(HOLDER_BINDING_NPE)
    // A P2P read that never answers and ignores its signal.
    ;(
      node as unknown as { checkPolicySession: () => Promise<never> }
    ).checkPolicySession = () => new Promise<never>(() => undefined)

    const thrown = await resolve(
      node,
      new PolicySessionResolver({
        credentials: {
          present: async () => {
            throw failure
          }
        }
      })
    ).catch((error) => error)

    expect(thrown).to.equal(failure)
  }, 2_000)
})

describe("a policy-server session id in the wallet's text (D10)", () => {
  const PSID = FAKE.policySessionId
  const [context, random] = PSID.split('-')
  /** walt.id's texts that quote the session id, and other shapes it may take. */
  const QUOTING = [
    `Id parameter ${PSID} doesn't refer to an existing session, or session expired`,
    `Presentation failed for session ${PSID}: policies signature, holder-binding`,
    `failed with state=${PSID}`,
    `see verifier/error?id=${PSID}`,
    `see http%3A%2F%2Fverifier%3A7003%2Ferror%3Fid%3D${PSID}`,
    `see http:\\/\\/verifier:7003\\/error?id=${PSID}`,
    `stateId: ${PSID}`
  ]

  function challengeFor(node: OceanNodeClient, sessionId: string = PSID) {
    return {
      asset: ssiAsset(),
      serviceId: SERVICE_ID,
      consumerAddress: OWNER_ADDRESS,
      node,
      sessionId,
      redirectUri: `openid4vp://authorize?${new URLSearchParams({
        response_uri: 'https://ps.test.invalid/verify'
      })}`
    }
  }

  it('is not in the error of the real wallet and provider, nor in its cause chain', async () => {
    for (const errorMessage of QUOTING)
      for (const check of [
        HOLDER_BINDING_NPE,
        { verified: false, policyResults: [] },
        new Error('node unreachable')
      ]) {
        const { node } = policyNode(check)
        const wallet = walletPresentingThrough(
          httpWallet(400, JSON.stringify({ redirectUri: '', errorMessage }))
        )
        const provider = waltIdProvider(node, wallet)

        const presented = await provider
          .present(challengeFor(node))
          .catch((error) => error)
        expect(presented.reason).to.equal('verifier-rejected')
        expect(everything(presented), errorMessage).not.to.contain(context)
        expect(everything(presented), errorMessage).not.to.contain(random)

        const thrown = await resolve(
          node,
          new PolicySessionResolver({ credentials: provider })
        ).catch((error) => error)
        expect(everything(thrown), errorMessage).not.to.contain(context)
        expect(everything(thrown), errorMessage).not.to.contain(random)
      }
  })

  it("leaves no start of it where the wallet's 500-character cut split it (PR #216 review)", async () => {
    // `WaltIdHttpWallet` bounds the wallet's message before the provider can remove the id;
    // a cut inside an id that `redactSecrets` does not know (a policy server's own format)
    // kept its first characters, in the message and in `details`.
    for (const sessionId of [
      'custom-policy-session-0123456789abcdef',
      SID,
      `${'Kontext'.repeat(5)}-${'Zufall'.repeat(6)}`
    ]) {
      const { node } = policyNode(HOLDER_BINDING_NPE)
      const head = 'Id parameter '
      for (let cut = 0; cut <= sessionId.length; cut++) {
        const errorMessage = `${'x '.repeat(250 - Math.ceil((head.length + cut) / 2))}${
          (head.length + cut) % 2 ? 'x' : ''
        }${head}${sessionId} expired`
        const wallet = walletPresentingThrough(
          httpWallet(400, JSON.stringify({ redirectUri: '', errorMessage }))
        )
        const presented = await waltIdProvider(node, wallet)
          .present(challengeFor(node, sessionId))
          .catch((error) => error)

        expect(presented.reason).to.equal('verifier-rejected')
        for (const text of [
          presented.message,
          presented.details.errorMessage
        ]) {
          const after = text.slice(text.lastIndexOf(head) + head.length)
          expect(
            // The provider's own bound may cut its `<redacted>`, never the id.
            after.replace(/<redacted>|<[a-z]*…$|[-…]| expired$/g, ''),
            `${sessionId} cut after ${cut}: ${after}`
          ).to.equal('')
        }
      }
    }
  })

  it('finds a cut start of a huge session id in linear time (security regression)', async () => {
    const { node } = policyNode(HOLDER_BINDING_NPE)
    const base = walletPresentingThrough(httpWallet(400, VERIFIER_400))
    const sessionId = `${'d'.repeat(50_000)}e`
    const errorMessage = `session ${'d'.repeat(40_000)}…`
    let presented: CredentialPresentationError | undefined
    const elapsed = await cpuTime(async () => {
      presented = await waltIdProvider(node, {
        ...base,
        usePresentationRequest: async () => ({ errorMessage })
      })
        .present(challengeFor(node, sessionId))
        .catch((error) => error)
    })

    expect(elapsed).to.be.below(cpuBudget(50))
    expect(presented?.message).to.equal(
      'The verifier rejected the presentation: session <redacted>…'
    )
  })

  it("is redacted by the provider, in any shape, from a custom wallet's message", async () => {
    const { node } = policyNode(HOLDER_BINDING_NPE)
    const base = walletPresentingThrough(httpWallet(400, VERIFIER_400))
    const presentWith = (errorMessage: string, sessionId: string) =>
      waltIdProvider(node, {
        ...base,
        // A custom wallet: nothing redacted before the provider.
        usePresentationRequest: async () => ({ errorMessage })
      })
        .present(challengeFor(node, sessionId))
        .catch((error) => error)

    const quoted = await presentWith(
      `session ${SID} expired; state ${SID.toUpperCase()}`,
      SID
    )
    expect(quoted.message).to.equal(
      'The verifier rejected the presentation: session <redacted> expired; state <redacted>'
    )
    expect(quoted.details).to.deep.equal({
      errorMessage: 'session <redacted> expired; state <redacted>'
    })

    const halves = await presentWith(
      `only the random half ${random}, and the context ${context}`,
      PSID
    )
    expect(halves.details.errorMessage).to.equal(
      'only the random half <redacted>, and the context <redacted>'
    )
  })

  it("keeps the refusal's reason with a huge session id the node chose (sec m1)", async () => {
    const { node } = policyNode(HOLDER_BINDING_NPE)
    const base = walletPresentingThrough(httpWallet(400, VERIFIER_400))
    for (const sessionId of [
      // 1,250 parts of 32 characters (40 KB), and one part of 100 KB: a pattern built from
      // either was too large, and the SyntaxError quoted it.
      Array.from({ length: 1_250 }, (_, index) =>
        index.toString(16).padStart(32, 'b')
      ).join('-'),
      'c'.repeat(100_000)
    ]) {
      const errorMessage = `session ${sessionId.slice(0, 40_000)} expired`
      const presented = await waltIdProvider(node, {
        ...base,
        usePresentationRequest: async () => ({ errorMessage })
      })
        .present(challengeFor(node, sessionId))
        .catch((error) => error)

      expect(presented).to.be.instanceOf(CredentialPresentationError)
      expect(presented.reason).to.equal('verifier-rejected')
      expect(presented.message.length).to.be.below(600)
      expect(presented.message).not.to.match(/b{32}|c{32}/)
    }
  })

  it('is redacted in any text, but a compute job id of the same shape is kept', () => {
    for (const text of QUOTING)
      expect(redactSecrets(text), text).not.to.contain(random)

    const jobId = `0x${'9f86'.repeat(16)}-${'3a7b'.repeat(16)}`
    expect(redactSecrets(`job ${jobId} is running`)).to.equal(
      `job ${jobId} is running`
    )
    for (const [text, expected] of [
      [`job ${jobId.toUpperCase().replace('0X', '0x')}`, 'kept'],
      [`job 0X${jobId.slice(2)}`, 'kept'],
      [`0x12 ${PSID}`, '0x12 <redacted>'],
      [`ab${PSID}cd`, 'ab<redacted>cd'],
      [`${PSID}-${'e'.repeat(64)}`, `<redacted>-${'e'.repeat(64)}`]
    ])
      expect(redactSecrets(text), text).to.equal(
        expected === 'kept' ? text : expected
      )
  })

  it('is found in linear time in a long hex run (security regression)', async () => {
    // A `0x` looked back for over the whole run at each of its characters: a run of 16,000
    // (calldata in an RPC error, at the log message's read limit) took 160 ms, and 65,536
    // took seconds.
    const run = `${'a'.repeat(16_000)} ${PSID} 0x${'b'.repeat(16_000)}`
    let redacted = ''
    const elapsed = await cpuTime(() => {
      redacted = redactSecrets(run)
    })
    expect(elapsed).to.be.below(cpuBudget(50))
    expect(redacted).not.to.contain(random)
    expect(redacted.endsWith(`0x${'b'.repeat(16_000)}`)).to.equal(true)
  })

  it("is redacted from the node's per-policy results too", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              httpStatus: 200,
              message: {
                verificationResult: false,
                policyResults: {
                  results: [
                    {
                      credential: 'VerifiableId',
                      policyResults: [
                        {
                          policy: 'presentation-definition',
                          is_success: false,
                          error: `no session ${PSID}`
                        }
                      ]
                    }
                  ]
                }
              }
            }),
            { status: 200 }
          )
      )
    )

    const check = await new OceanNodeClient({
      nodeUri: NODE,
      chainId: CHAIN_ID,
      auth: 'a-session-token',
      consumerAddress: OWNER_ADDRESS
    }).checkPolicySession(PSID)

    expect(check.policyResults).to.deep.equal([
      {
        credential: 'VerifiableId',
        policy: 'presentation-definition',
        success: false,
        error: 'no session <redacted>'
      }
    ])
  })

  it("is removed as the known session id from the node's per-policy results and the refusal, whatever its shape (PR #216 review)", async () => {
    const sessionId = 'custom-policy-session-0123456789abcdef'
    // The id quoted whole, in another letter case, split by a control character the
    // sanitiser deletes, in a policy and a credential name, and cut by the 100-character
    // bound of an error at every position.
    const errors = [
      `Id parameter ${sessionId} expired`,
      `Id parameter ${sessionId.toUpperCase()} expired`,
      `Id parameter custom-policy-\u0007session-0123456789abcdef expired`,
      ...Array.from(
        { length: sessionId.length + 1 },
        (_, cut) => `${'x'.repeat(100 - cut)}${sessionId} expired`
      )
    ]
    const record = {
      success: false,
      httpStatus: 400,
      message: {
        verificationResult: false,
        policyResults: {
          results: [
            {
              credential: `VerifiableId ${sessionId}`,
              policyResults: errors.map((error, index) => ({
                policy: index ? `policy-${index}` : `policy ${sessionId}`,
                is_success: false,
                error
              }))
            }
          ]
        }
      }
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(record), { status: 400 }))
    )
    const node = new OceanNodeClient({
      nodeUri: NODE,
      chainId: CHAIN_ID,
      auth: 'a-session-token',
      consumerAddress: OWNER_ADDRESS
    })
    vi.spyOn(node, 'hasPolicyServer').mockResolvedValue(true)
    vi.spyOn(node, 'initializePolicyVerification').mockResolvedValue({
      success: true,
      httpStatus: 200,
      message: {
        sessionId,
        redirectUri:
          'openid4vp://authorize?response_uri=https%3A%2F%2Fps.test.invalid%2Fverify'
      }
    })
    const presented = new PolicySessionResolver({
      credentials: { present: async () => undefined }
    })
    const failedPresentation = new PolicySessionResolver({
      credentials: {
        present: async () => {
          throw new Error('the presentation failed')
        }
      }
    })

    for (const resolver of [presented, failedPresentation]) {
      const thrown = await resolve(node, resolver).catch((error) => error)

      expect(thrown).to.be.instanceOf(PolicyDeniedError)
      expect(thrown.policyResults).to.have.length(errors.length)
      expect(thrown.policyResults[0]).to.deep.include({
        credential: 'VerifiableId <redacted>',
        policy: 'policy <redacted>',
        error: 'Id parameter <redacted> expired'
      })
      expect(thrown.policyResults[1].error).to.equal(
        'Id parameter <redacted> expired'
      )
      expect(thrown.policyResults[2].error).to.equal(
        'Id parameter <redacted> expired'
      )
      const text = everything(thrown).toLowerCase()
      for (let length = 4; length <= sessionId.length; length++)
        expect(text, `${length} characters of the id`).not.to.contain(
          sessionId.slice(0, length)
        )
    }
  })

  it("is removed as the known session id from the node's answer that is no session record", async () => {
    const sessionId = 'custom-policy-session-0123456789abcdef'
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              httpStatus: 400,
              message: `Id parameter ${sessionId} doesn't refer to an existing session, or session expired`
            }),
            { status: 400 }
          )
      )
    )

    const thrown = await new OceanNodeClient({
      nodeUri: NODE,
      chainId: CHAIN_ID,
      auth: 'a-session-token',
      consumerAddress: OWNER_ADDRESS
    })
      .checkPolicySession(sessionId)
      .catch((error) => error)

    expect(thrown.message).to.contain('Id parameter <redacted> doesn')
    expect(everything(thrown)).not.to.contain('custom-policy')
  })
})

describe("the wallet's own 400 answers", () => {
  it("keeps the message of walt.id's StatusPages answer", async () => {
    const result = await httpWallet(
      400,
      JSON.stringify({
        exception: true,
        id: 'IllegalArgumentException',
        status: 'Bad Request',
        code: '400',
        message: `SD-JWT VC must not end with '~' \u001b[31m${FAKE.jwt}`
      })
    ).usePresentationRequest('w', 'did', 'req', ['c'], 'session-token')

    expect(result).to.deep.equal({
      errorMessage: "SD-JWT VC must not end with '~' <redacted>",
      rejectedBy: 'wallet'
    })

    const empty = await httpWallet(
      400,
      JSON.stringify({ exception: true, message: null })
    ).usePresentationRequest('w', 'did', 'req', ['c'], 'session-token')
    expect(empty.errorMessage).to.equal('the wallet gave no reason')
  })
})

describe("the node's per-policy errors", () => {
  it('are cut at 100 characters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              httpStatus: 200,
              message: {
                verificationResult: false,
                policyResults: {
                  results: [
                    {
                      credential: 'VerifiableId',
                      policyResults: [
                        {
                          policy: 'allowed-issuer',
                          is_success: false,
                          error: `No issuer found in credential: ${'{"name":"Jane Doe"} '.repeat(20)}`
                        },
                        {
                          policy: 'schema',
                          is_success: false,
                          error: { message: 'm'.repeat(300) }
                        }
                      ]
                    }
                  ]
                }
              }
            }),
            { status: 200 }
          )
      )
    )

    const check = await new OceanNodeClient({
      nodeUri: NODE,
      chainId: CHAIN_ID,
      auth: 'a-session-token',
      consumerAddress: OWNER_ADDRESS
    }).checkPolicySession(SID)

    expect(check.policyResults).to.have.length(2)
    for (const result of check.policyResults)
      expect(result.error?.length).to.equal(101)
  })
})
