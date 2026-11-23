/**
 * A narrow client for walt.id's **wallet-api2** (OpenID4VP 1.0, DCQL), as the pontusx
 * identity stack runs it (deltaDAO/pontusx-identity): organisations, wallets per EVM
 * address, keys in OpenBao, and sign-in through Hanko.
 *
 * Presenting is handle based, so what is signed is exactly what was reviewed:
 *
 *   1. `POST /wallet/{walletId}/credentials/present/preview-handle` resolves the request
 *      once and answers an opaque, single-use handle (300 s) with the preview: the verifier,
 *      the `transaction_data`, the credentials matching each DCQL query, and the required
 *      combinations of query ids;
 *   2. `POST …/present/submit-handle` signs and sends exactly that request with the chosen
 *      credentials, or `POST …/present/reject-handle` declines it.
 *
 * The one-shot `present` routes are refused by the platform. Every call carries the
 * account's session token (`Authorization: Bearer`, a Hanko session JWT on the platform),
 * which nautilus cannot mint from an EVM key: pass it, or a function that returns a fresh
 * one.
 */
import { debugEnabled, debugRaw } from '../../log/debug.js'
import { sanitize } from '../../node/messages.js'
import { errorMessage, fetchText } from '../../utils/http.js'
import { assertSecureTransport } from '../../utils/transport.js'
import { WaltIdWalletError } from './client.js'

/** How much of wallet-api2's answer goes into a `WaltIdWalletError`. */
const MAX_WALLET_MESSAGE_LENGTH = 500
/** The largest answer read: a preview carries the matching credentials' data. */
const MAX_WALLET_REPLY_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

/** One wallet of the caller's organisation, by the EVM address it belongs to. */
export interface WalletApi2WalletRef {
  walletId: string
  address?: string
  walletName?: string
}

/** One credential of the wallet that matches one DCQL query. */
export interface WalletApi2CredentialOption {
  queryId: string
  credentialId: string
  /** The query accepts several credentials. */
  multiple?: boolean
  format?: string
  issuer?: string
  subject?: string
  label?: string
  /** The credential's data (claims): never logged by nautilus. */
  credentialData?: unknown
  /** `org`: held in the organisation's store; `wallet`: the wallet's own. */
  store?: string
}

/** A `transaction_data` item of the request, decoded. */
export interface WalletApi2TransactionData {
  type: string
  credentialQueryIds?: string[]
  details?: Record<string, unknown>
  rawJson?: Record<string, unknown>
}

/** Who the presentation is signed as, as wallet-api2 resolved it at preview. */
export interface WalletApi2Holder {
  did: string
  keyId?: string
  verificationMethod?: string
  alg?: string
  source?: string
}

/** wallet-api2's preview of a presentation request (`PresentationPreviewResponse`). */
export interface WalletApi2Preview {
  /** The request is valid and can be answered. */
  valid: boolean
  keyId?: string
  clientId?: string
  verifier?: { name?: string }
  /** Where the presentation will be posted. */
  responseUri?: string
  transactionData: WalletApi2TransactionData[]
  credentialOptions: WalletApi2CredentialOption[]
  /**
   * The required combinations: for each, one of its `options` (a list of query ids) must be
   * presented in full. Optional credential sets are not listed.
   */
  credentialRequirements: { options: string[][] }[]
  /** Why the request is not valid (an OpenID4VP error code). */
  error?: { code: string; message?: string }
  holder?: WalletApi2Holder
}

/** What `preview-handle` answers. */
export interface WalletApi2PreviewHandle {
  /** Opaque and single use: consumed by `submit` or `reject`, even a failed one. */
  handle: string
  expiresAt?: string
  preview: WalletApi2Preview
}

/** What `submit-handle` answers. */
export interface WalletApi2SubmitResult {
  /** `false` when the verifier refused the presentation. */
  transmissionSuccess?: boolean
  /** The verifier's redirect, when it sent one. */
  redirectTo?: string
}

/** The wallet-api2 calls `WalletApi2CredentialProvider` makes. */
export interface WalletApi2 {
  /** The wallets of the caller's organisation the caller may use (`GET /org/wallets`). */
  listWallets(signal?: AbortSignal): Promise<WalletApi2WalletRef[]>
  previewPresentation(
    walletId: string,
    request: { requestUrl: string; did?: string; keyId?: string },
    signal?: AbortSignal
  ): Promise<WalletApi2PreviewHandle>
  submitPresentation(
    walletId: string,
    request: {
      handle: string
      selectedCredentialOptions: { queryId: string; credentialId: string }[]
      did?: string
      keyId?: string
    },
    signal?: AbortSignal
  ): Promise<WalletApi2SubmitResult>
  rejectPresentation(
    walletId: string,
    request: { handle: string; errorCode?: string; errorDescription?: string },
    signal?: AbortSignal
  ): Promise<void>
}

export interface WalletApi2HttpClientOptions {
  /** Base URL of wallet-api2, e.g. `https://wallet-api.example.org`. */
  apiUrl: string
  /**
   * The account's session token (a Hanko session JWT on the platform), or a function that
   * returns a current one; it is asked for on every request. Sent as `Authorization:
   * Bearer`, never logged.
   */
  token: string | (() => string | Promise<string>)
  /**
   * Accept a plain `http://` `apiUrl` on a host other than a loopback one. Default `false`:
   * the token travels with every request.
   */
  allowInsecureTransport?: boolean
  /** Per-request timeout in milliseconds. Default 30 s. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, max = 2048): string | undefined {
  return typeof value === 'string' && value && value.length <= max
    ? value
    : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/** wallet-api2 over HTTP. */
export class WalletApi2HttpClient implements WalletApi2 {
  private readonly apiUrl: string
  private readonly token: WalletApi2HttpClientOptions['token']
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: WalletApi2HttpClientOptions) {
    if (
      typeof options.apiUrl !== 'string' ||
      !/^https?:\/\//i.test(options.apiUrl.trim())
    )
      throw new WaltIdWalletError('create', 'walletApi must be an http(s) URL')
    try {
      assertSecureTransport(
        options.apiUrl,
        'walletApi',
        options.allowInsecureTransport === true
      )
    } catch (error) {
      throw new WaltIdWalletError('create', errorMessage(error))
    }
    if (!options.token)
      throw new WaltIdWalletError(
        'create',
        'wallet-api2 needs the account session token (token)'
      )

    this.apiUrl = options.apiUrl.replace(/\/+$/, '')
    this.token = options.token
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async listWallets(signal?: AbortSignal): Promise<WalletApi2WalletRef[]> {
    const data = await this.request('org/wallets', 'GET', undefined, signal)
    const list = Array.isArray(data)
      ? data
      : isRecord(data) && Array.isArray(data.wallets)
        ? data.wallets
        : []

    return list.filter(isRecord).flatMap((wallet): WalletApi2WalletRef[] => {
      const walletId = str(wallet.walletId ?? wallet.id, 200)
      if (!walletId) return []
      const address = str(wallet.address, 100)
      const walletName = str(wallet.walletName ?? wallet.name, 200)
      return [
        {
          walletId,
          ...(address ? { address } : {}),
          ...(walletName ? { walletName } : {})
        }
      ]
    })
  }

  async previewPresentation(
    walletId: string,
    request: { requestUrl: string; did?: string; keyId?: string },
    signal?: AbortSignal
  ): Promise<WalletApi2PreviewHandle> {
    const data = await this.request(
      `wallet/${encodeURIComponent(walletId)}/credentials/present/preview-handle`,
      'POST',
      request,
      signal
    )
    if (debugEnabled('sensitive', 'wallet'))
      debugRaw('wallet', 'presentation preview (preview-handle)', data)

    const handle = isRecord(data) ? str(data.handle, 512) : undefined
    if (!isRecord(data) || !handle || !isRecord(data.preview))
      throw new WaltIdWalletError(
        'credentials/present/preview-handle',
        'wallet-api2 answered without a handle or a preview'
      )

    return {
      handle,
      ...(str(data.expiresAt, 64)
        ? { expiresAt: data.expiresAt as string }
        : {}),
      preview: readPreview(data.preview)
    }
  }

  async submitPresentation(
    walletId: string,
    request: {
      handle: string
      selectedCredentialOptions: { queryId: string; credentialId: string }[]
      did?: string
      keyId?: string
    },
    signal?: AbortSignal
  ): Promise<WalletApi2SubmitResult> {
    const data = await this.request(
      `wallet/${encodeURIComponent(walletId)}/credentials/present/submit-handle`,
      'POST',
      request,
      signal
    )
    if (debugEnabled('sensitive', 'wallet'))
      debugRaw('wallet', 'presentation answer (submit-handle)', data)

    const answer = isRecord(data) ? data : {}
    const success = answer.transmission_success ?? answer.transmissionSuccess
    const redirect = str(answer.redirect_to ?? answer.redirectTo)

    return {
      ...(typeof success === 'boolean' ? { transmissionSuccess: success } : {}),
      ...(redirect ? { redirectTo: redirect } : {})
    }
  }

  async rejectPresentation(
    walletId: string,
    request: { handle: string; errorCode?: string; errorDescription?: string },
    signal?: AbortSignal
  ): Promise<void> {
    await this.request(
      `wallet/${encodeURIComponent(walletId)}/credentials/present/reject-handle`,
      'POST',
      request,
      signal
    )
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    const token =
      typeof this.token === 'function' ? await this.token() : this.token
    if (!token)
      throw new WaltIdWalletError(path, 'no session token for wallet-api2')

    let response: Awaited<ReturnType<typeof fetchText>>
    try {
      response = await fetchText(
        this.fetchImpl,
        `${this.apiUrl}/${path}`,
        {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {})
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        },
        {
          timeoutMs: this.timeoutMs,
          signal,
          maxBodyBytes: MAX_WALLET_REPLY_BYTES
        }
      )
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (debugEnabled('sensitive', 'wallet'))
        debugRaw('wallet', `request to ${path} failed`, error)
      throw new WaltIdWalletError(
        path,
        sanitize(errorMessage(error), MAX_WALLET_MESSAGE_LENGTH, null)
      )
    }

    if (!response.ok) {
      if (debugEnabled('sensitive', 'wallet'))
        debugRaw('wallet', `answer HTTP ${response.status} to ${path}`, {
          status: response.status,
          body: response.body
        })
      throw new WaltIdWalletError(
        path,
        walletErrorText(response.body) ||
          `${response.status} ${response.statusText}`.trim(),
        response.status
      )
    }

    if (!response.body.trim()) return undefined
    try {
      return JSON.parse(response.body)
    } catch {
      throw new WaltIdWalletError(
        path,
        'wallet-api2 answered with something that is not JSON'
      )
    }
  }
}

/** The message of a wallet-api2 error answer (`{ error, message }`), redacted and bounded. */
function walletErrorText(body: string): string {
  let said: string | undefined
  try {
    const parsed: unknown = JSON.parse(body)
    if (isRecord(parsed))
      said = [parsed.message, parsed.error, parsed.code].find(
        (text): text is string => typeof text === 'string' && !!text.trim()
      )
  } catch {
    said = body
  }
  return said ? sanitize(said, MAX_WALLET_MESSAGE_LENGTH, null) : ''
}

/** The parts of a preview nautilus reads, with their types checked. */
function readPreview(raw: Record<string, unknown>): WalletApi2Preview {
  const transactionData =
    raw.transactionData === undefined ? [] : raw.transactionData
  if (
    !Array.isArray(transactionData) ||
    transactionData.length > 50 ||
    !transactionData.every(isRecord)
  )
    return {
      valid: false,
      error: { code: 'invalid_request', message: 'Invalid transaction data.' },
      transactionData: [],
      credentialOptions: [],
      credentialRequirements: []
    }

  const error = isRecord(raw.error)
    ? {
        code: str(raw.error.code, 100) ?? 'invalid_request',
        ...(str(raw.error.message, 500)
          ? { message: raw.error.message as string }
          : {})
      }
    : undefined
  const holder =
    isRecord(raw.holder) && str(raw.holder.did, 2200)
      ? {
          did: raw.holder.did as string,
          ...(str(raw.holder.keyId, 300)
            ? { keyId: raw.holder.keyId as string }
            : {}),
          ...(str(raw.holder.verificationMethod, 2200)
            ? { verificationMethod: raw.holder.verificationMethod as string }
            : {}),
          ...(str(raw.holder.alg, 30) ? { alg: raw.holder.alg as string } : {}),
          ...(str(raw.holder.source, 30)
            ? { source: raw.holder.source as string }
            : {})
        }
      : undefined
  const verifierName = isRecord(raw.verifier)
    ? str(raw.verifier.name, 200)
    : undefined

  return {
    valid: raw.valid === true,
    ...(str(raw.keyId, 300) ? { keyId: raw.keyId as string } : {}),
    ...(str(raw.clientId) ? { clientId: raw.clientId as string } : {}),
    ...(verifierName ? { verifier: { name: verifierName } } : {}),
    ...(str(raw.responseUri) ? { responseUri: raw.responseUri as string } : {}),
    transactionData: transactionData.map((item) => ({
      type: typeof item.type === 'string' ? item.type : '',
      credentialQueryIds: stringArray(item.credentialQueryIds),
      ...(isRecord(item.details) ? { details: item.details } : {}),
      ...(isRecord(item.rawJson) ? { rawJson: item.rawJson } : {})
    })),
    credentialOptions: (Array.isArray(raw.credentialOptions)
      ? raw.credentialOptions
      : []
    )
      .filter(isRecord)
      .slice(0, 500)
      .flatMap((option): WalletApi2CredentialOption[] => {
        const queryId = str(option.queryId, 200)
        const credentialId = str(option.credentialId, 200)
        if (!queryId || !credentialId) return []
        return [
          {
            queryId,
            credentialId,
            multiple: option.multiple === true,
            ...(str(option.format, 50)
              ? { format: option.format as string }
              : {}),
            ...(str(option.issuer) ? { issuer: option.issuer as string } : {}),
            ...(str(option.subject)
              ? { subject: option.subject as string }
              : {}),
            ...(str(option.label, 500)
              ? { label: option.label as string }
              : {}),
            ...(option.credentialData !== undefined
              ? { credentialData: option.credentialData }
              : {}),
            ...(str(option.store, 20) ? { store: option.store as string } : {})
          }
        ]
      }),
    credentialRequirements: (Array.isArray(raw.credentialRequirements)
      ? raw.credentialRequirements
      : []
    )
      .filter(isRecord)
      .map((requirement) => ({
        options: (Array.isArray(requirement.options)
          ? requirement.options
          : []
        ).filter(
          (option): option is string[] =>
            Array.isArray(option) &&
            option.length > 0 &&
            option.every((id) => typeof id === 'string')
        )
      }))
      .filter((requirement) => requirement.options.length > 0),
    ...(error ? { error } : {}),
    ...(holder ? { holder } : {})
  }
}
