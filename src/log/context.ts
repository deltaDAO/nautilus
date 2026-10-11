/**
 * The operation context: which public call (`publish`, `access`, …) an event belongs to.
 *
 * Each call gets a short random `opId`. In Node it travels through the call's whole async
 * tree in an `AsyncLocalStorage`, so every event the call causes carries it: the node
 * client's, the process-wide logger's, the sensitive debug channel's. Without one (a
 * browser bundle), the call hands it down as a parameter instead: a logger bound to the
 * context, which the call passes to the functions it calls. Events of code that is not
 * handed that logger (the node client, the policy-session resolver, the process-wide
 * logger) then carry no `opId`, never a wrong one.
 *
 * The error a call throws carries its `opId` too, as `error.opId`, so a bug report's error
 * leads straight to its log lines.
 *
 * Nothing in the context comes from the caller, the node or the chain: the `opId` is
 * random and the operation is one of the names below.
 */

import type { Logger } from './logger.js'

/** The public calls that open an operation. */
export type OperationName =
  | 'publish'
  | 'completePublish'
  | 'edit'
  | 'setServicePrice'
  | 'setAssetLifecycleState'
  | 'access'
  | 'compute'
  | 'freeCompute'
  | 'getComputeStatus'
  | 'getComputeResult'
  | 'stopCompute'
  | 'waitForIndexer'

/** One running operation. */
export interface OperationContext {
  /** 8 lower-case hex characters, random. */
  readonly opId: string
  readonly operation: OperationName
  /** When it started, in ms (`performance.now()` where there is one). */
  readonly startedAt: number
}

/** The part of `AsyncLocalStorage` this module uses. */
interface ContextStorage {
  getStore(): OperationContext | undefined
  run<R>(store: OperationContext, callback: () => R): R
}

/**
 * Node's `AsyncLocalStorage`, through `process.getBuiltinModule` so that no bundle has to
 * resolve `node:async_hooks`. `undefined` without it: a browser, or Node before 22.3.
 */
function asyncStorage(): ContextStorage | undefined {
  try {
    const process = (
      globalThis as {
        process?: { getBuiltinModule?: (id: string) => unknown }
      }
    ).process
    const hooks = process?.getBuiltinModule?.('node:async_hooks') as
      | { AsyncLocalStorage?: new () => ContextStorage }
      | undefined
    return hooks?.AsyncLocalStorage ? new hooks.AsyncLocalStorage() : undefined
  } catch {
    return undefined
  }
}

const nodeStorage = asyncStorage()
let storage = nodeStorage

/**
 * Turns the `AsyncLocalStorage` off (`false`), as in a browser, or back on. Returns
 * whether it was on. Only for tests.
 */
export function useAsyncContext(on: boolean): boolean {
  const was = storage !== undefined
  storage = on ? nodeStorage : undefined
  return was
}

/** The operation the current async call tree belongs to, where `AsyncLocalStorage` tells. */
export function currentOperation(): OperationContext | undefined {
  try {
    return storage?.getStore()
  } catch {
    return undefined
  }
}

/** The catalogued events of one kind of operation. */
interface OperationEvents {
  started:
    | 'publish.operation.started'
    | 'edit.operation.started'
    | 'lifecycle.operation.started'
    | 'access.operation.started'
    | 'compute.operation.started'
    | 'compute.query.started'
    | 'node.operation.started'
  finished:
    | 'publish.operation.finished'
    | 'edit.operation.finished'
    | 'lifecycle.operation.finished'
    | 'access.operation.finished'
    | 'compute.operation.finished'
    | 'compute.query.finished'
    | 'node.operation.finished'
  failed:
    | 'publish.operation.failed'
    | 'edit.operation.failed'
    | 'lifecycle.operation.failed'
    | 'access.operation.failed'
    | 'compute.operation.failed'
    | 'compute.query.failed'
    | 'node.operation.failed'
}

const PUBLISH: OperationEvents = {
  started: 'publish.operation.started',
  finished: 'publish.operation.finished',
  failed: 'publish.operation.failed'
}
const EDIT: OperationEvents = {
  started: 'edit.operation.started',
  finished: 'edit.operation.finished',
  failed: 'edit.operation.failed'
}
const COMPUTE: OperationEvents = {
  started: 'compute.operation.started',
  finished: 'compute.operation.finished',
  failed: 'compute.operation.failed'
}
/** Reads of a job, which apps poll: their events are all `debug`. */
const COMPUTE_QUERY: OperationEvents = {
  started: 'compute.query.started',
  finished: 'compute.query.finished',
  failed: 'compute.query.failed'
}

const EVENTS: Record<OperationName, OperationEvents> = {
  publish: PUBLISH,
  completePublish: PUBLISH,
  edit: EDIT,
  setServicePrice: EDIT,
  setAssetLifecycleState: {
    started: 'lifecycle.operation.started',
    finished: 'lifecycle.operation.finished',
    failed: 'lifecycle.operation.failed'
  },
  access: {
    started: 'access.operation.started',
    finished: 'access.operation.finished',
    failed: 'access.operation.failed'
  },
  compute: COMPUTE,
  freeCompute: COMPUTE,
  stopCompute: COMPUTE,
  getComputeStatus: COMPUTE_QUERY,
  getComputeResult: COMPUTE_QUERY,
  waitForIndexer: {
    started: 'node.operation.started',
    finished: 'node.operation.finished',
    failed: 'node.operation.failed'
  }
}

/**
 * Runs `run` as the operation `name`: a new `opId`, an `…started` event, then
 * `…finished` or `…failed` with `durationMs`, and the `opId` on the error it throws.
 * `run` gets `logger` bound to the operation: pass it to whatever the operation calls.
 *
 * Inside another operation (a call made from a callback of one, such as
 * `confirmProviderFees`), `run` joins it: no new `opId`, no events of its own.
 */
export async function runOperation<T>(
  logger: Logger,
  name: OperationName,
  run: (log: Logger) => Promise<T>
): Promise<T> {
  const outer = currentOperation()
  if (outer) return run(logger.withOperation(outer))

  const context: OperationContext = {
    opId: newOpId(),
    operation: name,
    startedAt: now()
  }
  const log = logger.withOperation(context)
  const events = EVENTS[name]

  const operation = async (): Promise<T> => {
    log.emit(events.started, `${name} started.`)
    try {
      const result = await run(log)
      const durationMs = elapsed(context)
      log.emit(events.finished, `${name} finished in ${durationMs} ms.`, {
        durationMs
      })
      return result
    } catch (error) {
      const durationMs = elapsed(context)
      log.emit(events.failed, `${name} failed after ${durationMs} ms.`, {
        durationMs,
        error
      })
      tagError(error, context.opId)
      throw error
    }
  }

  return storage ? storage.run(context, operation) : operation()
}

/**
 * Sets `error.opId`, unless the error has one already (it came from another operation
 * first) or cannot take one (not an object, frozen). Not enumerable, so the error
 * compares, prints and serialises as it did.
 */
function tagError(error: unknown, opId: string): void {
  if (
    (typeof error !== 'object' && typeof error !== 'function') ||
    error === null ||
    Object.hasOwn(error, 'opId')
  )
    return
  try {
    Object.defineProperty(error, 'opId', {
      value: opId,
      enumerable: false,
      writable: true,
      configurable: true
    })
  } catch {
    // A frozen or sealed error keeps no opId.
  }
}

/** 8 random lower-case hex characters. */
function newOpId(): string {
  const bytes = new Uint8Array(4)
  const crypto = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array }
    }
  ).crypto
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes)
  else
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}

/** Whole ms since the operation started. */
function elapsed(context: OperationContext): number {
  return Math.max(0, Math.round(now() - context.startedAt))
}
