/**
 * Stores the encrypted DDO envelope in an S3 bucket (AWS S3, Exoscale SOS, MinIO, …).
 *
 * ocean-node 4.2 reads a `{ type: 's3', s3Access }` pointer with the AWS SDK
 * (`storage/S3Storage.ts`). There is no anonymous read: the pointer always carries a key
 * pair, all of `endpoint`, `bucket`, `objectKey`, `accessKeyId` and `secretAccessKey` must
 * be set, `region` defaults to `us-east-1` and `forcePathStyle` to `false`.
 *
 * So this store works with **two key pairs**:
 *
 *   - `writeCredentials` upload (and `remove()`). They never leave the publisher.
 *   - `readCredentials` go into the pointer, which is node-encrypted and written on chain.
 *     Whoever holds the node's key can read them, and they can never be taken back. Use a
 *     read-only key scoped to `prefix`. Rotating or deleting it breaks re-indexing of every
 *     asset that points at it. `PublishResponse.stored.pointer` carries the pointer with
 *     the secret replaced by `'<redacted>'`.
 *
 * Endpoints:
 *
 *   - Exoscale SOS: `https://sos-<zone>.exo.io`, `region: '<zone>'`. Both addressing styles
 *     work.
 *   - MinIO, or any endpoint given as an IP address or `localhost`: `forcePathStyle: true`.
 *     Virtual-host addressing (`bucket.host`) cannot work there, so the constructor refuses
 *     it.
 *   - `nodeEndpoint` / `nodeForcePathStyle` set what goes into the pointer, for when the node
 *     reaches the bucket differently than you do (`127.0.0.1:9000` here, `minio:9000` inside
 *     Docker). `nodeEndpoint` may be plain `http://`: nautilus never connects to it, only the
 *     node does, and it travels node-encrypted. `endpoint`, which nautilus uploads to, must
 *     be `https://` unless it is a loopback host or `allowInsecureTransport` is set.
 *
 * The bucket name must follow the S3 naming rules (3–63 lowercase letters, digits, dots and
 * hyphens), since it goes into the request URL. A dotted bucket over `https://` needs
 * `forcePathStyle`: `bucket.with.dots.host` does not match the endpoint's certificate.
 *
 * Object keys are `<prefix><DID hash>/<envelope sha256>.json`: deterministic, and an edit
 * creates a sibling instead of overwriting. The object an on-chain pointer refers to never
 * changes, so its hash keeps matching and a failed edit leaves the live version intact.
 * Remove old versions with `remove(pointer)`. Keys and the prefix are refused when they
 * contain `.`/`..` or empty segments, a leading `/` or a backslash: S3 does not normalise
 * them, but URL handling would, so the upload and the node's read would hit different keys.
 *
 * Signed requests never follow a redirect: S3 redirects when the region or endpoint does
 * not match the bucket, and the error says so.
 *
 * No AWS SDK: requests are signed with SigV4 over `fetch` and WebCrypto, so this runs in
 * Node ≥ 22 and in the browser.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import {
  errorMessage,
  type FetchedText,
  fetchText,
  MAX_TIMER_MS,
  RedirectError,
  RequestTimeoutError
} from '../utils/http.js'
import {
  assertSecureTransport,
  isIpAddress,
  isLoopbackHost
} from '../utils/transport.js'
import { warnOnce } from '../utils/warn.js'
import type { RemoteStore } from './RemoteStore.js'
import { encodeRfc3986, sha256Hex, signS3Request } from './sigv4.js'
import { assertStoredHash } from './verify.js'

export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
}

export interface S3RemoteStoreOptions {
  /**
   * Where this store uploads, e.g. `https://sos-de-fra-1.exo.io`. No scheme means
   * `https://`. Plain `http://` only for loopback hosts, or with `allowInsecureTransport`.
   * No user name or password in the URL (`user:pass@host`): requests are signed with the
   * key pairs, and the endpoint goes as is into the pointer and into error messages.
   */
  endpoint: string
  /**
   * The endpoint written into the pointer, for the node. Defaults to `endpoint`. May be
   * `http://` (e.g. `http://minio:9000` inside Docker): only the node connects to it. The
   * pointer gets it normalised like `endpoint`: no scheme means `https://`, and the scheme is
   * lowercased. No user name or password in the URL, as for `endpoint`.
   */
  nodeEndpoint?: string
  /** Default `us-east-1`, as on the node. */
  region?: string
  /** An S3 bucket name: 3–63 lowercase letters, digits, dots and hyphens. */
  bucket: string
  /**
   * Prepended to every object key as is, e.g. `'ddo/'`; without the trailing `/`, `'ddo'`
   * gives `ddo<DID hash>/…`. Scope the read key to it. No `.`/`..` or empty segments, no
   * leading `/`, no backslash.
   */
  prefix?: string
  /**
   * Path-style addressing (`endpoint/bucket/key`) for uploads. Default `false`. Required
   * (the constructor throws otherwise) when `endpoint` is an IP address or `localhost`, and
   * for a bucket name with dots over `https://`.
   */
  forcePathStyle?: boolean
  /** Addressing style written into the pointer. Defaults to `forcePathStyle`. */
  nodeForcePathStyle?: boolean
  /** Uploads and removes. Never written anywhere. */
  writeCredentials: S3Credentials
  /** Written, node-encrypted, into the on-chain pointer. Must be read-only. */
  readCredentials: S3Credentials
  /**
   * Allow one key pair for both. Then the write key sits in every pointer, forever, and a
   * warning says so. Compared by access key id.
   */
  allowSharedCredentials?: boolean
  /** Let `check()` pass (with a warning) although the read key can write or delete. */
  allowWritableReadKey?: boolean
  /** Allow a plain `http://` `endpoint` on a non-loopback host. Default `false`. */
  allowInsecureTransport?: boolean
  /**
   * Per-request timeout, body included. Default 30 s. A finite number of milliseconds, more
   * than 0 (the constructor throws otherwise); above 2^31 − 1 ms it is clamped to that.
   */
  requestTimeoutMs?: number
  fetchImpl?: typeof fetch
  /** The clock used for signing. Only for tests. */
  now?: () => Date
}

/** The pointer shape, identical to ocean.js / ocean-node `S3FileObject`. */
export interface S3Pointer {
  type: 's3'
  s3Access: {
    endpoint: string
    region: string
    bucket: string
    objectKey: string
    accessKeyId: string
    secretAccessKey: string
    forcePathStyle: boolean
  }
}

type Method = 'GET' | 'PUT' | 'DELETE'
type Role = 'read' | 'write'

const DEFAULT_REGION = 'us-east-1'
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const PROBE_BODY = '{"nautilus":"remote-store-check"}'
/** Where `check()` puts its probes, below `prefix`. */
const PROBE_DIRECTORY = 'nautilus-store-check'
/** One retry, for network errors and these answers. */
const MAX_ATTEMPTS = 2
const RETRIED_STATUSES = [500, 502, 503, 504]

export class S3RemoteStore implements RemoteStore {
  private readonly options: S3RemoteStoreOptions
  private readonly fetchImpl: typeof fetch
  private readonly region: string
  private readonly prefix: string
  private readonly sharedCredentials: boolean
  private readonly requestTimeoutMs: number
  /** `<prefix><DID hash>/<sha256>.json`: the keys `put()` (and `check()`) write. */
  private readonly objectKeyShape: RegExp

  constructor(options: S3RemoteStoreOptions) {
    const missing = (
      [
        ['endpoint', options.endpoint],
        ['bucket', options.bucket],
        ['writeCredentials.accessKeyId', options.writeCredentials?.accessKeyId],
        [
          'writeCredentials.secretAccessKey',
          options.writeCredentials?.secretAccessKey
        ],
        ['readCredentials.accessKeyId', options.readCredentials?.accessKeyId],
        [
          'readCredentials.secretAccessKey',
          options.readCredentials?.secretAccessKey
        ]
      ] as const
    )
      .filter(([, value]) => !value?.trim())
      .map(([name]) => name)

    if (missing.length)
      throw new Error(
        `S3RemoteStore needs ${missing.join(', ')}. ocean-node reads S3 only with a key pair; there is no anonymous read.`
      )

    this.sharedCredentials =
      options.readCredentials.accessKeyId ===
      options.writeCredentials.accessKeyId

    if (this.sharedCredentials && !options.allowSharedCredentials)
      throw new Error(
        'S3RemoteStore: readCredentials and writeCredentials are the same key. The read key is written, node-encrypted, into every on-chain pointer and can never be removed, so it must be a separate read-only key scoped to the prefix. Pass allowSharedCredentials: true to accept the risk.'
      )

    if (this.sharedCredentials)
      warnOnce(
        `s3-shared-credentials:${options.writeCredentials.accessKeyId}`,
        `S3RemoteStore: allowSharedCredentials is set, so the WRITE key ${options.writeCredentials.accessKeyId} is written, node-encrypted, into every on-chain pointer, permanently. Whoever holds the node's key can overwrite or delete every stored DDO with it. Use a separate read-only key scoped to the prefix.`
      )

    assertHttpEndpoint('endpoint', options.endpoint)
    if (options.nodeEndpoint)
      assertHttpEndpoint('nodeEndpoint', options.nodeEndpoint)

    // Before anything that echoes an endpoint in its message.
    assertEndpointWithoutCredentials('endpoint', options.endpoint)
    if (options.nodeEndpoint)
      assertEndpointWithoutCredentials('nodeEndpoint', options.nodeEndpoint)

    this.requestTimeoutMs = requestTimeout(options.requestTimeoutMs)

    assertSecureTransport(
      withScheme(options.endpoint),
      'S3RemoteStore endpoint',
      options.allowInsecureTransport
    )

    assertBucketName(options.bucket)

    const prefix = options.prefix ?? ''
    if (prefix) assertSafeKey(prefix, 'prefix', true)

    assertAddressable(
      'endpoint',
      options.endpoint,
      options.forcePathStyle ?? false,
      'forcePathStyle'
    )
    assertAddressable(
      'nodeEndpoint',
      options.nodeEndpoint || options.endpoint,
      options.nodeForcePathStyle ?? options.forcePathStyle ?? false,
      options.nodeForcePathStyle === undefined
        ? 'forcePathStyle'
        : 'nodeForcePathStyle'
    )

    if (
      options.bucket.includes('.') &&
      !options.forcePathStyle &&
      new URL(withScheme(options.endpoint)).protocol === 'https:'
    )
      throw new Error(
        `S3RemoteStore: the bucket name ${options.bucket} contains dots, so virtual-host addressing (${options.bucket}.${new URL(withScheme(options.endpoint)).host}) over https cannot work: the endpoint's wildcard certificate covers one label only. Set forcePathStyle: true.`
      )

    this.options = options
    this.prefix = prefix
    this.objectKeyShape = new RegExp(
      `^${escapeRegExp(prefix)}[A-Za-z0-9._-]+/[0-9a-f]{64}\\.json$`
    )
    this.fetchImpl = options.fetchImpl || fetch
    this.region = options.region || DEFAULT_REGION
  }

  async put(payload: string, hint: { did: string }): Promise<S3Pointer> {
    const objectKey = `${this.prefix}${didKey(hint.did)}/${await sha256Hex(payload)}.json`

    assertSafeKey(objectKey, 'object key')

    await this.request(
      'PUT',
      objectKey,
      this.options.writeCredentials,
      'write',
      {
        body: payload,
        contentType: 'application/json'
      }
    )

    return this.pointerFor(objectKey)
  }

  /**
   * Deletes the object behind a pointer this store returned, with the write key. Only keys
   * of the exact shape `put()` writes, `<prefix><DID hash>/<sha256>.json`, in this store's
   * bucket. The redacted pointer from `PublishResponse.stored` is enough: only `bucket` and
   * `objectKey` are used. An object that is already gone (`404 NoSuchKey`) counts as removed.
   */
  async remove(pointer: StorageObject): Promise<void> {
    const objectKey = this.ownObjectKey(pointer, 'remove')

    if (!this.objectKeyShape.test(objectKey))
      throw new Error(
        `S3RemoteStore.remove: ${objectKey} is not a key this store writes (${JSON.stringify(this.prefix)} + <DID hash>/<sha256>.json), so it is left alone.`
      )

    const response = await this.send(
      'DELETE',
      objectKey,
      this.options.writeCredentials,
      'write'
    )

    if (
      response.ok ||
      (response.status === 404 && s3ErrorCode(response.body) === 'NoSuchKey')
    )
      return

    throw new Error(this.describeError('DELETE', objectKey, 'write', response))
  }

  /**
   * Reads the stored envelope back with the **read** key and checks it hashes, the way the
   * node hashes it, to `expectedHash`. Called before the metadata transaction, so it also
   * proves the key in the pointer can read the object. Reads through `endpoint`, not
   * `nodeEndpoint`.
   */
  async verify(pointer: StorageObject, expectedHash: string): Promise<void> {
    const objectKey = this.ownObjectKey(pointer, 'verify')

    const body = await this.request(
      'GET',
      objectKey,
      this.options.readCredentials,
      'read'
    )

    await assertStoredHash(
      `s3://${this.options.bucket}/${objectKey} (read with the read key)`,
      body,
      expectedHash
    )
  }

  /**
   * Runs before the first transaction of a publish, completePublish or edit.
   *
   * Uploads a probe with the write key, reads it back with the read key (as the node will,
   * though through `endpoint` rather than `nodeEndpoint`), makes sure the read key can
   * neither PUT nor DELETE, and deletes the probes. The probes have the shape of real
   * objects, `<prefix>nautilus-store-check/<random sha256-like hex>.json`, so a policy that
   * grants the read key write access only to `<prefix>*` + `/` + `*` is caught too. Only an
   * explicit 403 `AccessDenied` counts as "the read key cannot"; any other answer fails the
   * check. A failing cleanup never hides the error that came first; a probe that is already
   * gone (404) counts as cleaned up.
   *
   * Version-level permissions are not tried: on a versioned bucket, a read key allowed
   * `s3:DeleteObjectVersion` (or to change version ACLs or retention) passes, so its policy
   * should grant `s3:GetObject` and nothing that writes.
   */
  async check(): Promise<void> {
    const { writeCredentials, readCredentials } = this.options
    const probeKey = this.probeKey()
    const written: string[] = []
    let failure: unknown

    try {
      await this.request('PUT', probeKey, writeCredentials, 'write', {
        body: PROBE_BODY,
        contentType: 'application/json'
      })
      written.push(probeKey)

      const body = await this.request('GET', probeKey, readCredentials, 'read')

      if (body !== PROBE_BODY)
        throw new Error(
          `S3 store check failed: reading s3://${this.options.bucket}/${probeKey} with the read key returned different content.`
        )

      if (!this.sharedCredentials) {
        const readProbe = this.probeKey()
        let canWrite: boolean
        try {
          canWrite = await this.readKeyCan('PUT', readProbe)
        } catch (error) {
          // No clear answer, so the PUT may have taken effect: clean it up too.
          written.push(readProbe)
          throw error
        }
        if (canWrite) written.push(readProbe)
        const canDelete = await this.readKeyCan('DELETE', probeKey)

        this.refuseWritableReadKey(canWrite, canDelete)
      }
    } catch (error) {
      failure = error
    }

    const cleanupErrors: unknown[] = []
    for (const key of written) {
      try {
        const response = await this.send(
          'DELETE',
          key,
          writeCredentials,
          'write'
        )
        // 404: already gone, e.g. deleted by a read key that may delete.
        if (!response.ok && response.status !== 404)
          throw new Error(this.describeError('DELETE', key, 'write', response))
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    if (failure !== undefined) {
      if (!cleanupErrors.length) throw failure

      throw new AggregateError(
        [failure, ...cleanupErrors],
        `${errorMessage(failure)} (removing the check's probe objects also failed: ${cleanupErrors.map(errorMessage).join('; ')})`
      )
    }

    if (cleanupErrors.length)
      throw new Error(
        `S3 store check: the write key could not delete its probe objects, so remove() will not work either: ${cleanupErrors.map(errorMessage).join('; ')}`,
        { cause: cleanupErrors[0] }
      )
  }

  /**
   * Tries `method` with the read key: `true` if it succeeded, `false` on an explicit 403
   * `AccessDenied`. Anything else throws, because it says nothing about the key.
   */
  private async readKeyCan(
    method: 'PUT' | 'DELETE',
    key: string
  ): Promise<boolean> {
    const response = await this.send(
      method,
      key,
      this.options.readCredentials,
      'read',
      method === 'PUT'
        ? { body: PROBE_BODY, contentType: 'application/json' }
        : undefined
    )

    if (response.ok) return true
    if (isAccessDenied(response)) return false

    throw new Error(
      `S3 store check: could not tell whether the read key can ${method === 'PUT' ? 'write' : 'delete'}; expected 403 AccessDenied. ${this.describeError(method, key, 'read', response)}`
    )
  }

  /** Throws (or, with `allowWritableReadKey`, warns) when the read key can write or delete. */
  private refuseWritableReadKey(canWrite: boolean, canDelete: boolean): void {
    if (!canWrite && !canDelete) return

    const can = [canWrite && 'write', canDelete && 'delete']
      .filter(Boolean)
      .join(' and ')
    const message = `S3 store check: the read credentials can ${can} in bucket ${this.options.bucket}; use a read-only key scoped to the prefix. They are written into every on-chain pointer, so whoever holds the node's key could overwrite or delete the stored DDOs.`

    if (!this.options.allowWritableReadKey) throw new Error(message)

    warnOnce(`s3-writable-read-key:${this.options.bucket}:${can}`, message)
  }

  /** A fresh probe key, shaped like the keys `put()` writes. */
  private probeKey(): string {
    const random = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    return `${this.prefix}${PROBE_DIRECTORY}/${random}.json`
  }

  /** The object key of a pointer into this store's bucket and prefix, or throws. */
  private ownObjectKey(pointer: StorageObject, operation: string): string {
    const access = (pointer as Partial<S3Pointer> | undefined)?.s3Access
    const type = (pointer as { type?: unknown } | undefined)?.type

    if (
      typeof type !== 'string' ||
      type.toLowerCase() !== 's3' ||
      typeof access?.objectKey !== 'string' ||
      !access.objectKey ||
      access.bucket !== this.options.bucket
    )
      throw new Error(
        `S3RemoteStore.${operation}: not a pointer into bucket ${this.options.bucket}.`
      )

    assertSafeKey(access.objectKey, 'object key')

    if (!access.objectKey.startsWith(this.prefix))
      throw new Error(
        `S3RemoteStore.${operation}: ${access.objectKey} is outside the prefix ${JSON.stringify(this.prefix)}.`
      )

    return access.objectKey
  }

  private pointerFor(objectKey: string): S3Pointer {
    const { options } = this

    return {
      type: 's3',
      s3Access: {
        // Normalised: the node only checks that the endpoint starts with "http".
        endpoint: withScheme(options.nodeEndpoint || options.endpoint),
        region: this.region,
        bucket: options.bucket,
        objectKey,
        accessKeyId: options.readCredentials.accessKeyId,
        secretAccessKey: options.readCredentials.secretAccessKey,
        forcePathStyle:
          options.nodeForcePathStyle ?? options.forcePathStyle ?? false
      }
    }
  }

  /** Sends a request and turns S3 errors into actionable ones. Returns the body. */
  private async request(
    method: Method,
    key: string,
    credentials: S3Credentials,
    role: Role,
    content?: { body: string; contentType: string }
  ): Promise<string> {
    const response = await this.send(method, key, credentials, role, content)

    if (response.ok) return response.body

    throw new Error(this.describeError(method, key, role, response))
  }

  /**
   * One signed request, with a timeout. Network errors are wrapped with context. A redirect
   * is not followed (fetchText's default): it would carry the signed request elsewhere, and
   * S3 redirects only when the region or endpoint does not match the bucket.
   *
   * Every request this store sends is idempotent (a PUT writes a content-addressed key with
   * the same body), so a network error or a 500/502/503/504 is retried once, freshly
   * signed. A timeout is not retried: it already took `requestTimeoutMs`.
   */
  private async send(
    method: Method,
    key: string,
    credentials: S3Credentials,
    role: Role,
    content?: { body: string; contentType: string }
  ): Promise<FetchedText> {
    const url = objectUrl(
      this.options.endpoint,
      this.options.bucket,
      key,
      this.options.forcePathStyle ?? false
    )

    const timeoutMs = this.requestTimeoutMs

    for (let attempt = 1; ; attempt++) {
      const headers = await signS3Request({
        method,
        url,
        headers: content ? { 'content-type': content.contentType } : {},
        body: content?.body ?? '',
        credentials,
        region: this.region,
        date: this.options.now?.() ?? new Date()
      })

      let response: FetchedText
      try {
        response = await fetchText(
          this.fetchImpl,
          url,
          { method, headers, body: content?.body },
          { timeoutMs }
        )
      } catch (error) {
        if (error instanceof RedirectError)
          throw new Error(
            this.describeRedirect(method, key, role, url, error),
            {
              cause: error
            }
          )

        const timedOut = error instanceof RequestTimeoutError
        if (!timedOut && attempt < MAX_ATTEMPTS) continue

        const reason = timedOut
          ? error.message
          : `network error: ${errorMessage(error)}`

        throw new Error(
          `S3 ${method} s3://${this.options.bucket}/${key} with the ${role} key via ${new URL(url).origin} failed (${reason}${attempt > 1 ? `, after ${attempt} attempts` : ''}). Check endpoint, forcePathStyle and that the host is reachable.`,
          { cause: error }
        )
      }

      if (RETRIED_STATUSES.includes(response.status) && attempt < MAX_ATTEMPTS)
        continue

      return response
    }
  }

  private describeError(
    method: string,
    key: string,
    role: Role,
    response: FetchedText
  ): string {
    const { status, body } = response
    const code = s3ErrorCode(body)
    const where = `${method} s3://${this.options.bucket}/${key} with the ${role} key`

    if (code === 'SignatureDoesNotMatch')
      return `S3 ${where}: signature mismatch. Check the secret key, and that region (${this.region}) and forcePathStyle match the endpoint.`
    if (code === 'InvalidAccessKeyId')
      return `S3 ${where}: the access key id is unknown at ${this.options.endpoint}.`
    const region = /<Region>([^<]+)<\/Region>/.exec(body)?.[1]
    if (region && region !== this.region)
      return `S3 ${where}: the bucket is in region ${region}, not ${this.region} (${code || status}). Set region: '${region}', and the endpoint of that region.`
    if (code === 'NoSuchKey') return `S3 ${where}: no such object (NoSuchKey).`
    if (
      code === 'NoSuchBucket' ||
      (status === 404 && method !== 'GET' && !code)
    )
      return `S3 ${where}: bucket ${this.options.bucket} does not exist at ${this.options.endpoint} (or forcePathStyle is wrong for it).`
    if (status === 403)
      return `S3 ${where}: access denied (${code || 403}). The ${role} key needs ${role === 'read' ? 's3:GetObject' : 's3:PutObject and s3:DeleteObject'} on ${this.prefix || 'the bucket'}.`
    if (status === 404) return `S3 ${where}: no such object (${code || 404}).`

    return `S3 ${where} failed: ${status} ${code || ''} ${body.slice(0, 200)}`.trim()
  }

  /** A redirect that was not followed, with what usually causes it. */
  private describeRedirect(
    method: string,
    key: string,
    role: Role,
    url: string,
    error: RedirectError
  ): string {
    const target = error.locationOrigin
    const region = target
      ? /^https?:\/\/(?:[^/]*\.)?s3[.-]([a-z0-9-]+)\.amazonaws\.com(?::\d+)?$/i.exec(
          target
        )?.[1]
      : undefined

    return `S3 ${method} s3://${this.options.bucket}/${key} with the ${role} key via ${new URL(url).origin} was answered with a redirect (${error.status || 'opaque'})${target ? ` to ${target}` : ''}, which nautilus does not follow with a signed request. S3 redirects when the bucket is not in the region signed for (${this.region}) or the endpoint is not the bucket's: set region${region && region !== this.region ? ` (the redirect points to ${region})` : ''} and endpoint to the bucket's region, e.g. https://s3.<region>.amazonaws.com on AWS, and check forcePathStyle.`
  }
}

function s3ErrorCode(body: string): string | undefined {
  return /<Code>([^<]+)<\/Code>/.exec(body)?.[1]
}

/**
 * Only an explicit 403 `AccessDenied` means "this key may not". A bare 403 may come from a
 * proxy or firewall in front of the bucket, and says nothing about the key.
 */
function isAccessDenied(response: FetchedText): boolean {
  return (
    response.status === 403 && s3ErrorCode(response.body) === 'AccessDenied'
  )
}

/** The endpoint with an explicit, lowercase scheme: none means `https://`. */
function withScheme(endpoint: string): string {
  const trimmed = endpoint.trim()

  return /^https?:\/\//i.test(trimmed)
    ? trimmed.replace(/^https?:/i, (scheme) => scheme.toLowerCase())
    : `https://${trimmed}`
}

/** Throws for an endpoint with a scheme other than `http://` or `https://`. */
function assertHttpEndpoint(name: string, endpoint: string): void {
  const trimmed = endpoint.trim()

  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) &&
    !/^https?:\/\//i.test(trimmed)
  )
    throw new Error(
      `S3RemoteStore: ${name} must be an http:// or https:// URL, or a host without a scheme (meaning https://).`
    )
}

/**
 * Throws for an endpoint with a user name or password (`https://user:pass@host`). Requests
 * are signed and sent to the host alone, so they are never used, and the endpoint is copied
 * as is into the pointer (`PublishResponse.stored.pointer` included) and into error
 * messages. The message does not echo the endpoint.
 */
function assertEndpointWithoutCredentials(
  name: string,
  endpoint: string
): void {
  let parsed: URL
  try {
    parsed = new URL(withScheme(endpoint))
  } catch {
    throw new Error(`S3RemoteStore: ${name} is not a valid URL.`)
  }

  if (parsed.username || parsed.password)
    throw new Error(
      `S3RemoteStore: ${name} carries credentials in the URL (user:password@host). S3 requests are signed with the key pairs, so remove them from the URL.`
    )
}

/**
 * `requestTimeoutMs`, or the default: a positive, finite number of milliseconds, clamped to
 * the longest delay `setTimeout` takes. Anything else throws here rather than fail every
 * request as if the host were unreachable.
 */
function requestTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_REQUEST_TIMEOUT_MS

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new Error(
      `S3RemoteStore: requestTimeoutMs must be a finite number of milliseconds, more than 0; got ${String(value)}.`
    )

  return Math.min(value, MAX_TIMER_MS)
}

/**
 * Throws for a bucket name outside the S3 naming rules: 3–63 characters of lowercase
 * letters, digits, dots and hyphens, starting and ending with a letter or digit, no two
 * adjacent dots, not an IP address. It goes into the request URL, so anything else could
 * change the host or the path.
 */
function assertBucketName(bucket: string): void {
  const problem = !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    ? 'must be 3 to 63 lowercase letters, digits, dots and hyphens, starting and ending with a letter or digit'
    : bucket.includes('..')
      ? 'must not contain two adjacent dots'
      : /^\d{1,3}(\.\d{1,3}){3}$/.test(bucket)
        ? 'must not be an IP address'
        : undefined

  if (problem)
    throw new Error(
      `S3RemoteStore: the bucket ${JSON.stringify(bucket)} is not a valid S3 bucket name: it ${problem}.`
    )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Throws when virtual-host addressing is asked for on a host that cannot have a bucket
 * subdomain: an IP address or `localhost`.
 */
function assertAddressable(
  name: string,
  endpoint: string,
  pathStyle: boolean,
  option: string
): void {
  let hostname: string
  try {
    hostname = new URL(withScheme(endpoint)).hostname
  } catch {
    throw new Error(`S3RemoteStore: ${name} is not a valid URL: ${endpoint}`)
  }

  if (pathStyle || !(isIpAddress(hostname) || isLoopbackHost(hostname))) return

  throw new Error(
    `S3RemoteStore: ${name} ${endpoint} is an IP address or localhost, so virtual-host addressing (bucket.${hostname}) cannot work. Set ${option}: true.`
  )
}

/**
 * Throws for an S3 key (or prefix) that URL handling would rewrite: `.`/`..` or empty
 * segments, a leading `/`, a backslash. A prefix may end in `/`.
 */
function assertSafeKey(key: string, what: string, isPrefix = false): void {
  const problem = key.includes('\\')
    ? 'contains a backslash'
    : key.startsWith('/')
      ? 'starts with /'
      : (isPrefix && key.endsWith('/') ? key.slice(0, -1) : key)
            .split('/')
            .some(
              (segment) => segment === '' || segment === '.' || segment === '..'
            )
        ? 'has an empty, "." or ".." segment'
        : undefined

  if (problem)
    throw new Error(
      `S3RemoteStore: the ${what} ${JSON.stringify(key)} ${problem}. S3 keys are not normalised, so the upload and the node's read would reach different objects.`
    )
}

/** The hash part of a DID, or a filesystem-safe form of the whole id. */
function didKey(did: string): string {
  const hash = did.split(':').pop() ?? ''

  return /^[0-9a-f]{64}$/i.test(hash)
    ? hash.toLowerCase()
    : did.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** The object URL in the addressing style the node's AWS SDK uses. */
function objectUrl(
  endpoint: string,
  bucket: string,
  key: string,
  forcePathStyle: boolean
): string {
  const base = new URL(withScheme(endpoint))
  const path = key.split('/').map(encodeRfc3986).join('/')
  const basePath = base.pathname.replace(/\/+$/, '')

  if (forcePathStyle)
    return `${base.protocol}//${base.host}${basePath}/${encodeRfc3986(bucket)}/${path}`

  return `${base.protocol}//${bucket}.${base.host}${basePath}/${path}`
}
