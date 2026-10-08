/**
 * Stores the encrypted DDO envelope on IPFS.
 *
 * Deliberately unopinionated about *which* IPFS service: it POSTs the payload as a
 * multipart file to an upload endpoint you supply and reads the CID out of the response.
 * That covers a Kubo node (`/api/v0/add`), a pinning service, or an in-house uploader,
 * without nautilus taking a dependency on any IPFS client.
 *
 * Pinata works through its file endpoint:
 *
 *   new IpfsRemoteStore({
 *     uploadUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
 *     headers: { Authorization: `Bearer ${jwt}` },
 *     probe: 'upload',
 *     gatewayUrl: 'https://gateway.pinata.cloud'
 *   })
 *
 * with an API key that has the pin (and, to clean up, unpin) scopes. Pinata reports a
 * missing scope only on a real upload, which is what `probe: 'upload'` is for. Do not use
 * `pinJSONToIPFS`: it re-wraps the body, so the stored bytes are no longer the envelope.
 *
 * `verify()` reads the envelope back before the metadata transaction: through `gatewayUrl`
 * when set, otherwise, for a Kubo `uploadUrl` (`…/api/v0/add`), through the same node's
 * `/api/v0/cat`. Any other store needs a `gatewayUrl`, or `verify: false` to publish without
 * the read-back; `check()` and `verify()` refuse to go on without one of them.
 *
 * `remove(pointer)` unpins a CID. For Pinata (`…/pinning/pinFileToIPFS`) and Kubo
 * (`…/api/v0/add`) the unpin endpoint is derived from `uploadUrl`; for anything else pass
 * `unpin: { url }`. Unpinning releases this service's copy: IPFS has no delete, so nodes or
 * gateways that fetched the CID may keep serving it until they garbage-collect it. The
 * envelope is ciphertext either way.
 *
 * `uploadUrl`, `gatewayUrl`, `probe.url` and `unpin.url` must be `https://`, except on
 * loopback hosts or with `allowInsecureTransport`, and must not carry `user:password@`
 * credentials (pass those in `headers`). Only the `gatewayUrl` read in `verify()` follows
 * redirects; every other request carries credentials or the envelope, so a redirect fails
 * it. Upstream error bodies are cut to 300 characters and scrubbed of the configured header
 * values and anything that looks like a token before they reach an error message; network
 * errors are rethrown without fetch's raw error as `cause`.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import {
  errorMessage,
  fetchText,
  RedirectError,
  RequestTimeoutError
} from '../utils/http.js'
import { assertSecureTransport } from '../utils/transport.js'
import { isCid } from './cid.js'
import type { RemoteStore } from './RemoteStore.js'
import { assertStoredHash } from './verify.js'

export interface IpfsRemoteStoreOptions {
  /** Upload endpoint, e.g. `http://127.0.0.1:5001/api/v0/add`. */
  uploadUrl: string
  /** Extra headers for the upload, e.g. a pinning-service API key. */
  headers?: Record<string, string>
  /**
   * Pulls the CID out of the upload response. Defaults to the common
   * `Hash` / `cid` / `IpfsHash` keys used by Kubo, web3.storage and Pinata. Whatever it
   * returns must be a CIDv0 (`Qm…`) or a base32/base36 CIDv1 (`b…`/`k…`).
   */
  extractCid?: (response: unknown) => string | undefined
  /**
   * What `check()` does before `publish()` sends its first transaction.
   *
   *   - `'upload'`: uploads a fixed probe of a few bytes (always the same CID). The only
   *     check that catches a pinning-service key without upload scope.
   *   - `{ url, method?, headers? }`: an authenticated test call, e.g. Pinata's
   *     `/data/testAuthentication`. Must answer 2xx. It is sent `headers` when given, and
   *     otherwise the upload `headers`, but only if `url` has the same origin as
   *     `uploadUrl`, so credentials never go to another host by accident.
   *
   * Omit to skip the check.
   */
  probe?:
    | 'upload'
    | { url: string; method?: string; headers?: Record<string, string> }
  /**
   * An IPFS gateway to read the envelope back from before the metadata transaction, e.g.
   * the one the node uses (`IPFS_GATEWAY`). nautilus fetches `<gatewayUrl>/ipfs/<cid>`, as
   * the node does, and checks the hash. Without it, a Kubo `uploadUrl` (`…/api/v0/add`) is
   * read back through the same node's `/api/v0/cat`; any other `uploadUrl` needs this, or
   * `verify: false`.
   */
  gatewayUrl?: string
  /**
   * `false` publishes without reading the envelope back: `verify()` then resolves without
   * a request, and nothing checks the stored bytes before the metadata transaction. Only for
   * a store with neither a `gatewayUrl` nor a Kubo `uploadUrl`; it cannot be combined with
   * `gatewayUrl`. Without it, such a store's `check()` and `verify()` throw.
   */
  verify?: false
  /**
   * How `remove()` unpins a CID. By default it is derived from `uploadUrl`:
   *
   *   - Pinata, `…/pinning/pinFileToIPFS`: `DELETE <origin>/pinning/unpin/<cid>`;
   *   - Kubo, `…/api/v0/add`: `POST <same base>/api/v0/pin/rm?arg=<cid>`.
   *
   * For another service pass `{ url, method?, headers? }`, with `{cid}` in `url` where the
   * CID goes (`method` defaults to `DELETE`). Like a probe, it is sent `headers` when given,
   * and otherwise the upload `headers` only if `url` has the same origin as `uploadUrl`.
   * `false` turns `remove()` off. A CID the service reports as not pinned counts as removed:
   * Kubo's and Pinata's own JSON answers for it, and a 404 from a configured `unpin`.
   */
  unpin?:
    | false
    | { url: string; method?: string; headers?: Record<string, string> }
  /** Allow plain `http://` on a non-loopback host. Default `false`. */
  allowInsecureTransport?: boolean
  /** Per-request timeout, body included. Default 60 s. */
  requestTimeoutMs?: number
  fetchImpl?: typeof fetch
}

/** The probe upload. Fixed, so repeated checks pin one and the same CID. */
const PROBE_PAYLOAD = '{"nautilus":"remote-store-check"}'

const DEFAULT_CID_KEYS = ['Hash', 'cid', 'Cid', 'IpfsHash', 'hash'] as const

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

/** How much of an upstream body goes into an error message. */
const MAX_BODY_IN_ERROR = 300

function defaultExtractCid(response: unknown): string | undefined {
  if (typeof response === 'string') return response.trim() || undefined
  if (!response || typeof response !== 'object') return undefined

  const record = response as Record<string, unknown>

  for (const key of DEFAULT_CID_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value) return value
  }

  return undefined
}

export class IpfsRemoteStore implements RemoteStore {
  private readonly options: IpfsRemoteStoreOptions
  private readonly fetchImpl: typeof fetch

  constructor(options: IpfsRemoteStoreOptions) {
    if (!options?.uploadUrl?.trim())
      throw new Error('IpfsRemoteStore needs an uploadUrl.')

    // Credentials in a URL first: the transport check below echoes the URL it refuses.
    assertUrlWithoutCredentials(options.uploadUrl, 'IpfsRemoteStore uploadUrl')
    assertSecureTransport(
      options.uploadUrl,
      'IpfsRemoteStore uploadUrl',
      options.allowInsecureTransport
    )
    if (options.verify === false && options.gatewayUrl)
      throw new Error(
        'IpfsRemoteStore: gatewayUrl is only used to verify, so it cannot be combined with verify: false.'
      )
    if (options.gatewayUrl) {
      assertUrlWithoutCredentials(
        options.gatewayUrl,
        'IpfsRemoteStore gatewayUrl'
      )
      assertSecureTransport(
        options.gatewayUrl,
        'IpfsRemoteStore gatewayUrl',
        options.allowInsecureTransport
      )
    }
    // A falsy probe is off, as in check().
    if (options.probe) assertProbe(options.probe)
    if (options.probe && options.probe !== 'upload') {
      assertUrlWithoutCredentials(
        options.probe.url,
        'IpfsRemoteStore probe.url'
      )
      assertSecureTransport(
        options.probe.url,
        'IpfsRemoteStore probe.url',
        options.allowInsecureTransport
      )
    }
    if (options.unpin) {
      if (!options.unpin.url?.includes('{cid}'))
        throw new Error(
          'IpfsRemoteStore unpin.url needs a {cid} placeholder, e.g. https://pin.example.org/pins/{cid}.'
        )
      assertUrlWithoutCredentials(
        options.unpin.url,
        'IpfsRemoteStore unpin.url'
      )
      assertSecureTransport(
        options.unpin.url,
        'IpfsRemoteStore unpin.url',
        options.allowInsecureTransport
      )
    }

    this.options = options
    this.fetchImpl = options.fetchImpl || fetch
  }

  /**
   * Throws when `verify()` would have no way to read the envelope back (see `gatewayUrl`
   * and `verify`), then runs the configured `probe`, if any. Throws if the store would
   * refuse an upload.
   */
  async check(): Promise<void> {
    const { probe } = this.options

    // Before anything is minted: verify() runs only right before the metadata transaction.
    if (
      this.options.verify !== false &&
      !this.options.gatewayUrl &&
      !kuboApiBase(this.options.uploadUrl)
    )
      throw cannotReadBack(this.options.uploadUrl)

    if (!probe) return

    if (probe === 'upload') {
      await this.put(PROBE_PAYLOAD, { did: 'nautilus-remote-store-check' })
      return
    }

    const response = await this.send(
      'IPFS store check',
      probe.url,
      {
        method: probe.method || 'GET',
        headers: this.probeHeaders(probe)
      },
      [probe.headers, this.options.headers]
    )

    if (!response.ok)
      throw new Error(
        `IPFS store check failed: ${response.status} ${response.statusText} ${this.scrub(response.body, [probe.headers])}`.trim()
      )
  }

  async put(payload: string, hint: { did: string }): Promise<StorageObject> {
    const form = new FormData()
    form.append(
      'file',
      new Blob([payload], { type: 'application/json' }),
      `${hint.did}.json`
    )

    const response = await this.send('IPFS upload', this.options.uploadUrl, {
      method: 'POST',
      headers: this.options.headers,
      body: form
    })

    if (!response.ok)
      throw new Error(
        `IPFS upload failed: ${response.status} ${response.statusText} ${this.scrub(response.body)}`.trim()
      )

    let parsed: unknown = response.body
    try {
      parsed = JSON.parse(response.body)
    } catch {
      // A bare CID as plain text is a valid response.
    }

    const extract = this.options.extractCid || defaultExtractCid
    const hash = extract(parsed)

    if (!hash)
      throw new Error(
        `IPFS upload returned no CID. Response was: ${this.scrub(response.body)}`
      )

    if (!isCid(hash))
      throw new Error(
        `IPFS upload returned ${JSON.stringify(this.scrub(hash, [], 100))}, which is not a CIDv0 (Qm…) or CIDv1 (b…/k…). The node would resolve it as a gateway path.`
      )

    return { type: 'ipfs', hash } as StorageObject
  }

  /**
   * Reads the CID back and checks it hashes, as the node hashes it, to `expectedHash`:
   * `GET <gatewayUrl>/ipfs/<cid>` when `gatewayUrl` is set, otherwise, for a Kubo
   * `uploadUrl`, `POST <same base>/api/v0/cat?arg=<cid>` with the upload headers. Throws
   * when it has neither. With `verify: false` it resolves without reading anything.
   */
  async verify(pointer: StorageObject, expectedHash: string): Promise<void> {
    if (this.options.verify === false) return

    const hash = (pointer as { hash?: unknown }).hash

    if (typeof hash !== 'string' || !isCid(hash))
      throw new Error(
        'IpfsRemoteStore.verify: not an IPFS pointer with a valid CID.'
      )

    const readBack = this.readBackRequest(hash)
    const response = await this.send(
      'IPFS verify',
      readBack.url,
      { method: readBack.method, headers: readBack.headers },
      undefined,
      // Only the gateway read carries neither credentials nor a body, so only it may follow
      // a redirect (public gateways redirect to their subdomain form).
      readBack.source === 'gateway'
    )

    if (!response.ok)
      throw new Error(
        `IPFS verify: the ${readBack.source} answered ${response.status} ${response.statusText} for ${hash} (${originOf(readBack.url)})${readBack.source === 'gateway' ? '; the node may not be able to fetch it either' : ''}. ${this.scrub(response.body)}`.trim()
      )

    await assertStoredHash(
      `${hash} via the ${readBack.source} ${originOf(readBack.url)}`,
      response.body,
      expectedHash
    )
  }

  /** How `verify()` reads `cid` back: through `gatewayUrl`, or a Kubo node's `cat`. */
  private readBackRequest(cid: string): {
    url: string
    method: string
    headers?: Record<string, string>
    source: 'gateway' | 'Kubo node'
  } {
    const { gatewayUrl, uploadUrl } = this.options

    if (gatewayUrl)
      return {
        url: `${gatewayUrl.replace(/\/+$/, '')}/ipfs/${cid}`,
        method: 'GET',
        source: 'gateway'
      }

    const kubo = kuboApiBase(uploadUrl)

    if (kubo)
      return {
        // Same origin as the upload, so it gets the upload headers. Kubo's RPC takes POST.
        url: `${kubo}/cat?arg=${encodeURIComponent(cid)}`,
        method: 'POST',
        headers: this.options.headers,
        source: 'Kubo node'
      }

    throw cannotReadBack(uploadUrl)
  }

  /**
   * Unpins the CID behind `pointer` (see `unpin`). Idempotent: a CID the service reports as
   * not pinned counts as removed. It unpins whatever valid CID it is given from this
   * account, so only pass pointers this store returned, such as `PublishResponse.stored.pointer`
   * of a superseded version or a revoked asset. Never called by nautilus on an indexed
   * asset; `publish()`, `completePublish()` and `edit()` call it only for an envelope whose
   * metadata transaction was never sent, or was mined and reverted.
   */
  async remove(pointer: StorageObject): Promise<void> {
    const type = (pointer as { type?: unknown } | undefined)?.type
    const hash = (pointer as { hash?: unknown } | undefined)?.hash

    if (
      typeof type !== 'string' ||
      type.toLowerCase() !== 'ipfs' ||
      typeof hash !== 'string' ||
      !isCid(hash)
    )
      throw new Error(
        'IpfsRemoteStore.remove: not an IPFS pointer with a valid CID.'
      )

    const unpin = this.unpinRequest(hash)
    const response = await this.send(
      'IPFS unpin',
      unpin.url,
      { method: unpin.method, headers: unpin.headers },
      [unpin.secrets, this.options.headers]
    )

    if (response.ok || isNotPinned(response, unpin.service)) return

    throw new Error(
      `IPFS unpin of ${hash} failed: ${response.status} ${response.statusText} ${this.scrub(response.body, [unpin.secrets])}`.trim()
    )
  }

  /** The unpin request for `cid`: configured, or derived from a Pinata or Kubo `uploadUrl`. */
  private unpinRequest(cid: string): {
    url: string
    method: string
    headers?: Record<string, string>
    secrets?: Record<string, string>
    service: UnpinService
  } {
    const { unpin, uploadUrl } = this.options

    if (unpin === false)
      throw new Error('IpfsRemoteStore.remove is turned off (unpin: false).')

    if (unpin) {
      const url = unpin.url.split('{cid}').join(encodeURIComponent(cid))

      return {
        url,
        method: unpin.method || 'DELETE',
        headers: this.probeHeaders({ url, headers: unpin.headers }),
        secrets: unpin.headers,
        service: 'custom'
      }
    }

    const derived = deriveUnpin(uploadUrl, cid)

    if (!derived)
      throw new Error(
        `IpfsRemoteStore.remove: cannot tell how to unpin on ${originOf(uploadUrl)}; only Pinata (…/pinning/pinFileToIPFS) and Kubo (…/api/v0/add) upload URLs are recognised. Pass unpin: { url: 'https://…/{cid}', method }.`
      )

    return { ...derived, headers: this.options.headers }
  }

  /** The upload headers go only to the upload origin, unless the probe names its own. */
  private probeHeaders(probe: {
    url: string
    headers?: Record<string, string>
  }): Record<string, string> | undefined {
    if (probe.headers) return probe.headers

    return sameOrigin(probe.url, this.options.uploadUrl)
      ? this.options.headers
      : undefined
  }

  /**
   * One request. A redirect is not followed, and fails it with fetchText's `RedirectError`,
   * unless `followRedirects`: every request but the gateway read carries credential headers
   * or the envelope, which must not reach another origin.
   *
   * A network error is rethrown with a scrubbed message and without the raw error as
   * `cause`: fetch's own errors can quote a header value (`invalid header value: Bearer …`),
   * and whatever prints the cause would undo the scrubbing.
   */
  private async send(
    what: string,
    url: string,
    init: RequestInit,
    secrets: (Record<string, string> | undefined)[] = [this.options.headers],
    followRedirects = false
  ) {
    try {
      return await fetchText(this.fetchImpl, url, init, {
        timeoutMs: this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        followRedirects
      })
    } catch (error) {
      throw new Error(
        `${what} failed: ${this.scrub(errorMessage(error), secrets)} (${originOf(url)})`,
        // nautilus' own errors carry no upstream text, so they can stay.
        error instanceof RequestTimeoutError || error instanceof RedirectError
          ? { cause: error }
          : undefined
      )
    }
  }

  /** An upstream body, cut short and without anything that could be a credential. */
  private scrub(
    text: string,
    secrets: (Record<string, string> | undefined)[] = [],
    maxLength = MAX_BODY_IN_ERROR
  ): string {
    return scrubSecrets(text, [this.options.headers, ...secrets], maxLength)
  }
}

/**
 * Cuts `text` to `maxLength` characters after removing secrets and token-likes.
 *
 * The configured header values are replaced in the whole text first (a plain, linear
 * search), so none is cut in half and left partly readable. Only then is the text bounded,
 * to a few times `maxLength`, before any regular expression runs: an upstream body has no
 * size limit, and a pattern run over megabytes of hostile input can block the event loop.
 */
function scrubSecrets(
  text: string,
  headerSets: (Record<string, string> | undefined)[] = [],
  maxLength = MAX_BODY_IN_ERROR
): string {
  let scrubbed = text

  for (const headers of headerSets)
    for (const value of Object.values(headers ?? {})) {
      const secret = String(value)
        .replace(/^(Bearer|Basic|Token)\s+/i, '')
        .trim()
      if (secret.length >= 4)
        scrubbed = scrubbed.split(secret).join('<redacted>')
    }

  scrubbed = scrubbed
    .slice(0, maxLength * 4)
    .replace(/\b(Bearer|Basic|Token)\s+[^\s"',;]+/gi, '$1 <redacted>')
    // Also a JWT cut short by the bound above.
    .replace(/eyJ[\w-]*(?:\.[\w-]*){0,2}/g, '<redacted>')
    .replace(
      /((?:api[_-]?key|api[_-]?secret|secret|token|password|authorization|jwt)["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
      '$1<redacted>'
    )

  return scrubbed.length > maxLength
    ? `${scrubbed.slice(0, maxLength)}…`
    : scrubbed
}

/** Which unpin endpoint answered, to read a "not pinned" answer in its own format. */
type UnpinService = 'kubo' | 'pinata' | 'custom'

/**
 * Throws for a URL that does not parse, or that carries a user name or password. fetch
 * refuses such URLs, and the credentials would end up in error messages and logs.
 */
function assertUrlWithoutCredentials(url: string, what: string): void {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new Error(`${what} is not a valid URL.`)
  }

  if (parsed.username || parsed.password)
    throw new Error(
      `${what} carries credentials in the URL (user:password@host). Pass them in headers instead, e.g. headers: { Authorization: 'Basic <base64 of user:password>' }.`
    )
}

/** Throws for a `probe` that is neither `'upload'` nor `{ url, method?, headers? }`. */
function assertProbe(probe: unknown): void {
  if (probe === 'upload') return

  const record =
    probe && typeof probe === 'object' && !Array.isArray(probe)
      ? (probe as Record<string, unknown>)
      : undefined
  const headers = record?.headers

  if (
    record &&
    typeof record.url === 'string' &&
    record.url.trim() &&
    (record.method === undefined || typeof record.method === 'string') &&
    (headers === undefined ||
      (headers !== null &&
        typeof headers === 'object' &&
        !Array.isArray(headers) &&
        Object.values(headers).every((value) => typeof value === 'string')))
  )
    return

  throw new Error(
    `IpfsRemoteStore probe must be 'upload' or { url, method?, headers? } with a non-empty url and string header values; got ${typeof probe === 'string' ? 'another string' : Array.isArray(probe) ? 'an array' : record ? 'an object without them' : typeof probe}. Omit it to skip the check.`
  )
}

/**
 * The unpin call matching a known upload endpoint, on the same origin (so it gets the upload
 * headers), or `undefined`.
 */
function deriveUnpin(
  uploadUrl: string,
  cid: string
): { url: string; method: string; service: UnpinService } | undefined {
  let url: URL
  try {
    url = new URL(uploadUrl)
  } catch {
    return undefined
  }

  const path = url.pathname.replace(/\/+$/, '')
  const arg = encodeURIComponent(cid)

  if (/\/pinning\/pinFileToIPFS$/i.test(path))
    return {
      url: `${url.origin}${path.replace(/\/pinning\/pinFileToIPFS$/i, '')}/pinning/unpin/${arg}`,
      method: 'DELETE',
      service: 'pinata'
    }

  const kubo = kuboApiBase(uploadUrl)
  if (kubo)
    return { url: `${kubo}/pin/rm?arg=${arg}`, method: 'POST', service: 'kubo' }

  return undefined
}

function cannotReadBack(uploadUrl: string): Error {
  return new Error(
    `IpfsRemoteStore cannot read the envelope back from ${originOf(uploadUrl)} before the metadata transaction: without a gatewayUrl, only a Kubo uploadUrl (…/api/v0/add) can be read back. Set gatewayUrl (ideally the gateway the node uses, its IPFS_GATEWAY), or pass verify: false to publish without that check.`
  )
}

/**
 * `<origin><prefix>/api/v0` for a Kubo `uploadUrl` (`…/api/v0/add`, query dropped), or
 * `undefined`.
 */
function kuboApiBase(uploadUrl: string): string | undefined {
  let url: URL
  try {
    url = new URL(uploadUrl)
  } catch {
    return undefined
  }

  const path = url.pathname.replace(/\/+$/, '')

  return /\/api\/v0\/add$/.test(path)
    ? `${url.origin}${path.replace(/\/add$/, '')}`
    : undefined
}

/**
 * Whether a failed unpin says the CID is not pinned (any more), in the answering service's
 * own format:
 *
 *   - Kubo: a JSON error, `{ "Message": "not pinned…", "Type": "error" }`;
 *   - Pinata: JSON with `error.reason` `CURRENT_USER_HAS_NOT_PINNED_CID`;
 *   - a configured `unpin`: a 404.
 *
 * Never for 401/403, which mean the key may not, and never for a body that merely mentions
 * it (a proxy's error page).
 */
function isNotPinned(
  response: { status: number; body: string },
  service: UnpinService
): boolean {
  const { status } = response

  if (service === 'custom') return status === 404
  if (status < 400 || status === 401 || status === 403) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(response.body)
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false

  const record = parsed as Record<string, unknown>

  if (service === 'kubo')
    return (
      record.Type === 'error' &&
      typeof record.Message === 'string' &&
      /^not pinned\b/i.test(record.Message)
    )

  const error = record.error as { reason?: unknown } | undefined
  return (
    !!error &&
    typeof error === 'object' &&
    error.reason === 'CURRENT_USER_HAS_NOT_PINNED_CID'
  )
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'invalid URL'
  }
}
