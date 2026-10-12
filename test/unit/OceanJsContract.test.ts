/**
 * The ocean.js dependency contract.
 *
 * ocean.js is a fixed dependency: nautilus never patches it, and works around what it does
 * instead. Each workaround silently breaks when an ocean.js release changes the behaviour
 * it rests on, and the rest of the suite cannot notice, because it mocks ocean.js or
 * drives it only where nautilus's own output changes. This file pins those behaviours
 * against the installed ocean.js itself, in both of its bundles (`import` →
 * `lib.module.mjs`, `default` → `lib.modern.mjs`), with real module objects, a stubbed
 * `fetch` and an in-memory signer and provider: no network, no chain.
 *
 * Every test names, in its title, the nautilus code that depends on the behaviour, so a
 * failure after an ocean.js bump says what breaks. Bumping ocean.js: see "Supported
 * ocean.js versions" in `src/README.md`.
 *
 * `NAUTILUS_TEST_OCEANJS=<directory of an @oceanprotocol/lib package>` runs the contract
 * against that package instead of the installed one (a candidate release, or a modified
 * copy to show that a test fails when its behaviour changes). Its dependencies resolve
 * from its own location, so it needs a `node_modules` above it.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  AbstractSigner,
  getAddress,
  getBytes,
  Interface,
  id,
  keccak256,
  type Provider,
  parseUnits,
  type TransactionRequest,
  toBeArray,
  toUtf8Bytes,
  verifyMessage,
  Wallet
} from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAKE } from '../secretScan.js'

type OceanJs = typeof import('@oceanprotocol/lib')

// --- The bundles -------------------------------------------------------------------------

/** The root of the ocean.js package under test (the one holding its package.json). */
const PACKAGE_ROOT = process.env.NAUTILUS_TEST_OCEANJS
  ? resolve(process.env.NAUTILUS_TEST_OCEANJS)
  : // `require` resolves the `default` condition: <root>/dist/lib.modern.mjs.
    dirname(
      dirname(createRequire(import.meta.url).resolve('@oceanprotocol/lib'))
    )

const PACKAGE = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')
) as {
  version: string
  exports: Record<string, Record<string, string>>
}

interface Bundle {
  /** The `exports` condition that selects it. */
  condition: 'import' | 'default'
  file: string
  source: string
  lib: OceanJs
}

const BUNDLES: Bundle[] = await Promise.all(
  (['import', 'default'] as const).map(async (condition) => {
    const file = join(PACKAGE_ROOT, PACKAGE.exports['.'][condition])
    return {
      condition,
      file,
      source: readFileSync(file, 'utf8'),
      lib: (await import(pathToFileURL(file).href)) as OceanJs
    }
  })
)

// --- Fixtures ----------------------------------------------------------------------------

const NODE = 'https://node.test.invalid'
const CHAIN_ID = 11155420
const ACCOUNT = getAddress(`0x${'a1'.repeat(20)}`)
const OTHER = getAddress(`0x${'b2'.repeat(20)}`)
const NFT = getAddress(`0x${'c3'.repeat(20)}`)
const DATATOKEN = getAddress(`0x${'d4'.repeat(20)}`)
const TOKEN = getAddress(`0x${'e5'.repeat(20)}`)
const EXCHANGE = getAddress(`0x${'f6'.repeat(20)}`)
const DISPENSER = getAddress(`0x${'17'.repeat(20)}`)
const DID = `did:ope:${'aa'.repeat(32)}`
const ALGO_DID = `did:ope:${'bb'.repeat(32)}`
const SECOND_SESSION = `${'c1'.repeat(32)}-${'d2'.repeat(32)}`

/** The selectors of the calls the tests look for, from their signatures. */
const SELECTOR = {
  approve: id('approve(address,uint256)').slice(0, 10)
}

/** The read-only calls ocean.js makes before it builds a transaction. */
const READS = new Interface([
  'function getPermissions(address) view returns (tuple(bool manager, bool deployERC20, bool updateMetadata, bool store))',
  'function isERC20Deployer(address) view returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function decimals() view returns (uint8)'
])

/** The fields of the contract calls whose arguments the tests decode. */
const WRITES = new Interface([
  'function approve(address spender, uint256 amount)',
  'function createFixedRate(address fixedPriceAddress, address[] addresses, uint256[] uints)',
  'function createDispenser(address dispenser, uint256 maxTokens, uint256 maxBalance, bool withMint, address allowedSwapper)'
])

interface ChainOptions {
  /** What `getPermissions` answers (an NFT's roles of the asked address). */
  roles?: Partial<
    Record<'manager' | 'deployERC20' | 'updateMetadata' | 'store', boolean>
  >
  /** The allowance `allowance()` answers, in base units. */
  allowance?: bigint
  /** Make `sendTransaction` throw this. */
  sendError?: Error
  /** Make the response's `wait()` reject with this (a revert, a timeout). */
  waitError?: Error
}

/**
 * A signer that signs nothing: it records every transaction it is asked to send and
 * answers with a response whose `wait()` is a spy. Its provider answers the reads above,
 * the fee data and the gas estimate, and a receipt for every hash.
 */
function fakeChain(options: ChainOptions = {}) {
  const sent: TransactionRequest[] = []
  const estimated: TransactionRequest[] = []
  const reads: string[] = []
  const responses: { hash: string; wait: ReturnType<typeof vi.fn> }[] = []

  const receipt = (hash: string) => ({
    hash,
    blockNumber: 1,
    blockHash: `0x${'12'.repeat(32)}`,
    index: 0,
    status: 1,
    logs: [],
    from: ACCOUNT,
    to: null,
    contractAddress: null,
    gasUsed: 21000n,
    cumulativeGasUsed: 21000n,
    gasPrice: 1n,
    logsBloom: `0x${'00'.repeat(256)}`,
    type: 2,
    root: null,
    blobGasUsed: null,
    blobGasPrice: null
  })

  const provider = {
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID), name: 'test' }),
    getFeeData: async () => ({
      gasPrice: 1n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n
    }),
    estimateGas: async (tx: TransactionRequest) => {
      estimated.push(tx)
      return 100_000n
    },
    call: async (tx: TransactionRequest) => {
      const data = String(tx.data)
      const fragment = READS.getFunction(data.slice(0, 10))
      if (!fragment) throw new Error(`unexpected read ${data.slice(0, 10)}`)
      reads.push(fragment.name)
      switch (fragment.name) {
        case 'getPermissions':
          return READS.encodeFunctionResult(fragment, [
            [
              options.roles?.manager ?? false,
              options.roles?.deployERC20 ?? true,
              options.roles?.updateMetadata ?? true,
              options.roles?.store ?? false
            ]
          ])
        case 'isERC20Deployer':
          return READS.encodeFunctionResult(fragment, [
            options.roles?.deployERC20 ?? true
          ])
        case 'allowance':
          return READS.encodeFunctionResult(fragment, [options.allowance ?? 0n])
        default:
          return READS.encodeFunctionResult(fragment, [18])
      }
    },
    getTransactionReceipt: vi.fn(async (hash: string) => receipt(hash)),
    getBlockNumber: async () => 1,
    resolveName: async (name: string) => name
  }

  class RecordingSigner extends AbstractSigner {
    constructor() {
      super(provider as unknown as Provider)
    }
    async getAddress() {
      return ACCOUNT
    }
    connect(): RecordingSigner {
      return this
    }
    async signTransaction(): Promise<string> {
      throw new Error('the contract tests sign nothing')
    }
    async signMessage(): Promise<string> {
      throw new Error('the contract tests sign nothing')
    }
    async signTypedData(): Promise<string> {
      throw new Error('the contract tests sign nothing')
    }
    // biome-ignore lint/suspicious/noExplicitAny: the response is a duck-typed stand-in
    async sendTransaction(tx: TransactionRequest): Promise<any> {
      sent.push(tx)
      if (options.sendError) throw options.sendError
      const hash = `0x${sent.length.toString(16).padStart(64, '0')}`
      const response = {
        hash,
        from: ACCOUNT,
        to: tx.to,
        data: tx.data,
        value: 0n,
        nonce: sent.length - 1,
        gasLimit: 100_000n,
        chainId: BigInt(CHAIN_ID),
        type: 2,
        blockNumber: null,
        blockHash: null,
        index: 0,
        wait: vi.fn(async () => {
          if (options.waitError) throw options.waitError
          return receipt(hash)
        })
      }
      responses.push(response)
      return response
    }
  }

  const signer = new RecordingSigner()
  const config = {
    chainId: CHAIN_ID,
    network: 'test',
    sdk: 'evm',
    fixedRateExchangeAddress: EXCHANGE,
    dispenserAddress: DISPENSER
  }

  return { signer, provider, config, sent, estimated, reads, responses }
}

/** The 4-byte selector of a sent transaction. */
const selectorOf = (tx: TransactionRequest) => String(tx.data).slice(0, 10)

/** A refusal from the node, for every `fetch` ocean.js makes; returns the spy. */
function nodeRefuses(body: unknown = { error: 'refused' }) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 400,
        statusText: 'Bad Request'
      })
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** The policy-server slots nautilus passes, two sessions (as for two datasets). */
function policyServer() {
  return [
    { sessionId: FAKE.policySessionId, documentId: DID, serviceId: 'svc' },
    { sessionId: SECOND_SESSION, documentId: DID, serviceId: 'svc2' }
  ]
}

const SIGNED = {
  consumerAddress: ACCOUNT,
  nonce: FAKE.nonce,
  signature: FAKE.signature
}

/** Mutes the console for one test, so a bundle that prints itself prints nothing. */
function muteConsole() {
  const spies = {} as Record<
    'error' | 'warn' | 'log' | 'info' | 'debug',
    ReturnType<typeof vi.spyOn>
  >
  for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const)
    spies[method] = vi.spyOn(console, method).mockImplementation(() => {})
  return spies
}

/**
 * Replaces `LoggerInstance.error` with a spy for one test, as an own property, the way
 * nautilus's capture does (`src/log/oceanjs.ts`).
 */
function spyOnLoggerError(lib: OceanJs) {
  return vi.spyOn(lib.LoggerInstance, 'error').mockImplementation(() => {})
}

/** The arguments of the `'Payload was:'` call among a spy's calls. */
function payloadDump(spy: ReturnType<typeof vi.spyOn>): unknown {
  const call = spy.mock.calls.find(
    (args: unknown[]) => args[0] === 'Payload was:'
  )
  expect(call, "ocean.js logged no 'Payload was:'").not.to.equal(undefined)
  expect(call).to.have.length(2)
  return (call as unknown[])[1]
}

function sessionIds(payload: unknown): unknown[] {
  return (
    payload as { policyServer: { sessionId: unknown }[] }
  ).policyServer.map((slot) => slot.sessionId)
}

/** ocean.js's `logLevel` (private in its types). */
const levelOf = (logger: object) => (logger as { logLevel: unknown }).logLevel

/** The signer a contract sends with (`getSignerAccordingSdk`, protected in its types). */
const signerOf = (contract: object) =>
  (contract as { getSignerAccordingSdk(): unknown }).getSignerAccordingSdk()

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// --- The contract ------------------------------------------------------------------------

describe(`ocean.js ${PACKAGE.version}: the package`, () => {
  it("exports map: 'import' is lib.module.mjs, 'default' is lib.modern.mjs (src/log/oceanjs.ts captures the import bundle only; configureLogging.mdx says so)", () => {
    expect(PACKAGE.exports['.'].import).to.equal('./dist/lib.module.mjs')
    expect(PACKAGE.exports['.'].default).to.equal('./dist/lib.modern.mjs')
    expect(PACKAGE.exports['.']).not.to.have.property('require')
    expect(PACKAGE.exports['.']).not.to.have.property('node')

    if (process.env.NAUTILUS_TEST_OCEANJS) return
    // And Node resolves the installed package that way.
    expect(fileURLToPath(import.meta.resolve('@oceanprotocol/lib'))).to.equal(
      BUNDLES[0].file
    )
    expect(
      createRequire(import.meta.url).resolve('@oceanprotocol/lib')
    ).to.equal(BUNDLES[1].file)
  })
})

describe.each(BUNDLES)(
  `ocean.js ${PACKAGE.version}, the $condition bundle`,
  ({ lib, source }) => {
    describe('its logger (10e: src/log/oceanjs.ts)', () => {
      it('LoggerInstance is the object a refused compute start logs through (the capture wraps LoggerInstance)', async () => {
        muteConsole()
        nodeRefuses()
        const error = spyOnLoggerError(lib)

        await expect(
          lib.ProviderInstance.freeComputeStart(
            NODE,
            SIGNED,
            'env',
            [{ documentId: DID, serviceId: 'svc' }],
            { documentId: ALGO_DID, serviceId: 'algo' }
          )
        ).rejects.toThrow()

        expect(error).toHaveBeenCalled()
        expect(error.mock.calls.map((args) => args[0])).to.include(
          'Payload was:'
        )
      })

      it('LoggerInstance is extensible and its five methods can be replaced as own properties (src/log/oceanjs.ts installs them at import; on a frozen object the capture is unavailable and ocean.js prints raw again)', () => {
        const logger = lib.LoggerInstance as unknown as Record<
          string | symbol,
          unknown
        >
        expect(Object.isExtensible(logger)).to.equal(true)
        expect(Object.isFrozen(logger)).to.equal(false)
        expect(Object.isSealed(logger)).to.equal(false)

        for (const method of ['error', 'warn', 'log', 'debug', 'bypass']) {
          const own = Object.getOwnPropertyDescriptor(logger, method)
          const before = logger[method]
          const replacement = () => {}
          logger[method] = replacement
          expect(logger[method]).to.equal(replacement)
          // Put back what was there: the capture's own method, or the prototype's.
          if (own) Object.defineProperty(logger, method, own)
          else delete logger[method]
          expect(logger[method]).to.equal(before)
        }

        // The capture keeps its state under a registered symbol on the instance.
        const key = Symbol.for('@deltadao/nautilus/oceanjs-contract-probe')
        logger[key] = 1
        expect(logger[key]).to.equal(1)
        delete logger[key]
      })

      it('the five methods are on the Logger prototype, not bound per instance (the capture shadows them, and calls the original with the instance as this)', () => {
        const fresh = new lib.Logger()
        expect(Object.getOwnPropertyNames(fresh)).to.deep.equal(['logLevel'])
        expect(lib.LoggerInstance).to.be.instanceOf(lib.Logger)
        const proto = Object.getPrototypeOf(lib.LoggerInstance)
        for (const method of ['error', 'warn', 'log', 'debug', 'bypass'])
          expect(typeof proto[method], method).to.equal('function')
      })

      it('looks the method up at call time, so a replacement made after the first call still sees later calls (the capture is installed whenever nautilus loads)', async () => {
        muteConsole()
        nodeRefuses()
        const call = () =>
          lib.ProviderInstance.freeComputeStart(
            NODE,
            SIGNED,
            'env',
            [{ documentId: DID, serviceId: 'svc' }],
            { documentId: ALGO_DID, serviceId: 'algo' }
          )

        // Every line of a call, the payload dump included, goes to the method in place
        // when it runs, not to one ocean.js took earlier.
        const messages = (spy: ReturnType<typeof vi.spyOn>) =>
          spy.mock.calls.map((args: unknown[]) => args[0])

        const first = spyOnLoggerError(lib)
        await expect(call()).rejects.toThrow()
        expect(messages(first)).to.include('Payload was:')
        const firstCalls = first.mock.calls.length
        first.mockRestore()

        const second = spyOnLoggerError(lib)
        await expect(call()).rejects.toThrow()
        expect(messages(second)).to.include('Payload was:')
        expect(second.mock.calls.length).to.equal(firstCalls)
      })

      it('logLevel semantics: LogLevel None -1, Error 0, Warn 1, Log 2, Verbose 3; a method prints when logLevel >= its threshold (error 0, warn 1, log 2, debug 3, bypass always) to console[error|warn|log|debug|log] (the capture applies the same thresholds first)', () => {
        expect({ ...lib.LogLevel }).to.deep.include({
          None: -1,
          Error: 0,
          Warn: 1,
          Log: 2,
          Verbose: 3
        })
        expect(levelOf(new lib.Logger())).to.equal(lib.LogLevel.Error)

        const thresholds = {
          error: 0,
          warn: 1,
          log: 2,
          debug: 3,
          bypass: Number.NEGATIVE_INFINITY
        }
        const consoleMethod = {
          error: 'error',
          warn: 'warn',
          log: 'log',
          debug: 'debug',
          bypass: 'log'
        } as const

        for (const level of [-1, 0, 1, 2, 3]) {
          const logger = new lib.Logger()
          logger.setLevel(level)
          expect(levelOf(logger)).to.equal(level)
          for (const [method, threshold] of Object.entries(thresholds)) {
            const spies = muteConsole()
            ;(
              logger as unknown as Record<string, (...args: unknown[]) => void>
            )[method]('line', 1)
            const printed = Object.entries(spies).filter(
              ([, spy]) => spy.mock.calls.length > 0
            )
            const expected =
              level >= threshold
                ? [[consoleMethod[method as keyof typeof consoleMethod], 1]]
                : []
            expect(
              printed.map(([name, spy]) => [name, spy.mock.calls.length]),
              `level ${level}, ${method}`
            ).to.deep.equal(expected)
            if (expected.length)
              expect(
                spies[consoleMethod[method as keyof typeof consoleMethod]].mock
                  .calls[0]
              ).to.deep.equal(['line', 1])
            vi.restoreAllMocks()
          }
        }
      })

      it("computeStart dumps 'Payload was:' as an object with the raw nonce and policyServer[].sessionId (OceanNodeClient.computeStart; the capture redacts them; PR 8 avoids the dump)", async () => {
        muteConsole()
        nodeRefuses({ error: 'not allowed' })
        const error = spyOnLoggerError(lib)

        await expect(
          lib.ProviderInstance.computeStart(
            NODE,
            SIGNED,
            'env',
            [{ documentId: DID, serviceId: 'svc' }],
            { documentId: ALGO_DID, serviceId: 'algo' },
            60,
            TOKEN,
            [],
            CHAIN_ID,
            undefined,
            undefined,
            undefined,
            policyServer()
          )
        ).rejects.toThrow()

        expect(error.mock.calls[0]).to.deep.equal([
          'Compute start failed: ',
          400,
          'Bad Request',
          { error: 'not allowed' }
        ])
        const payload = payloadDump(error)
        expect(typeof payload).to.equal('object')
        expect(payload).to.deep.include({ nonce: FAKE.nonce })
        expect(payload).to.have.property('signature')
        expect(sessionIds(payload)).to.deep.equal([
          FAKE.policySessionId,
          SECOND_SESSION
        ])
      })

      it("freeComputeStart dumps 'Payload was:' as an object with the raw nonce and policyServer[].sessionId (OceanNodeClient.freeComputeStart; J1)", async () => {
        muteConsole()
        nodeRefuses({ error: 'not allowed' })
        const error = spyOnLoggerError(lib)

        await expect(
          lib.ProviderInstance.freeComputeStart(
            NODE,
            SIGNED,
            'env',
            [{ documentId: DID, serviceId: 'svc' }],
            { documentId: ALGO_DID, serviceId: 'algo' },
            [],
            undefined,
            undefined,
            undefined,
            policyServer()
          )
        ).rejects.toThrow()

        expect(error.mock.calls[0][0]).to.equal('Compute start failed: ')
        const payload = payloadDump(error)
        expect(payload).to.deep.include({ nonce: FAKE.nonce })
        expect(sessionIds(payload)).to.deep.equal([
          FAKE.policySessionId,
          SECOND_SESSION
        ])
      })

      it("initializeCompute dumps 'Payload was:' as a JSON string with the raw policyServer[].sessionId (OceanNodeClient.initializeCompute; the capture parses JSON strings)", async () => {
        muteConsole()
        nodeRefuses()
        const error = spyOnLoggerError(lib)

        await expect(
          lib.ProviderInstance.initializeCompute(
            [{ documentId: DID, serviceId: 'svc' }],
            { documentId: ALGO_DID, serviceId: 'algo' },
            'env',
            TOKEN,
            60,
            NODE,
            ACCOUNT,
            [],
            CHAIN_ID,
            policyServer()
          )
        ).rejects.toThrow()

        const payload = payloadDump(error)
        expect(typeof payload).to.equal('string')
        expect(sessionIds(JSON.parse(payload as string))).to.deep.equal([
          FAKE.policySessionId,
          SECOND_SESSION
        ])
      })

      it("PolicyServerPassthrough dumps 'Payload was:' as a JSON string of the request (OceanNodeClient's P2P passthrough; the capture parses JSON strings)", async () => {
        muteConsole()
        nodeRefuses()
        const error = spyOnLoggerError(lib)
        const request = {
          policyServerPassthrough: {
            action: 'checkSessionId',
            sessionId: FAKE.policySessionId
          }
        }

        await expect(
          lib.ProviderInstance.PolicyServerPassthrough(NODE, request as never)
        ).rejects.toThrow()

        const payload = payloadDump(error)
        expect(typeof payload).to.equal('string')
        expect(JSON.parse(payload as string)).to.deep.equal(request)
      })

      it("initializePSVerification dumps 'Payload was:' as a JSON string with the raw nonce (OceanNodeClient's P2P PS initialize; the capture parses JSON strings)", async () => {
        muteConsole()
        nodeRefuses()
        const error = spyOnLoggerError(lib)

        await expect(
          lib.ProviderInstance.initializePSVerification(NODE, SIGNED, {
            documentId: DID,
            serviceId: 'svc',
            consumerAddress: ACCOUNT,
            policyServer: { sessionId: FAKE.policySessionId }
          } as never)
        ).rejects.toThrow()

        const payload = payloadDump(error)
        expect(typeof payload).to.equal('string')
        expect(JSON.parse(payload as string)).to.deep.include({
          nonce: FAKE.nonce
        })
      })

      it('prints directly through console in exactly 5 console.error and 6 console.log sites, outside LoggerInstance (configureLogging.mdx: the direct sites are not captured; a new one must be reviewed)', () => {
        const sites: Record<string, number> = {}
        for (const [, method] of source.matchAll(/\bconsole\.(\w+)\s*\(/g))
          sites[method] = (sites[method] ?? 0) + 1
        expect(sites).to.deep.equal({ error: 5, log: 6 })
      })
    })

    describe('its transactions (PR 4: src/utils/nonceGuard.ts, confirmTransaction in src/utils/order.ts)', () => {
      it('sendPreparedTransaction sends through the given signer, awaits wait() once and returns that same response, not a receipt (confirmTransaction waits again; the guard settles a send when its wait() resolves)', async () => {
        const chain = fakeChain()
        const tx = { to: NFT, data: '0x12345678' }

        const response = await lib.sendPreparedTransaction(chain.signer, tx)

        expect(chain.sent).to.deep.equal([tx])
        expect(response).to.equal(chain.responses[0])
        expect(chain.responses[0].wait).toHaveBeenCalledTimes(1)
      })

      it('sendPreparedTransaction swallows a failed send: resolves null and logs it through LoggerInstance (confirmTransaction turns null into an error; the guard records why)', async () => {
        const refusal = new Error('nonce too low')
        const chain = fakeChain({ sendError: refusal })
        const error = spyOnLoggerError(lib)

        await expect(
          lib.sendPreparedTransaction(chain.signer, { to: NFT, data: '0x' })
        ).resolves.to.equal(null)
        expect(error).toHaveBeenCalledWith('Send prepared tx error: ', refusal)
      })

      it("sendPreparedTransaction returns null when wait() rejects, after a broadcast (confirmTransaction's 'sent and then reverted or timed out'; the guard's may-have-been-sent)", async () => {
        const chain = fakeChain({
          waitError: new Error('transaction reverted')
        })
        spyOnLoggerError(lib)

        await expect(
          lib.sendPreparedTransaction(chain.signer, { to: NFT, data: '0x' })
        ).resolves.to.equal(null)
        expect(chain.sent).to.have.length(1)
      })

      it("sendTx (approve, approveWei: the contract-method path) returns ethers' wrapper of the send, with the signer's hash, after waiting for the receipt through the provider; the signer's own wait() is not called (confirmTransaction settles by hash; the guard's wait() tracking does not see these sends)", async () => {
        const chain = fakeChain()

        const response = (await lib.approveWei(
          chain.signer,
          chain.config as never,
          ACCOUNT,
          TOKEN,
          DATATOKEN,
          '1',
          true
        )) as unknown as { hash: string; wait: unknown }

        expect(chain.sent).to.have.length(1)
        expect(response.hash).to.equal(chain.responses[0].hash)
        expect(response).not.to.equal(chain.responses[0])
        expect(chain.provider.getTransactionReceipt).toHaveBeenCalledWith(
          chain.responses[0].hash
        )
        expect(chain.responses[0].wait).not.toHaveBeenCalled()
      })

      it('contract calls send once through the signer they were built with, with sdk evm unwrapped (NonceGuardSigner sees every send)', async () => {
        const chain = fakeChain()
        const datatoken = new lib.Datatoken(
          chain.signer,
          CHAIN_ID,
          chain.config as never
        )
        const nft = new lib.Nft(chain.signer, CHAIN_ID, chain.config as never)

        expect(signerOf(datatoken)).to.equal(chain.signer)
        expect(signerOf(nft)).to.equal(chain.signer)

        await datatoken.startOrder(DATATOKEN, ACCOUNT, 0, providerFee())
        await nft.setMetadata(
          NFT,
          ACCOUNT,
          0,
          NODE,
          '',
          '0x02',
          '0x1234',
          `0x${'99'.repeat(32)}`
        )

        expect(chain.sent.map((tx) => tx.to)).to.deep.equal([DATATOKEN, NFT])
        expect(chain.sent.map(selectorOf)).to.deep.equal([
          id(
            'startOrder(address,uint256,(address,address,uint256,uint8,bytes32,bytes32,uint256,bytes),(address,address,uint256))'
          ).slice(0, 10),
          id(
            'setMetaData(uint8,string,string,bytes,bytes,bytes32,(address,uint8,bytes32,bytes32)[])'
          ).slice(0, 10)
        ])
      })

      it('the *Tx builders set no nonce (Nft.setMetadataTx: writeMetadata sends it with the guard, which sets the nonce and retries)', async () => {
        const chain = fakeChain()
        const nft = new lib.Nft(chain.signer, CHAIN_ID, chain.config as never)
        const datatoken = new lib.Datatoken(
          chain.signer,
          CHAIN_ID,
          chain.config as never
        )

        const requests = [
          await nft.setMetadataTx(
            NFT,
            ACCOUNT,
            0,
            NODE,
            '',
            '0x02',
            '0x1234',
            `0x${'99'.repeat(32)}`
          ),
          await datatoken.startOrderTx(DATATOKEN, ACCOUNT, 0, providerFee()),
          await datatoken.buyFromFreAndOrderTx(
            DATATOKEN,
            orderParams(),
            freParams()
          )
        ]

        for (const request of requests) {
          expect(request.nonce, String(request.data).slice(0, 10)).to.equal(
            undefined
          )
          expect(request.to).to.be.oneOf([NFT, DATATOKEN])
        }
        expect(chain.sent).to.have.length(0)
      })

      it('the order calls approve nothing: buyFromFreAndOrder, buyFromDispenserAndOrder, startOrder and reuseOrder each send only themselves (order(): allowancesFor/approveAllowance and reuseOrder approve every amount first)', async () => {
        const chain = fakeChain()
        const datatoken = new lib.Datatoken(
          chain.signer,
          CHAIN_ID,
          chain.config as never
        )

        await datatoken.buyFromFreAndOrder(
          DATATOKEN,
          orderParams(),
          freParams()
        )
        await datatoken.buyFromDispenserAndOrder(
          DATATOKEN,
          orderParams(),
          DISPENSER
        )
        await datatoken.startOrder(DATATOKEN, ACCOUNT, 0, providerFee())
        await datatoken.reuseOrder(
          DATATOKEN,
          `0x${'ab'.repeat(32)}`,
          providerFee()
        )

        expect(chain.sent).to.have.length(4)
        for (const tx of chain.sent) {
          expect(tx.to).to.equal(DATATOKEN)
          expect(selectorOf(tx)).not.to.equal(SELECTOR.approve)
        }
        expect(chain.reads).not.to.include('allowance')
      })

      it('approve() returns a number and sends nothing when the allowance covers the amount; otherwise approves exactly the amount in token units, replacing the allowance (approveSpend checks typeof number; allowancesFor sums each pair)', async () => {
        const covered = fakeChain({ allowance: parseUnits('5', 18) })
        const skipped = await lib.approve(
          covered.signer,
          covered.config as never,
          ACCOUNT,
          TOKEN,
          EXCHANGE,
          '5'
        )
        expect(typeof skipped).to.equal('number')
        expect(covered.sent).to.have.length(0)

        const short = fakeChain({ allowance: parseUnits('2', 18) })
        const response = await lib.approve(
          short.signer,
          short.config as never,
          ACCOUNT,
          TOKEN,
          EXCHANGE,
          '3.5',
          false,
          6
        )
        expect(typeof response).not.to.equal('number')
        expect(response).not.to.equal(null)
        expect(short.sent).to.have.length(1)
        expect(short.sent[0].to).to.equal(TOKEN)
        const [spender, amount] = WRITES.decodeFunctionData(
          'approve',
          String(short.sent[0].data)
        )
        expect(spender).to.equal(EXCHANGE)
        // 3.5 at the 6 decimals passed in, not 2 + 3.5 and not at 18.
        expect(amount).to.equal(3_500_000n)
      })

      it('approveWei() with force sends approve(spender, amount) with the amount unconverted, and resolves null when the send fails (approveFeeWei checks the allowance itself, passes force, and throws on null)', async () => {
        const chain = fakeChain({ allowance: 10n ** 30n })
        const response = await lib.approveWei(
          chain.signer,
          chain.config as never,
          ACCOUNT,
          TOKEN,
          DATATOKEN,
          '1234',
          true
        )
        expect(response).not.to.equal(null)
        expect(chain.sent).to.have.length(1)
        expect(
          WRITES.decodeFunctionData('approve', String(chain.sent[0].data))
        ).to.deep.equal([DATATOKEN, 1234n])

        const failing = fakeChain({ sendError: new Error('rejected') })
        spyOnLoggerError(lib)
        await expect(
          lib.approveWei(
            failing.signer,
            failing.config as never,
            ACCOUNT,
            TOKEN,
            DATATOKEN,
            '1234',
            true
          )
        ).resolves.to.equal(null)
      })

      it('Datatoken.createFixedRate forwards fixedRate and marketFee unconverted, and createDispenser maxTokens and maxBalance (createPricingForDatatoken converts them; a converting ocean.js would scale prices by 1e18)', async () => {
        const chain = fakeChain()
        const datatoken = new lib.Datatoken(
          chain.signer,
          CHAIN_ID,
          chain.config as never
        )

        await datatoken.createFixedRate(DATATOKEN, ACCOUNT, {
          fixedRateAddress: EXCHANGE,
          baseTokenAddress: TOKEN,
          owner: ACCOUNT,
          marketFeeCollector: OTHER,
          baseTokenDecimals: 18,
          datatokenDecimals: 18,
          fixedRate: '7',
          marketFee: '3',
          withMint: true
        })
        await datatoken.createDispenser(DATATOKEN, ACCOUNT, DISPENSER, {
          maxTokens: '2',
          maxBalance: '5',
          withMint: true
        })

        const [, , uints] = WRITES.decodeFunctionData(
          'createFixedRate',
          String(chain.sent[0].data)
        )
        expect([...uints]).to.deep.equal([18n, 18n, 7n, 3n, 1n])
        const [, maxTokens, maxBalance] = WRITES.decodeFunctionData(
          'createDispenser',
          String(chain.sent[1].data)
        )
        expect([maxTokens, maxBalance]).to.deep.equal([2n, 5n])
      })

      it("Nft.createDatatoken refuses an address without deployERC20 before estimating or sending anything ('Caller is not DatatokenDeployer'; createDatatokenForService passes the owner, PR 6's owner from chain relies on the refusal)", async () => {
        const chain = fakeChain({ roles: { deployERC20: false } })
        const nft = new lib.Nft(chain.signer, CHAIN_ID, chain.config as never)

        await expect(
          nft.createDatatoken(
            NFT,
            OTHER,
            OTHER,
            OTHER,
            OTHER,
            TOKEN,
            '0',
            '1000'
          )
        ).rejects.toThrow('Caller is not DatatokenDeployer')
        expect(chain.reads).to.deep.equal(['getPermissions'])
        expect(chain.estimated).to.have.length(0)
        expect(chain.sent).to.have.length(0)
      })
    })

    describe('its chain config (PR 2, N7 part 1: src/utils/contracts.ts, order.ts, pricing.ts, publish/reuse.ts pass the config)', () => {
      it("ConfigHelper.getConfig(undefined) logs 'No config found…' through LoggerInstance and returns null; a contract built without a config for an unknown chain does the same, one built with a config does not", () => {
        const error = spyOnLoggerError(lib)
        const chain = fakeChain()

        expect(new lib.ConfigHelper().getConfig(undefined as never)).to.equal(
          null
        )
        expect(error).toHaveBeenCalledWith(
          "No config found for given network 'undefined'"
        )

        error.mockClear()
        new lib.Datatoken(chain.signer, CHAIN_ID, chain.config as never)
        new lib.Nft(chain.signer, CHAIN_ID, chain.config as never)
        expect(error).not.toHaveBeenCalled()

        new lib.Datatoken(chain.signer, undefined as never)
        expect(error).toHaveBeenCalledWith(
          "No config found for given network 'undefined'"
        )
      })
    })

    describe('its node requests (src/node/OceanNodeClient.ts)', () => {
      it('signRequest signs toBeArray(keccak256(message)), which drops leading zero bytes (OceanNodeClient signs every command with it; PR 8 must sign the same way; isIndexerNonceSignable mirrors the node side)', async () => {
        const wallet = new Wallet(id('nautilus ocean.js contract: test key'))
        // A message whose hash starts with a zero byte: there the two forms differ.
        const message = `${wallet.address}${ZERO_BYTE_NONCE}decryptDDO`
        const hash = keccak256(toUtf8Bytes(message))
        expect(hash.startsWith('0x00')).to.equal(true)

        const signature = await lib.signRequest(wallet, message)

        expect(verifyMessage(toBeArray(hash), signature)).to.equal(
          wallet.address
        )
        expect(verifyMessage(getBytes(hash), signature)).not.to.equal(
          wallet.address
        )
      })

      it('Aquarius.querySearch POSTs the query as JSON to <node>/api/aquarius/assets/metadata/query and returns the answer unchanged (OceanNodeClient.query, resolveMany and getAssets read both answer shapes)', async () => {
        const answer = [{ results: [{ id: DID }], totalResults: 1 }]
        const fetch = vi.fn(async () => Response.json(answer))
        vi.stubGlobal('fetch', fetch)
        const query = { query: { bool: { filter: [{ term: { id: DID } }] } } }
        const signal = new AbortController().signal

        const result = await new lib.Aquarius(NODE).querySearch(query, signal)

        expect(result).to.deep.equal(answer)
        expect(fetch).toHaveBeenCalledTimes(1)
        const [url, init] = fetch.mock.calls[0] as unknown as [
          string,
          RequestInit
        ]
        expect(url).to.equal(`${NODE}/api/aquarius/assets/metadata/query`)
        expect(init.method).to.equal('POST')
        expect(JSON.parse(String(init.body))).to.deep.equal(query)
        expect(init.signal).to.equal(signal)
      })
    })
  }
)

/** A nonce for which `<test wallet address><nonce>decryptDDO` hashes to `0x00…`. */
const ZERO_BYTE_NONCE = findZeroByteNonce()

function findZeroByteNonce(): number {
  const address = new Wallet(id('nautilus ocean.js contract: test key')).address
  for (let nonce = 0; ; nonce++)
    if (
      keccak256(toUtf8Bytes(`${address}${nonce}decryptDDO`)).startsWith('0x00')
    )
      return nonce
}

function providerFee() {
  return {
    providerFeeAddress: OTHER,
    providerFeeToken: TOKEN,
    providerFeeAmount: '0',
    v: '27',
    r: `0x${'01'.repeat(32)}`,
    s: `0x${'02'.repeat(32)}`,
    providerData: '0x',
    validUntil: '0'
  }
}

function orderParams() {
  return {
    consumer: ACCOUNT,
    serviceIndex: 0,
    _providerFee: providerFee(),
    _consumeMarketFee: {
      consumeMarketFeeAddress: OTHER,
      consumeMarketFeeToken: TOKEN,
      consumeMarketFeeAmount: '0'
    }
  }
}

function freParams() {
  return {
    exchangeContract: EXCHANGE,
    exchangeId: `0x${'ee'.repeat(32)}`,
    maxBaseTokenAmount: '1',
    baseTokenAddress: TOKEN,
    baseTokenDecimals: 18,
    swapMarketFee: '0',
    marketFeeAddress: OTHER
  }
}
