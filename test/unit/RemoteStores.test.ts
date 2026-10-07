import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { IpfsRemoteStore } from '../../src/remote/IpfsRemoteStore.js'
import { expectThrowsAsync } from '../helpers.js'

const CID_V1 = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
const CID_V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwaW5hdGEifQ.c2lnbmF0dXJl'

function fetchAnswering(status: number, body: string) {
  return vi.fn(
    async (_url?: string | URL | Request, _init?: RequestInit) =>
      new Response(body, { status })
  )
}

const callOf = (fetchImpl: ReturnType<typeof fetchAnswering>, index = 0) =>
  fetchImpl.mock.calls[index] as unknown as [string, RequestInit]

describe('IpfsRemoteStore', () => {
  it('uploads the payload unchanged and reads the CID (Kubo and Pinata keys)', async () => {
    for (const response of [
      { Name: 'x', Hash: CID_V1, Size: '1' },
      { IpfsHash: CID_V0, PinSize: 1 }
    ]) {
      const fetchImpl = fetchAnswering(200, JSON.stringify(response))
      const store = new IpfsRemoteStore({
        uploadUrl: 'https://ipfs.test',
        fetchImpl
      })

      const pointer = await store.put('{"encryptedData":"0x01"}', {
        did: 'did:ope:1'
      })

      const form = callOf(fetchImpl)[1].body as FormData
      expect(await (form.get('file') as Blob).text()).to.equal(
        '{"encryptedData":"0x01"}'
      )
      expect(pointer).to.deep.equal({
        type: 'ipfs',
        hash: response.Hash ?? response.IpfsHash
      })
    }
  })

  it('refuses a hash that is not a CID', async () => {
    for (const hash of [
      '../../api/v0/shutdown',
      'bafkubo',
      `${CID_V1}/x`,
      'Qm123',
      'https://evil.test/x'
    ])
      await expectThrowsAsync(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://ipfs.test',
            fetchImpl: fetchAnswering(200, JSON.stringify({ Hash: hash }))
          }).put('{}', { did: 'did:ope:1' }),
        /is not a CIDv0 \(Qm…\) or CIDv1/
      )
  })

  it('checks nothing without a probe', async () => {
    const fetchImpl = fetchAnswering(200, '{}')

    await new IpfsRemoteStore({
      uploadUrl: 'https://ipfs.test',
      verify: false,
      fetchImpl
    }).check()

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("probe: 'upload' surfaces a key without upload scope", async () => {
    const fetchImpl = fetchAnswering(
      403,
      '{"error":{"reason":"NO_SCOPES_FOUND"}}'
    )
    const store = new IpfsRemoteStore({
      uploadUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
      headers: { Authorization: 'Bearer test' },
      probe: 'upload',
      gatewayUrl: 'https://gateway.test',
      fetchImpl
    })

    await expectThrowsAsync(() => store.check(), /403.*NO_SCOPES_FOUND/)
  })

  it('a same-origin probe URL gets the store headers and must answer 2xx', async () => {
    const fetchImpl = fetchAnswering(401, 'unauthorized')
    const store = new IpfsRemoteStore({
      uploadUrl: 'https://ipfs.test/add',
      headers: { Authorization: 'Bearer test' },
      probe: { url: 'https://ipfs.test/auth' },
      verify: false,
      fetchImpl
    })

    await expectThrowsAsync(() => store.check(), /check failed: 401/)

    const [url, init] = callOf(fetchImpl)
    expect(url).to.equal('https://ipfs.test/auth')
    expect(init).to.deep.include({
      method: 'GET',
      headers: { Authorization: 'Bearer test' }
    })
  })

  it('sends no upload headers to a probe URL on another origin', async () => {
    const fetchImpl = fetchAnswering(200, '{}')

    await new IpfsRemoteStore({
      uploadUrl: 'https://ipfs.test/add',
      headers: { Authorization: 'Bearer test' },
      probe: { url: 'https://other.test/auth' },
      verify: false,
      fetchImpl
    }).check()

    expect(callOf(fetchImpl)[1].headers).to.equal(undefined)
  })

  it('sends explicit probe headers, and only those', async () => {
    const fetchImpl = fetchAnswering(200, '{}')

    await new IpfsRemoteStore({
      uploadUrl: 'https://ipfs.test/add',
      headers: { Authorization: 'Bearer upload' },
      probe: {
        url: 'https://other.test/auth',
        headers: { Authorization: 'Bearer probe' }
      },
      verify: false,
      fetchImpl
    }).check()

    expect(callOf(fetchImpl)[1].headers).to.deep.equal({
      Authorization: 'Bearer probe'
    })
  })

  it('bounds upstream bodies in errors and strips anything that looks like a token', async () => {
    // A proxy that reflects the request headers in its error page.
    const body = `<html>Bad gateway. Request headers: Authorization: Bearer ${TOKEN}; x-api-key=sk_live_123456789; jwt ${TOKEN} ${'x'.repeat(2000)}</html>`
    const store = new IpfsRemoteStore({
      uploadUrl: 'https://ipfs.test/add',
      headers: { Authorization: `Bearer ${TOKEN}` },
      fetchImpl: fetchAnswering(502, body)
    })

    const thrown = await store
      .put('{}', { did: 'did:ope:1' })
      .catch((error) => error)

    expect(thrown.message).to.match(/^IPFS upload failed: 502/)
    expect(thrown.message).not.to.contain(TOKEN)
    expect(thrown.message).not.to.contain('sk_live_123456789')
    expect(thrown.message).to.contain('<redacted>')
    expect(thrown.message.length).to.be.lessThan(400)
  })

  it('requires https, except on loopback hosts or when allowed', () => {
    expect(
      () => new IpfsRemoteStore({ uploadUrl: 'http://ipfs.example.org/add' })
    ).to.throw(/IpfsRemoteStore uploadUrl uses plain http:\/\//)
    expect(
      () =>
        new IpfsRemoteStore({
          uploadUrl: 'https://ipfs.example.org/add',
          gatewayUrl: 'http://gateway.example.org'
        })
    ).to.throw(/IpfsRemoteStore gatewayUrl uses plain http:\/\//)

    for (const uploadUrl of [
      'http://127.0.0.1:5001/api/v0/add',
      'http://localhost:5001/api/v0/add',
      'http://[::1]:5001/api/v0/add',
      'http://kubo.localhost/api/v0/add'
    ])
      expect(() => new IpfsRemoteStore({ uploadUrl }), uploadUrl).not.to.throw()
    expect(
      () =>
        new IpfsRemoteStore({
          uploadUrl: 'http://ipfs.example.org/add',
          allowInsecureTransport: true
        })
    ).not.to.throw()
  })

  describe('verify', () => {
    const envelope = '{"encryptedData":"0x0102"}'
    const hash = `0x${createHash('sha256').update(envelope).digest('hex')}`

    it('without a gatewayUrl reads a Kubo upload back through the same node', async () => {
      const fetchImpl = fetchAnswering(200, envelope)

      await new IpfsRemoteStore({
        uploadUrl: 'http://127.0.0.1:5001/kubo/api/v0/add?cid-version=1',
        headers: { Authorization: 'Basic kubo' },
        fetchImpl
      }).verify({ type: 'ipfs', hash: CID_V1 } as never, hash)

      const [url, init] = callOf(fetchImpl)
      expect(url).to.equal(
        `http://127.0.0.1:5001/kubo/api/v0/cat?arg=${CID_V1}`
      )
      expect(init).to.deep.include({
        method: 'POST',
        headers: { Authorization: 'Basic kubo' }
      })

      await expectThrowsAsync(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'http://127.0.0.1:5001/api/v0/add',
            fetchImpl: fetchAnswering(200, '{"encryptedData":"0x03"}')
          }).verify({ type: 'ipfs', hash: CID_V1 } as never, hash),
        /via the Kubo node http:\/\/127\.0\.0\.1:5001 failed: it hashes to 0x[0-9a-f]{64}, not 0x/
      )
      await expectThrowsAsync(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'http://127.0.0.1:5001/api/v0/add',
            fetchImpl: fetchAnswering(
              500,
              '{"Message":"block was not found locally","Code":0}'
            )
          }).verify({ type: 'ipfs', hash: CID_V1 } as never, hash),
        /the Kubo node answered 500/
      )
    })

    it('prefers the gateway over a Kubo node', async () => {
      const fetchImpl = fetchAnswering(200, envelope)

      await new IpfsRemoteStore({
        uploadUrl: 'http://127.0.0.1:5001/api/v0/add',
        gatewayUrl: 'http://127.0.0.1:8080',
        fetchImpl
      }).verify({ type: 'ipfs', hash: CID_V1 } as never, hash)

      expect(callOf(fetchImpl)[0]).to.equal(
        `http://127.0.0.1:8080/ipfs/${CID_V1}`
      )
    })

    it('refuses to pass without a way to read back, in check() and verify()', async () => {
      for (const uploadUrl of [
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        'https://uploader.test/files'
      ]) {
        const fetchImpl = fetchAnswering(200, JSON.stringify({ Hash: CID_V1 }))
        const store = new IpfsRemoteStore({
          uploadUrl,
          probe: 'upload',
          fetchImpl
        })

        // check() runs before anything is minted, so this is where publish() stops.
        await expectThrowsAsync(
          () => store.check(),
          /cannot read the envelope back .*Set gatewayUrl .*verify: false/
        )
        await expectThrowsAsync(
          () => store.verify({ type: 'ipfs', hash: CID_V1 } as never, hash),
          /cannot read the envelope back/
        )
        expect(fetchImpl).not.toHaveBeenCalled()
      }
    })

    it('verify: false is an explicit opt-out, and excludes gatewayUrl', async () => {
      const fetchImpl = fetchAnswering(200, JSON.stringify({ Hash: CID_V1 }))
      const store = new IpfsRemoteStore({
        uploadUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
        probe: 'upload',
        verify: false,
        fetchImpl
      })

      await store.check()
      expect(fetchImpl).toHaveBeenCalledOnce() // the probe upload only

      await store.verify({ type: 'ipfs', hash: CID_V1 } as never, hash)
      expect(fetchImpl).toHaveBeenCalledOnce()

      expect(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
            gatewayUrl: 'https://gateway.pinata.cloud',
            verify: false
          })
      ).to.throw(/cannot be combined with verify: false/)
    })

    it('reads <gatewayUrl>/ipfs/<cid> like the node, and checks the hash', async () => {
      const fetchImpl = fetchAnswering(
        200,
        `\n${JSON.stringify(JSON.parse(envelope), null, 2)}\n`
      )
      const store = new IpfsRemoteStore({
        uploadUrl: 'https://ipfs.test/add',
        headers: { Authorization: 'Bearer upload' },
        gatewayUrl: 'https://gateway.test/',
        fetchImpl
      })

      await store.verify({ type: 'ipfs', hash: CID_V1 } as never, hash)

      const [url, init] = callOf(fetchImpl)
      expect(url).to.equal(`https://gateway.test/ipfs/${CID_V1}`)
      expect(init.headers).to.equal(undefined)
    })

    it('fails when the gateway serves other bytes, or cannot serve it', async () => {
      await expectThrowsAsync(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://ipfs.test/add',
            gatewayUrl: 'https://gateway.test',
            fetchImpl: fetchAnswering(200, '{"encryptedData":"0x03"}')
          }).verify({ type: 'ipfs', hash: CID_V1 } as never, hash),
        /it hashes to 0x[0-9a-f]{64}, not 0x/
      )
      await expectThrowsAsync(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://ipfs.test/add',
            gatewayUrl: 'https://gateway.test',
            fetchImpl: fetchAnswering(504, 'Gateway Timeout')
          }).verify({ type: 'ipfs', hash: CID_V1 } as never, hash),
        /the gateway answered 504 .*\(https:\/\/gateway\.test\); the node may not/
      )
      await expectThrowsAsync(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://ipfs.test/add',
            gatewayUrl: 'https://gateway.test',
            fetchImpl: fetchAnswering(200, 'not json')
          }).verify({ type: 'ipfs', hash: CID_V1 } as never, hash),
        /is not JSON/
      )
    })
  })

  describe('remove', () => {
    const pointer = { type: 'ipfs', hash: CID_V1 } as never

    it('unpins on Pinata with DELETE /pinning/unpin/<cid> and the upload headers', async () => {
      const fetchImpl = fetchAnswering(200, 'OK')

      await new IpfsRemoteStore({
        uploadUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
        headers: { Authorization: `Bearer ${TOKEN}` },
        fetchImpl
      }).remove(pointer)

      const [url, init] = callOf(fetchImpl)
      expect(url).to.equal(`https://api.pinata.cloud/pinning/unpin/${CID_V1}`)
      expect(init).to.deep.include({
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` }
      })
    })

    it('unpins on Kubo with POST /api/v0/pin/rm?arg=<cid>, keeping a path prefix', async () => {
      const fetchImpl = fetchAnswering(200, JSON.stringify({ Pins: [CID_V1] }))

      await new IpfsRemoteStore({
        uploadUrl: 'http://127.0.0.1:5001/kubo/api/v0/add?cid-version=1',
        fetchImpl
      }).remove(pointer)

      const [url, init] = callOf(fetchImpl)
      expect(url).to.equal(
        `http://127.0.0.1:5001/kubo/api/v0/pin/rm?arg=${CID_V1}`
      )
      expect(init.method).to.equal('POST')
    })

    it('uses a configured unpin URL, with headers only for the upload origin', async () => {
      const sameOrigin = fetchAnswering(200, '')
      await new IpfsRemoteStore({
        uploadUrl: 'https://pin.test/upload',
        headers: { Authorization: 'Bearer upload' },
        unpin: { url: 'https://pin.test/pins/{cid}' },
        fetchImpl: sameOrigin
      }).remove(pointer)

      expect(callOf(sameOrigin)[0]).to.equal(`https://pin.test/pins/${CID_V1}`)
      expect(callOf(sameOrigin)[1]).to.deep.include({
        method: 'DELETE',
        headers: { Authorization: 'Bearer upload' }
      })

      const otherOrigin = fetchAnswering(200, '')
      await new IpfsRemoteStore({
        uploadUrl: 'https://pin.test/upload',
        headers: { Authorization: 'Bearer upload' },
        unpin: { url: 'https://other.test/rm?cid={cid}', method: 'POST' },
        fetchImpl: otherOrigin
      }).remove(pointer)

      expect(callOf(otherOrigin)[1]).to.deep.include({
        method: 'POST',
        headers: undefined
      })
    })

    it('counts a CID that is not pinned as removed, but not an auth failure', async () => {
      await new IpfsRemoteStore({
        uploadUrl: 'http://127.0.0.1:5001/api/v0/add',
        fetchImpl: fetchAnswering(
          500,
          '{"Message":"not pinned or pinned indirectly","Code":0,"Type":"error"}'
        )
      }).remove(pointer)

      await expectThrowsAsync(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
            headers: { Authorization: `Bearer ${TOKEN}` },
            fetchImpl: fetchAnswering(
              403,
              `{"error":"not pinned? key ${TOKEN} lacks the unpin scope"}`
            )
          }).remove(pointer),
        /^IPFS unpin of bafk\S+ failed: 403 .*<redacted>/
      )
    })

    it('refuses what it cannot unpin', async () => {
      const fetchImpl = fetchAnswering(200, '')
      const kubo = new IpfsRemoteStore({
        uploadUrl: 'http://127.0.0.1:5001/api/v0/add',
        fetchImpl
      })

      for (const bad of [
        { type: 's3', hash: CID_V1 },
        { type: 'ipfs', hash: '../../api/v0/shutdown' },
        { type: 'ipfs' }
      ])
        await expectThrowsAsync(
          () => kubo.remove(bad as never),
          /not an IPFS pointer with a valid CID/
        )

      await expectThrowsAsync(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://uploader.test/files',
            fetchImpl
          }).remove(pointer),
        /cannot tell how to unpin on https:\/\/uploader\.test.*unpin: \{ url/
      )
      await expectThrowsAsync(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'http://127.0.0.1:5001/api/v0/add',
            unpin: false,
            fetchImpl
          }).remove(pointer),
        /turned off/
      )

      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('checks the unpin URL like the others', () => {
      expect(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://pin.test/upload',
            unpin: { url: 'http://pin.example.org/pins/{cid}' }
          })
      ).to.throw(/IpfsRemoteStore unpin.url uses plain http:\/\//)
      expect(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://pin.test/upload',
            unpin: { url: 'https://pin.test/pins' }
          })
      ).to.throw(/needs a \{cid\} placeholder/)
      expect(
        () =>
          new IpfsRemoteStore({
            uploadUrl: 'https://ipfs.example.org/add',
            probe: { url: 'http://ipfs.example.org/auth' }
          })
      ).to.throw(/IpfsRemoteStore probe.url uses plain http:\/\//)
    })
  })
})
