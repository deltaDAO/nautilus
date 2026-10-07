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
 * `remove(pointer)` unpins a CID. For Pinata (`…/pinning/pinFileToIPFS`) and Kubo
 * (`…/api/v0/add`) the unpin endpoint is derived from `uploadUrl`; for anything else pass
 * `unpin: { url }`. Unpinning releases this service's copy: IPFS has no delete, so nodes or
 * gateways that fetched the CID may keep serving it until they garbage-collect it. The
 * envelope is ciphertext either way.
 *
 * `uploadUrl`, `gatewayUrl`, `probe.url` and `unpin.url` must be `https://`, except on
 * loopback hosts or with `allowInsecureTransport`. Upstream error bodies are cut to 300 characters and scrubbed of
 * the configured header values and anything that looks like a token before they reach an
 * error message.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import { errorMessage, fetchText } from '../utils/http.js'
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
   * the node does, and checks the hash. Without it `verify()` checks nothing.
   */
  gatewayUrl?: string
  /**
   * How `remove()` unpins a CID. By default it is derived from `uploadUrl`:
   *
   *   - Pinata, `…/pinning/pinFileToIPFS`: `DELETE <origin>/pinning/unpin/<cid>`;
   *   - Kubo, `…/api/v0/add`: `POST <same base>/api/v0/pin/rm?arg=<cid>`.
   *
   * For another service pass `{ url, method?, headers? }`, with `{cid}` in `url` where the
   * CID goes (`method` defaults to `DELETE`). Like a probe, it is sent `headers` when given,
   * and otherwise the upload `headers` only if `url` has the same origin as `uploadUrl`.
   * `false` turns `remove()` off. A CID the service reports as not pinned counts as removed.
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

    assertSecureTransport(
      options.uploadUrl,
      'IpfsRemoteStore uploadUrl',
      options.allowInsecureTransport
    )
    if (options.gatewayUrl)
      assertSecureTransport(
        options.gatewayUrl,
        'IpfsRemoteStore gatewayUrl',
        options.allowInsecureTransport
      )
    if (options.probe && options.probe !== 'upload')
      assertSecureTransport(
        options.probe.url,
        'IpfsRemoteStore probe.url',
        options.allowInsecureTransport
      )
    if (options.unpin) {
      if (!options.unpin.url?.includes('{cid}'))
        throw new Error(
          'IpfsRemoteStore unpin.url needs a {cid} placeholder, e.g. https://pin.example.org/pins/{cid}.'
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

  /** Runs the configured `probe`, if any. Throws if the store would refuse an upload. */
  async check(): Promise<void> {
    const { probe } = this.options

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
        `IPFS upload returned ${JSON.stringify(hash.slice(0, 100))}, which is not a CIDv0 (Qm…) or CIDv1 (b…/k…). The node would resolve it as a gateway path.`
      )

    return { type: 'ipfs', hash } as StorageObject
  }

  /**
   * With `gatewayUrl`, reads `<gatewayUrl>/ipfs/<cid>` and checks it hashes, as the node
   * hashes it, to `expectedHash`. Without it, checks nothing.
   */
  async verify(pointer: StorageObject, expectedHash: string): Promise<void> {
    const { gatewayUrl } = this.options
    if (!gatewayUrl) return

    const hash = (pointer as { hash?: unknown }).hash

    if (typeof hash !== 'string' || !isCid(hash))
      throw new Error(
        'IpfsRemoteStore.verify: not an IPFS pointer with a valid CID.'
      )

    const url = `${gatewayUrl.replace(/\/+$/, '')}/ipfs/${hash}`
    const response = await this.send('IPFS verify', url, { method: 'GET' })

    if (!response.ok)
      throw new Error(
        `IPFS verify: the gateway answered ${response.status} ${response.statusText} for ${hash}; the node may not be able to fetch it either. ${this.scrub(response.body)}`.trim()
      )

    await assertStoredHash(
      `${hash} via ${gatewayUrl}`,
      response.body,
      expectedHash
    )
  }

  /**
   * Unpins the CID behind `pointer` (see `unpin`). Idempotent: a CID the service reports as
   * not pinned counts as removed. It unpins whatever valid CID it is given from this
   * account, so only pass pointers this store returned, such as `PublishResponse.stored.pointer`
   * of a superseded version or a revoked asset. Never called by nautilus on an indexed
   * asset; `publish()`, `completePublish()` and `edit()` call it only for an envelope whose
   * metadata transaction was never sent.
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

    if (response.ok || isNotPinned(response)) return

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
        secrets: unpin.headers
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

  private async send(
    what: string,
    url: string,
    init: RequestInit,
    secrets: (Record<string, string> | undefined)[] = [this.options.headers]
  ) {
    try {
      return await fetchText(this.fetchImpl, url, init, {
        timeoutMs: this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
      })
    } catch (error) {
      throw new Error(
        `${what} failed: ${this.scrub(errorMessage(error), secrets)} (${originOf(url)})`,
        { cause: error }
      )
    }
  }

  /** An upstream body, cut short and without anything that could be a credential. */
  private scrub(
    text: string,
    secrets: (Record<string, string> | undefined)[] = []
  ): string {
    return scrubSecrets(text, [this.options.headers, ...secrets])
  }
}

/** Cuts `text` to `MAX_BODY_IN_ERROR` characters after removing secrets and token-likes. */
function scrubSecrets(
  text: string,
  headerSets: (Record<string, string> | undefined)[] = []
): string {
  let scrubbed = text

  for (const headers of headerSets)
    for (const value of Object.values(headers ?? {})) {
      const secret = value.replace(/^(Bearer|Basic|Token)\s+/i, '').trim()
      if (secret.length >= 4)
        scrubbed = scrubbed.split(secret).join('<redacted>')
    }

  scrubbed = scrubbed
    .replace(/\b(Bearer|Basic|Token)\s+[^\s"',;]+/gi, '$1 <redacted>')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '<redacted>')
    .replace(
      /((?:api[_-]?key|api[_-]?secret|secret|token|password|authorization|jwt)["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
      '$1<redacted>'
    )

  return scrubbed.length > MAX_BODY_IN_ERROR
    ? `${scrubbed.slice(0, MAX_BODY_IN_ERROR)}…`
    : scrubbed
}

/**
 * The unpin call matching a known upload endpoint, on the same origin (so it gets the upload
 * headers), or `undefined`.
 */
function deriveUnpin(
  uploadUrl: string,
  cid: string
): { url: string; method: string } | undefined {
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
      method: 'DELETE'
    }

  if (/\/api\/v0\/add$/.test(path))
    return {
      url: `${url.origin}${path.replace(/\/add$/, '')}/pin/rm?arg=${arg}`,
      method: 'POST'
    }

  return undefined
}

/**
 * Whether a failed unpin says the CID is not pinned (any more): Kubo's `not pinned` message,
 * Pinata's `CURRENT_USER_HAS_NOT_PINNED_CID`. Never for 401/403, which mean the key may not.
 */
function isNotPinned(response: { status: number; body: string }): boolean {
  if (response.status === 401 || response.status === 403) return false

  return /not pinned|CURRENT_USER_HAS_NOT_PINNED_CID/i.test(response.body)
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
