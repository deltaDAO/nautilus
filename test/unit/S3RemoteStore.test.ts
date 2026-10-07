/**
 * `S3RemoteStore`: SigV4 against AWS's published examples, the pointer the node reads, and
 * the pre-mint `check()` against an in-memory bucket that enforces its keys.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as packageExports from '../../src/index.js'
import { prepareMetadata } from '../../src/publish/index.js'
import {
  S3RemoteStore,
  type S3RemoteStoreOptions
} from '../../src/remote/S3RemoteStore.js'
import { signS3Request } from '../../src/remote/sigv4.js'
import { resetWarnings } from '../../src/utils/warn.js'
import { ASSET_DID } from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'
import { createNodeMock } from '../mocks/node.js'

const AWS_EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
}

describe('signS3Request', () => {
  it('is not part of the package API', () => {
    expect(packageExports).not.to.have.property('signS3Request')
    expect(packageExports).not.to.have.property('writeMetadata')
    expect(packageExports).not.to.have.property('prepareMetadataForWrite')
  })

  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
  const date = new Date('2013-05-24T00:00:00Z')

  it('matches the AWS "GET Object" example', async () => {
    const headers = await signS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { Range: 'bytes=0-9' },
      body: '',
      credentials: AWS_EXAMPLE,
      region: 'us-east-1',
      date
    })

    expect(headers.authorization).to.equal(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
  })

  it('matches the AWS "PUT Object" example', async () => {
    const headers = await signS3Request({
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test%24file.text',
      headers: {
        Date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY'
      },
      body: 'Welcome to Amazon S3.',
      credentials: AWS_EXAMPLE,
      region: 'us-east-1',
      date
    })

    expect(headers['x-amz-content-sha256']).to.equal(
      '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072'
    )
    expect(headers.authorization).to.match(
      /SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/
    )
  })
})

const WRITE = { accessKeyId: 'WRITEKEY', secretAccessKey: 'write-secret' }
const READ = { accessKeyId: 'READKEY', secretAccessKey: 'read-secret' }

/**
 * An in-memory bucket. It checks who signed each request (by access key id) and what
 * that key may do, and answers with S3's XML errors.
 */
function fakeBucket(
  options: {
    readKeyCanWrite?: boolean
    readKeyCanDelete?: boolean
    writeKeyCannotDelete?: boolean
    bucket?: string
    errorCode?: string
    /** Answers every read-key PUT/DELETE with this instead of AccessDenied. */
    readKeyWriteAnswer?: { status: number; code: string }
    /** Answers GETs with this status and code. */
    getAnswer?: { status: number; code: string }
    /** Rewrites what a GET returns. */
    tamper?: (body: string) => string
    /** Rejects every request like an unreachable host. */
    networkError?: boolean
  } = {}
) {
  const objects = new Map<string, string>()
  const requests: {
    method: string
    url: string
    key: string
    body?: string
    headers: Record<string, string>
  }[] = []

  const error = (status: number, code: string) =>
    new Response(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`, {
      status
    })

  const fetchImpl = (async (input: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const keyId = /Credential=([^/]+)\//.exec(headers.authorization)?.[1]
    const method = init.method as string
    const url = new URL(input)
    const body = init.body as string | undefined
    requests.push({ method, url: input, key: keyId as string, body, headers })

    if (options.networkError) throw new TypeError('fetch failed')
    if (options.errorCode === 'SignatureDoesNotMatch')
      return error(403, 'SignatureDoesNotMatch')
    if (!url.pathname.startsWith(`/${options.bucket ?? 'ddos'}/`))
      return error(404, 'NoSuchBucket')

    const path = url.pathname
    const canWrite =
      keyId === WRITE.accessKeyId ||
      (keyId === READ.accessKeyId && options.readKeyCanWrite)

    if (method === 'GET') {
      if (options.getAnswer)
        return error(options.getAnswer.status, options.getAnswer.code)
      if (keyId !== READ.accessKeyId && keyId !== WRITE.accessKeyId)
        return error(403, 'AccessDenied')
      const stored = objects.get(path)
      return stored === undefined
        ? error(404, 'NoSuchKey')
        : new Response(options.tamper ? options.tamper(stored) : stored, {
            status: 200
          })
    }

    if (keyId === READ.accessKeyId && options.readKeyWriteAnswer)
      return error(
        options.readKeyWriteAnswer.status,
        options.readKeyWriteAnswer.code
      )

    const canDelete =
      (keyId === WRITE.accessKeyId && !options.writeKeyCannotDelete) ||
      (keyId === READ.accessKeyId && options.readKeyCanDelete)

    if (method === 'DELETE' ? !canDelete : !canWrite)
      return error(403, 'AccessDenied')

    if (method === 'PUT') objects.set(path, body ?? '')
    if (method === 'DELETE') objects.delete(path)

    return method === 'DELETE'
      ? new Response(null, { status: 204 })
      : new Response('', { status: 200 })
  }) as unknown as typeof fetch

  return { fetchImpl, objects, requests }
}

function store(
  bucket: ReturnType<typeof fakeBucket>,
  overrides: Partial<S3RemoteStoreOptions> = {}
) {
  return new S3RemoteStore({
    endpoint: 'http://127.0.0.1:9000',
    nodeEndpoint: 'http://minio:9000',
    bucket: 'ddos',
    prefix: 'ddo/',
    forcePathStyle: true,
    writeCredentials: WRITE,
    readCredentials: READ,
    fetchImpl: bucket.fetchImpl,
    ...overrides
  })
}

const DID_HASH = ASSET_DID.split(':').pop()

describe('S3RemoteStore', () => {
  it('uploads the envelope byte for byte and returns the S3FileObject the node reads', async () => {
    const bucket = fakeBucket()
    const envelope = '{"encryptedData":"0x0102"}'

    const pointer = await store(bucket).put(envelope, { did: ASSET_DID })

    const objectKey = pointer.s3Access.objectKey
    expect(objectKey).to.match(
      new RegExp(`^ddo/${DID_HASH}/[0-9a-f]{64}\\.json$`)
    )
    expect(bucket.objects.get(`/ddos/${objectKey}`)).to.equal(envelope)
    expect(bucket.requests[0].headers['content-type']).to.equal(
      'application/json'
    )
    expect(bucket.requests[0].key).to.equal('WRITEKEY')

    expect(pointer).to.deep.equal({
      type: 's3',
      s3Access: {
        endpoint: 'http://minio:9000',
        region: 'us-east-1',
        bucket: 'ddos',
        objectKey,
        accessKeyId: 'READKEY',
        secretAccessKey: 'read-secret',
        forcePathStyle: true
      }
    })
    expect(JSON.stringify(pointer)).not.to.contain('write-secret')
  })

  it('puts an edit next to the previous version instead of over it', async () => {
    const bucket = fakeBucket()
    const s3 = store(bucket)

    const first = await s3.put('{"encryptedData":"0x01"}', { did: ASSET_DID })
    const second = await s3.put('{"encryptedData":"0x02"}', { did: ASSET_DID })

    expect(first.s3Access.objectKey).not.to.equal(second.s3Access.objectKey)
    expect(bucket.objects.size).to.equal(2)
  })

  it('uses virtual-host addressing unless forcePathStyle', async () => {
    const bucket = fakeBucket()

    await store(bucket, {
      endpoint: 'sos-de-fra-1.exo.io',
      region: 'de-fra-1',
      forcePathStyle: false
    })
      .put('{}', { did: ASSET_DID })
      .catch(() => undefined)

    expect(bucket.requests[0].url).to.match(
      new RegExp(`^https://ddos\\.sos-de-fra-1\\.exo\\.io/ddo/${DID_HASH}/`)
    )
    expect(bucket.requests[0].headers.authorization).to.contain(
      '/de-fra-1/s3/aws4_request'
    )
  })

  it('passes nautilus pointer validation', async () => {
    const node = createNodeMock()

    const prepared = await prepareMetadata({
      node: node.client,
      ddo: {},
      signer: {
        getIssuer: async () => 'x',
        // A JWS whose payload is the (empty) DDO it was given.
        sign: async () => ({ jwt: 'a.e30.c', issuer: 'x' })
      },
      remoteStore: store(fakeBucket()),
      did: ASSET_DID
    })

    expect(prepared.stored.pointer.type).to.equal('s3')
  })

  it('removes with the write key', async () => {
    const bucket = fakeBucket()
    const s3 = store(bucket)
    const pointer = await s3.put('{}', { did: ASSET_DID })

    await s3.remove(pointer)

    expect(bucket.objects.size).to.equal(0)
    expect(bucket.requests.at(-1)).to.deep.include({
      method: 'DELETE',
      key: 'WRITEKEY'
    })
  })

  describe('configuration', () => {
    it('needs every field the node needs', () => {
      expect(
        () =>
          new S3RemoteStore({
            endpoint: '',
            bucket: 'ddos',
            writeCredentials: WRITE,
            readCredentials: { accessKeyId: 'R', secretAccessKey: '' }
          })
      ).to.throw(/needs endpoint, readCredentials.secretAccessKey/)
    })

    it('refuses one key for read and write unless allowed, and warns once when allowed', () => {
      resetWarnings()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const bucket = fakeBucket()

      expect(() => store(bucket, { readCredentials: WRITE })).to.throw(
        /same key.*allowSharedCredentials/
      )
      expect(warn).not.toHaveBeenCalled()

      store(bucket, { readCredentials: WRITE, allowSharedCredentials: true })
      store(bucket, { readCredentials: WRITE, allowSharedCredentials: true })

      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).to.match(
        /allowSharedCredentials is set, so the WRITE key WRITEKEY is written, node-encrypted, into every on-chain pointer, permanently/
      )
      expect(String(warn.mock.calls[0][0])).not.to.contain('write-secret')
      warn.mockRestore()
    })

    it('requires https for the upload endpoint, except on loopback hosts', () => {
      const bucket = fakeBucket()

      expect(() =>
        store(bucket, {
          endpoint: 'http://s3.example.org',
          forcePathStyle: false
        })
      ).to.throw(
        /S3RemoteStore endpoint uses plain http:\/\/.*allowInsecureTransport/
      )
      expect(() =>
        store(bucket, {
          endpoint: 'http://s3.example.org',
          allowInsecureTransport: true
        })
      ).not.to.throw()

      for (const endpoint of [
        'http://127.0.0.1:9000',
        'http://localhost:9000',
        'http://[::1]:9000',
        'http://minio.localhost:9000',
        'https://s3.example.org',
        's3.example.org'
      ])
        expect(() => store(bucket, { endpoint }), endpoint).not.to.throw()
    })

    it('allows a plain-http nodeEndpoint: only the node connects to it', () => {
      expect(() =>
        store(fakeBucket(), { nodeEndpoint: 'http://minio:9000' })
      ).not.to.throw()
    })

    it('refuses virtual-host addressing on an IP or localhost endpoint', () => {
      const bucket = fakeBucket()

      expect(() =>
        store(bucket, {
          endpoint: 'http://127.0.0.1:9000',
          forcePathStyle: false
        })
      ).to.throw(
        /endpoint http:\/\/127.0.0.1:9000 is an IP address or localhost, so virtual-host addressing .* Set forcePathStyle: true/
      )
      expect(() =>
        store(bucket, {
          endpoint: 'https://s3.example.org',
          nodeEndpoint: 'http://10.0.0.5:9000',
          forcePathStyle: false
        })
      ).to.throw(
        /nodeEndpoint http:\/\/10.0.0.5:9000 .* Set forcePathStyle: true/
      )
      expect(() =>
        store(bucket, {
          nodeEndpoint: 'http://localhost:9000',
          nodeForcePathStyle: false
        })
      ).to.throw(/nodeEndpoint .* Set nodeForcePathStyle: true/)
    })
  })

  describe('check', () => {
    const probeKeys = (bucket: ReturnType<typeof fakeBucket>) =>
      bucket.requests.map((request) => new URL(request.url).pathname)

    it('writes, reads back with the read key, tries to write and delete with it, and cleans up', async () => {
      const bucket = fakeBucket()

      await store(bucket).check()

      expect(bucket.objects.size).to.equal(0)
      expect(
        bucket.requests.map((request) => `${request.method} ${request.key}`)
      ).to.deep.equal([
        'PUT WRITEKEY',
        'GET READKEY',
        'PUT READKEY',
        'DELETE READKEY',
        'DELETE WRITEKEY'
      ])

      const [probe, , readProbe, readDelete, cleanup] = probeKeys(bucket)
      expect(probe).to.match(
        /^\/ddos\/ddo\/nautilus-store-check-[0-9a-f-]{36}\.json$/
      )
      expect(readProbe).not.to.equal(probe)
      expect(readDelete).to.equal(probe)
      expect(cleanup).to.equal(probe)
    })

    it('uses a fresh probe key every time, so concurrent checks do not collide', async () => {
      const bucket = fakeBucket()
      const s3 = store(bucket)

      await Promise.all([s3.check(), s3.check()])

      const puts = bucket.requests
        .filter(
          (request) => request.method === 'PUT' && request.key === 'WRITEKEY'
        )
        .map((request) => request.url)
      expect(new Set(puts).size).to.equal(2)
      expect(bucket.objects.size).to.equal(0)
    })

    it('refuses a read key that can write, and removes what it wrote', async () => {
      const bucket = fakeBucket({ readKeyCanWrite: true })

      await expectThrowsAsync(
        () => store(bucket).check(),
        /read credentials can write in bucket ddos; use a read-only key scoped to the prefix/
      )
      expect(bucket.objects.size).to.equal(0)
    })

    it('refuses a read key that can delete', async () => {
      const bucket = fakeBucket({ readKeyCanDelete: true })

      await expectThrowsAsync(
        () => store(bucket).check(),
        /read credentials can delete in bucket ddos/
      )
      expect(bucket.objects.size).to.equal(0)
    })

    it('reports a writable read key even when the write key cannot delete', async () => {
      // The security-relevant message must not hide behind the cleanup failure.
      const bucket = fakeBucket({
        readKeyCanWrite: true,
        writeKeyCannotDelete: true
      })

      const thrown = await store(bucket)
        .check()
        .catch((error) => error)

      expect(thrown).to.be.instanceOf(AggregateError)
      expect(thrown.message).to.match(
        /^S3 store check: the read credentials can write .*removing the check's probe objects also failed: .*DELETE .*access denied/
      )
      expect(thrown.errors[0].message).to.match(/read credentials can write/)
    })

    it('keeps the GET failure when the cleanup fails too', async () => {
      const bucket = fakeBucket({
        getAnswer: { status: 403, code: 'AccessDenied' },
        writeKeyCannotDelete: true
      })

      await expectThrowsAsync(
        () => store(bucket).check(),
        /^S3 GET s3:\/\/ddos\/ddo\/nautilus-store-check-.* with the read key: access denied.*s3:GetObject.*removing the check's probe objects also failed/
      )
    })

    it('fails when the write key cannot remove its probe', async () => {
      await expectThrowsAsync(
        () => store(fakeBucket({ writeKeyCannotDelete: true })).check(),
        /write key could not delete its probe objects, so remove\(\) will not work either/
      )
    })

    it('counts only an explicit 403 AccessDenied as "the read key cannot write"', async () => {
      for (const answer of [
        { status: 403, code: 'SignatureDoesNotMatch' },
        { status: 400, code: 'AuthorizationHeaderMalformed' },
        { status: 500, code: 'InternalError' }
      ]) {
        const bucket = fakeBucket({ readKeyWriteAnswer: answer })

        await expectThrowsAsync(
          () => store(bucket).check(),
          /could not tell whether the read key can write; expected 403 AccessDenied/
        )
        expect(bucket.objects.size).to.equal(0)
      }
    })

    it('accepts a writable read key when told to, with a warning', async () => {
      resetWarnings()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const bucket = fakeBucket({ readKeyCanWrite: true })

      await store(bucket, { allowWritableReadKey: true }).check()

      expect(bucket.objects.size).to.equal(0)
      expect(String(warn.mock.calls[0][0])).to.match(
        /read credentials can write/
      )
      warn.mockRestore()
    })

    it('names the missing bucket', async () => {
      await expectThrowsAsync(
        () => store(fakeBucket({ bucket: 'other' })).check(),
        /bucket ddos does not exist at http:\/\/127.0.0.1:9000/
      )
    })

    it('explains a signature mismatch', async () => {
      await expectThrowsAsync(
        () => store(fakeBucket({ errorCode: 'SignatureDoesNotMatch' })).check(),
        /signature mismatch.*region \(us-east-1\) and forcePathStyle/
      )
    })

    it('explains access denied for the write key', async () => {
      await expectThrowsAsync(
        () =>
          store(fakeBucket(), {
            writeCredentials: { accessKeyId: 'NOPE', secretAccessKey: 'x' }
          }).check(),
        /PUT s3:\/\/ddos\/ddo\/nautilus-store-check-[0-9a-f-]+\.json with the write key: access denied/
      )
    })
  })

  describe('network', () => {
    it('wraps network errors with method, bucket, key and role, and no secret', async () => {
      const bucket = fakeBucket({ networkError: true })
      const thrown = await store(bucket)
        .put('{}', { did: ASSET_DID })
        .catch((error) => error)

      expect(thrown.message).to.match(
        /^S3 PUT s3:\/\/ddos\/ddo\/[0-9a-f]{64}\/[0-9a-f]{64}\.json with the write key via http:\/\/127\.0\.0\.1:9000 failed \(network error: fetch failed, after 2 attempts\)/
      )
      expect(thrown.message).not.to.contain('write-secret')
      expect(thrown.message).not.to.contain('WRITEKEY')
      expect(thrown.cause).to.be.instanceOf(TypeError)
      expect(bucket.requests).to.have.length(2)
    })

    it('retries a 5xx once, freshly signed, and not a 4xx', async () => {
      const answers = [503, 200]
      const dates: string[] = []
      const flaky = (async (_url: string, init: RequestInit) => {
        dates.push((init.headers as Record<string, string>)['x-amz-date'])
        return new Response('', { status: answers.shift() ?? 500 })
      }) as unknown as typeof fetch
      let tick = 0

      await store(fakeBucket(), {
        fetchImpl: flaky,
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++))
      }).put('{}', { did: ASSET_DID })

      expect(dates).to.have.length(2)
      expect(dates[0]).not.to.equal(dates[1])

      const denied = fakeBucket({ errorCode: 'SignatureDoesNotMatch' })
      await expectThrowsAsync(
        () => store(denied).put('{}', { did: ASSET_DID }),
        /signature mismatch/
      )
      expect(denied.requests).to.have.length(1)
    })

    describe('timeouts', () => {
      beforeEach(() => {
        vi.useFakeTimers()
      })
      afterEach(() => {
        vi.useRealTimers()
      })

      it('times out a request that hangs', async () => {
        let called!: () => void
        const sent = new Promise<void>((resolve) => {
          called = resolve
        })
        const fetchImpl = ((_url: string, init: RequestInit) => {
          called()
          return new Promise((_, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new Error('aborted'))
            )
          )
        }) as unknown as typeof fetch

        const waiting = store(fakeBucket(), {
          fetchImpl,
          requestTimeoutMs: 2000
        })
          .put('{}', { did: ASSET_DID })
          .catch((error) => error)

        // Signing uses WebCrypto, which settles outside the fake clock.
        await sent
        await vi.advanceTimersByTimeAsync(2500)

        expect((await waiting).message).to.match(
          /S3 PUT .* failed \(timed out after 2000 ms\)/
        )
        expect(vi.getTimerCount()).to.equal(0)
      })
    })
  })

  describe('verify', () => {
    const hashOf = (body: string) =>
      `0x${createHash('sha256')
        .update(JSON.stringify(JSON.parse(body)))
        .digest('hex')}`

    it('reads the object back with the read key and checks the node hash', async () => {
      const bucket = fakeBucket()
      const s3 = store(bucket)
      const envelope = '{"encryptedData":"0x0102"}'
      const pointer = await s3.put(envelope, { did: ASSET_DID })

      await s3.verify(pointer, hashOf(envelope))

      expect(bucket.requests.at(-1)).to.deep.include({
        method: 'GET',
        key: 'READKEY'
      })
    })

    it('fails when the store changed the bytes', async () => {
      const bucket = fakeBucket({
        tamper: (body) => JSON.stringify({ ...JSON.parse(body), extra: 1 })
      })
      const s3 = store(bucket)
      const envelope = '{"encryptedData":"0x0102"}'
      const pointer = await s3.put(envelope, { did: ASSET_DID })

      await expectThrowsAsync(
        () => s3.verify(pointer, hashOf(envelope)),
        /Verifying s3:\/\/ddos\/.* failed: it hashes to 0x[0-9a-f]{64}, not 0x/
      )
    })

    it('fails when the read key cannot read', async () => {
      const bucket = fakeBucket()
      const s3 = store(bucket)
      const pointer = await s3.put('{}', { did: ASSET_DID })

      await expectThrowsAsync(
        () =>
          store(
            fakeBucket({ getAnswer: { status: 403, code: 'AccessDenied' } })
          ).verify(pointer, hashOf('{}')),
        /GET .* with the read key: access denied/
      )
    })
  })

  describe('keys', () => {
    it('refuses unsafe prefixes', () => {
      for (const prefix of ['ddo/../', './ddo/', 'ddo//x/', '/ddo/', 'ddo\\x/'])
        expect(() => store(fakeBucket(), { prefix }), prefix).to.throw(
          /S3RemoteStore: the prefix .* (contains a backslash|starts with \/|has an empty, "\." or "\.\." segment)/
        )

      expect(() => store(fakeBucket(), { prefix: '' })).not.to.throw()
      expect(() => store(fakeBucket(), { prefix: 'a/b/' })).not.to.throw()
    })

    it('removes only keys under the prefix in the bucket', async () => {
      const bucket = fakeBucket()
      const s3 = store(bucket)
      const at = (bucketName: string, objectKey: string) =>
        ({
          type: 's3',
          s3Access: { bucket: bucketName, objectKey }
        }) as never

      for (const [pointer, message] of [
        [at('ddos', 'ddo/../other/important.json'), /"\.\." segment/],
        [at('ddos', 'other/important.json'), /outside the prefix "ddo\/"/],
        [at('ddos', '/ddo/x.json'), /starts with \//],
        [at('elsewhere', 'ddo/x.json'), /not a pointer into bucket ddos/],
        [{ type: 'ipfs', hash: 'x' } as never, /not a pointer into bucket ddos/]
      ] as const)
        await expectThrowsAsync(() => s3.remove(pointer), message)

      expect(bucket.requests).to.have.length(0)
    })

    it('removes through the redacted pointer from PublishResponse.stored', async () => {
      const bucket = fakeBucket()
      const s3 = store(bucket)

      const prepared = await prepareMetadata({
        node: createNodeMock().client,
        ddo: {},
        signer: {
          getIssuer: async () => 'x',
          // A JWS whose payload is the (empty) DDO it was given.
          sign: async () => ({ jwt: 'a.e30.c', issuer: 'x' })
        },
        remoteStore: s3,
        did: ASSET_DID
      })

      const access = (
        prepared.stored.pointer as unknown as {
          s3Access: Record<string, unknown>
        }
      ).s3Access
      expect(access.secretAccessKey).to.equal('<redacted>')
      expect(access.accessKeyId).to.equal('READKEY')
      expect(JSON.stringify(prepared)).not.to.contain('read-secret')

      await s3.remove(prepared.stored.pointer)

      expect(bucket.objects.size).to.equal(0)
    })
  })
})
