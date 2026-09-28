/**
 * Stores the signed DDO on IPFS.
 *
 * Deliberately unopinionated about *which* IPFS service: it POSTs the payload to an upload
 * endpoint you supply and reads the CID out of the response. That covers a Kubo node
 * (`/api/v0/add`), a pinning service, or an in-house uploader, without nautilus taking a
 * dependency on any IPFS client.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import type { RemoteStore } from './RemoteStore.js'

export interface IpfsRemoteStoreOptions {
  /** Upload endpoint, e.g. `http://127.0.0.1:5001/api/v0/add`. */
  uploadUrl: string
  /** Extra headers, e.g. a pinning-service API key. */
  headers?: Record<string, string>
  /**
   * Pulls the CID out of the upload response. Defaults to the common
   * `Hash` / `cid` / `IpfsHash` keys used by Kubo, web3.storage and Pinata.
   */
  extractCid?: (response: unknown) => string | undefined
  fetchImpl?: typeof fetch
}

const DEFAULT_CID_KEYS = ['Hash', 'cid', 'Cid', 'IpfsHash', 'hash'] as const

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
    this.options = options
    this.fetchImpl = options.fetchImpl || fetch
  }

  async put(payload: string, hint: { did: string }): Promise<StorageObject> {
    const form = new FormData()
    form.append(
      'file',
      new Blob([payload], { type: 'application/json' }),
      `${hint.did}.json`
    )

    const response = await this.fetchImpl(this.options.uploadUrl, {
      method: 'POST',
      headers: this.options.headers,
      body: form
    })

    const text = await response.text()

    if (!response.ok)
      throw new Error(
        `IPFS upload failed: ${response.status} ${response.statusText} ${text}`.trim()
      )

    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // A bare CID as plain text is a valid response.
    }

    const extract = this.options.extractCid || defaultExtractCid
    const hash = extract(parsed)

    if (!hash)
      throw new Error(
        `IPFS upload returned no CID. Response was: ${text.slice(0, 200)}`
      )

    return { type: 'ipfs', hash } as StorageObject
  }
}
