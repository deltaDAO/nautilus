/**
 * The transport rule and `fetchText`, the two helpers every request nautilus sends goes
 * through.
 *
 * The rule used to match a literal `http://` prefix, but `fetch` parses URLs the WHATWG
 * way: `http:host`, `http:/host`, `http:\\host` and a tab inside the scheme all reach the
 * host over plain `http://`. And `fetchText` followed redirects, so headers other than
 * `Authorization` (IPFS pinning keys) and request bodies went wherever a 3xx pointed.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchResponse,
  fetchText,
  MAX_ERROR_BODY_BYTES,
  MAX_TIMER_MS,
  RedirectError,
  RequestTimeoutError
} from '../../src/utils/http.js'
import {
  assertSecureTransport,
  isInternalHost,
  isLoopbackHost,
  parseHttpUrl
} from '../../src/utils/transport.js'

function thrownBy(fn: () => unknown): Error | undefined {
  try {
    fn()
  } catch (error) {
    return error as Error
  }
  return undefined
}

describe('assertSecureTransport', () => {
  it('judges the URL as fetch parses it, not by its prefix', () => {
    for (const url of [
      'http:evil.example',
      'http:/evil.example',
      'http:\\\\evil.example',
      'HTTP:evil.example',
      ' http://evil.example ',
      'http://localhost@evil.example',
      'http://evil.example\\.localhost'
    ])
      expect(
        thrownBy(() => assertSecureTransport(url, 'url'))?.message,
        url
      ).to.match(/^url uses plain http:\/\//)
  })

  it('refuses tab, CR, LF and other C0 control characters anywhere', () => {
    for (const url of [
      'ht\ttp://evil.example',
      'http\n://evil.example',
      'https://evil\r.example',
      'https://evil.example/\u0000',
      'h\u001fttps://evil.example'
    ])
      expect(
        thrownBy(() => assertSecureTransport(url, 'url', true))?.message,
        JSON.stringify(url)
      ).to.match(/^url contains a control character/)
  })

  it('refuses schemes other than http and https', () => {
    for (const url of ['ftp://node.example', 'ws://node.example', 'file:///x'])
      expect(
        thrownBy(() => assertSecureTransport(url, 'url'))?.message,
        url
      ).to.match(/must be an https:\/\/ URL, but its scheme is/)
  })

  it('refuses an http URL that does not parse', () => {
    expect(
      thrownBy(() => assertSecureTransport('http://', 'url'))?.message
    ).to.match(/is not a valid URL/)
    expect(
      thrownBy(() => assertSecureTransport('https://[bad', 'url'))?.message
    ).to.match(/is not a valid URL/)
  })

  it('leaves strings that are not URLs (peer ids, multiaddrs) alone', () => {
    for (const value of [
      '16Uiu2HAmPeerIdOnly',
      '/ip4/10.0.0.5/tcp/9000/p2p/16Uiu2HAmPeerIdOnly',
      '/dns4/node.example/tcp/443/wss/p2p/16Uiu2HAmPeerIdOnly'
    ])
      expect(() => assertSecureTransport(value, 'url')).not.to.throw()
  })

  it('accepts https, and http on loopback hosts in any spelling the parser normalises', () => {
    for (const url of [
      'https://node.example',
      'https:node.example',
      'http://localhost:8001',
      'http:localhost:8001',
      'http://LOCALHOST.',
      'http://127.0.0.1',
      'http://127.1.2.3',
      'http://127.1',
      'http://0x7f.0.0.1',
      'http://[::1]:8001',
      'http://[0:0:0:0:0:0:0:1]',
      'http://node.localhost'
    ])
      expect(() => assertSecureTransport(url, 'url'), url).not.to.throw()
  })

  it('accepts plain http anywhere with allowInsecure', () => {
    expect(() =>
      assertSecureTransport('http:evil.example', 'url', true)
    ).not.to.throw()
  })
})

describe('isLoopbackHost', () => {
  it('is localhost, *.localhost, 127.0.0.0/8 and ::1 only', () => {
    for (const host of [
      'localhost',
      'a.localhost',
      '127.0.0.1',
      '127.255.0.9',
      '[::1]'
    ])
      expect(isLoopbackHost(host), host).to.equal(true)

    for (const host of [
      'localhost.evil.example',
      '127.0.0.256',
      '128.0.0.1',
      '0.0.0.0',
      '::',
      '[::ffff:127.0.0.1]'
    ])
      expect(isLoopbackHost(host), host).to.equal(false)
  })
})

describe('isInternalHost', () => {
  it('names loopback, private, link-local and intranet hosts', () => {
    for (const url of [
      'http://localhost',
      'http://127.0.0.1',
      'http://10.1.2.3',
      'http://172.16.0.1',
      'http://172.31.255.255',
      'http://192.168.1.1',
      'http://169.254.169.254',
      'http://100.64.0.1',
      'http://0.0.0.0',
      // The URL parser's other notations of 127.0.0.1 and 169.254.169.254.
      'http://2130706433',
      'http://0xa9.0xfe.0xa9.0xfe',
      'http://[::1]',
      'http://[::]',
      'http://[fd00::1]',
      'http://[fe80::1]',
      'http://[::ffff:169.254.169.254]',
      'http://[::ffff:10.0.0.1]',
      'http://metadata',
      'http://metadata.google.internal',
      'http://printer.local',
      'http://router.home.arpa'
    ])
      expect(isInternalHost(new URL(url).hostname), url).to.equal(true)
  })

  it('leaves public hosts alone', () => {
    for (const url of [
      'https://node.example',
      'http://8.8.8.8',
      'http://172.32.0.1',
      'http://100.128.0.1',
      'http://[2001:db8::1]',
      'http://[::ffff:8.8.8.8]'
    ])
      expect(isInternalHost(new URL(url).hostname), url).to.equal(false)
  })
})

describe('parseHttpUrl', () => {
  it('parses http and https URLs the way fetch does', () => {
    expect(parseHttpUrl('http:node.example')?.href).to.equal(
      'http://node.example/'
    )
    expect(parseHttpUrl('HTTPS://node.example/x')?.protocol).to.equal('https:')
  })

  it('is undefined for peer ids, multiaddrs, other schemes and control characters', () => {
    for (const value of [
      '16Uiu2HAmPeerIdOnly',
      '/ip4/10.0.0.5/tcp/9000',
      'ftp://node.example',
      'ht\ttp://node.example'
    ])
      expect(parseHttpUrl(value), value).to.equal(undefined)
  })
})

describe('fetchText', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const redirectTo = (location: string, status = 302) =>
    vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status, headers: { location } })
    )

  it('does not follow redirects, and names the target origin only', async () => {
    const fetchImpl = redirectTo('http://evil.example/steal?token=secret')

    const error = await fetchText(
      fetchImpl as typeof fetch,
      'https://store.example/upload?key=k',
      { method: 'POST', body: 'x' },
      { timeoutMs: 1000 }
    ).catch((thrown: unknown) => thrown)

    expect(fetchImpl.mock.calls[0][1]?.redirect).to.equal('manual')
    expect(error).to.be.instanceOf(RedirectError)
    expect((error as RedirectError).status).to.equal(302)
    expect((error as RedirectError).locationOrigin).to.equal(
      'http://evil.example'
    )
    expect((error as Error).message).to.contain(
      'https://store.example answered with a redirect (302) to http://evil.example'
    )
    expect((error as Error).message).not.to.match(/secret|key=k/)
  })

  it('resolves a relative Location against the request URL', async () => {
    const error = await fetchText(
      redirectTo('/elsewhere', 307) as typeof fetch,
      'https://store.example/upload',
      {},
      { timeoutMs: 1000 }
    ).catch((thrown: unknown) => thrown)

    expect((error as RedirectError).locationOrigin).to.equal(
      'https://store.example'
    )
  })

  it('treats an opaque browser redirect as a redirect', async () => {
    const opaque = {
      type: 'opaqueredirect',
      status: 0,
      ok: false,
      statusText: '',
      headers: new Headers(),
      body: null,
      text: async () => ''
    } as unknown as Response

    const error = await fetchText(
      (async () => opaque) as typeof fetch,
      'https://store.example/upload',
      {},
      { timeoutMs: 1000 }
    ).catch((thrown: unknown) => thrown)

    expect(error).to.be.instanceOf(RedirectError)
    expect((error as Error).message).to.contain('redirect (opaque)')
  })

  it('follows redirects with followRedirects: true', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )

    const response = await fetchText(
      fetchImpl as typeof fetch,
      'https://gateway.example/ipfs/cid',
      { method: 'GET' },
      { timeoutMs: 1000, followRedirects: true }
    )

    expect(fetchImpl.mock.calls[0][1]?.redirect).to.equal('follow')
    expect(response.body).to.equal('ok')
  })

  describe('the transport rule on a followed redirect', () => {
    /** A response as fetch hands it back after following redirects to `finalUrl`. */
    const landedOn = (finalUrl: string, body = 'ok') => {
      const cancel = vi.fn(async () => undefined)
      const response = new Response(body, { status: 200 })
      Object.defineProperty(response, 'url', { value: finalUrl })
      Object.defineProperty(response, 'body', { value: { cancel } })
      Object.defineProperty(response, 'text', { value: async () => body })
      return { fetchImpl: (async () => response) as typeof fetch, cancel }
    }

    it('refuses one that ends on plain http on a non-loopback host, unread', async () => {
      for (const finalUrl of [
        'http://mirror.example/api/aquarius/assets/ddo/x',
        'HTTP://10.0.0.5:8001/x'
      ]) {
        const { fetchImpl, cancel } = landedOn(finalUrl)

        const error = await fetchText(
          fetchImpl,
          'https://node.example/api/aquarius/assets/ddo/x',
          { method: 'GET' },
          { timeoutMs: 1000, followRedirects: true }
        ).catch((thrown: unknown) => thrown)

        expect(error, finalUrl).to.be.instanceOf(RedirectError)
        expect((error as RedirectError).insecure).to.equal(true)
        expect((error as RedirectError).locationOrigin).to.equal(
          new URL(finalUrl).origin
        )
        expect((error as Error).message).to.contain(
          'https://node.example redirected to plain http://'
        )
        expect(cancel).toHaveBeenCalledOnce()
      }
    })

    it('accepts https, loopback http, and http when the request was plain http already', async () => {
      for (const [requested, finalUrl] of [
        ['https://node.example/x', 'https://mirror.example/x'],
        ['http://localhost:8001/x', 'http://localhost:8002/x'],
        // The node is on a private network itself.
        ['https://10.0.0.5/x', 'https://10.0.0.6/x'],
        // allowInsecureTransport: the request already went out in clear.
        ['http://node.example/x', 'http://mirror.example/x']
      ]) {
        const { fetchImpl } = landedOn(finalUrl)

        const response = await fetchText(
          fetchImpl,
          requested,
          { method: 'GET' },
          { timeoutMs: 1000, followRedirects: true }
        )

        expect(response.url, `${requested} -> ${finalUrl}`).to.equal(finalUrl)
      }
    })

    it('refuses one from a public host to an internal one, unread', async () => {
      for (const finalUrl of [
        'http://127.0.0.1:8001/x',
        'https://169.254.169.254/latest/meta-data/',
        'https://10.0.0.5/x',
        'https://[fd00::1]/x',
        'https://metadata.google.internal/x'
      ]) {
        const { fetchImpl, cancel } = landedOn(finalUrl, 'secret-credentials')

        const error = await fetchText(
          fetchImpl,
          'https://node.example/api/aquarius/assets/ddo/x',
          { method: 'GET' },
          { timeoutMs: 1000, followRedirects: true }
        ).catch((thrown: unknown) => thrown)

        expect(error, finalUrl).to.be.instanceOf(RedirectError)
        expect((error as RedirectError).internal).to.equal(true)
        expect((error as Error).message).to.contain(
          'https://node.example redirected to a loopback, private or link-local host'
        )
        expect((error as Error).message).not.to.contain('secret')
        expect(cancel).toHaveBeenCalledOnce()
      }
    })

    it('refuses a loopback request that is redirected to a remote host in clear', async () => {
      const { fetchImpl } = landedOn('http://mirror.example/x')

      const error = await fetchText(
        fetchImpl,
        'http://127.0.0.1:8001/x',
        { method: 'GET' },
        { timeoutMs: 1000, followRedirects: true }
      ).catch((thrown: unknown) => thrown)

      expect((error as RedirectError).insecure).to.equal(true)
    })

    it('reports the requested URL when fetch names none', async () => {
      const response = await fetchText(
        (async () => new Response('ok')) as typeof fetch,
        'https://node.example/x',
        { method: 'GET' },
        { timeoutMs: 1000, followRedirects: true }
      )

      expect(response.url).to.equal('https://node.example/x')
    })
  })

  it('passes a 304 through: it is not a redirect', async () => {
    const response = await fetchText(
      (async () => new Response(null, { status: 304 })) as typeof fetch,
      'https://store.example/x',
      {},
      { timeoutMs: 1000 }
    )

    expect(response.status).to.equal(304)
  })

  it('rejects a timeout that is negative or not finite', async () => {
    const fetchImpl = vi.fn()

    for (const timeoutMs of [Number.POSITIVE_INFINITY, Number.NaN, -1])
      await expect(
        fetchText(
          fetchImpl as typeof fetch,
          'https://x.example',
          {},
          {
            timeoutMs
          }
        )
      ).rejects.toThrow(RangeError)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('clamps a timeout above 2^31 - 1 ms instead of firing after 1 ms', async () => {
    vi.useFakeTimers()
    const hang = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted'))
        )
      )

    let settled: unknown
    const pending = fetchText(
      hang as typeof fetch,
      'https://x.example',
      {},
      { timeoutMs: 2 ** 40 }
    ).catch((error: unknown) => {
      settled = error
    })

    await vi.advanceTimersByTimeAsync(10)
    expect(settled).to.equal(undefined)

    await vi.advanceTimersByTimeAsync(MAX_TIMER_MS)
    await pending
    expect(settled).to.be.instanceOf(RequestTimeoutError)
  })

  describe('against a real loopback server', () => {
    let server: Server | undefined

    afterEach(async () => {
      await new Promise<void>((resolve) =>
        server ? server.close(() => resolve()) : resolve()
      )
      server = undefined
    })

    it('does not send the request on to the redirect target', async () => {
      const seen: string[] = []
      server = createServer((request, response) => {
        seen.push(`${request.method} ${request.url}`)
        if (request.url === '/upload') {
          response.writeHead(307, { location: '/stolen' })
          response.end()
        } else {
          response.writeHead(200)
          response.end('stolen')
        }
      })
      await new Promise<void>((resolve) =>
        server?.listen(0, '127.0.0.1', resolve)
      )
      const { port } = server.address() as AddressInfo

      const error = await fetchText(
        fetch,
        `http://127.0.0.1:${port}/upload`,
        {
          method: 'POST',
          headers: { pinata_secret_api_key: 'secret' },
          body: 'envelope'
        },
        { timeoutMs: 2000 }
      ).catch((thrown: unknown) => thrown)

      expect(error).to.be.instanceOf(RedirectError)
      expect((error as RedirectError).locationOrigin).to.equal(
        `http://127.0.0.1:${port}`
      )
      expect(seen).to.deep.equal(['POST /upload'])
    })

    it('follows a redirect with followRedirects and reports the final URL', async () => {
      server = createServer((request, response) => {
        if (request.url === '/api/aquarius/assets/ddo/x') {
          response.writeHead(301, { location: '/aquarius/assets/ddo/x' })
          response.end()
        } else {
          response.writeHead(200)
          response.end('{"id":"x"}')
        }
      })
      await new Promise<void>((resolve) =>
        server?.listen(0, '127.0.0.1', resolve)
      )
      const { port } = server.address() as AddressInfo

      const response = await fetchText(
        fetch,
        `http://127.0.0.1:${port}/api/aquarius/assets/ddo/x`,
        { method: 'GET' },
        { timeoutMs: 2000, followRedirects: true }
      )

      expect(response.status).to.equal(200)
      expect(response.body).to.equal('{"id":"x"}')
      expect(response.url).to.equal(
        `http://127.0.0.1:${port}/aquarius/assets/ddo/x`
      )
    })
  })
})

describe('fetchResponse and the error body', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A body that sends `chunks` and then stays open until the request is aborted. */
  const openStream = (init: RequestInit | undefined, chunks: string[] = []) => {
    const pulled: string[] = []
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () =>
          controller.error(new DOMException('aborted', 'AbortError'))
        )
      },
      pull(controller) {
        const next = chunks.shift()
        if (next === undefined) return new Promise(() => {})
        pulled.push(next)
        controller.enqueue(new TextEncoder().encode(next))
      },
      cancel: cancelled
    })
    return { body, pulled, cancelled }
  }

  it('reads at most MAX_ERROR_BODY_BYTES of an error answer and cancels the rest', async () => {
    const chunk = 'x'.repeat(16 * 1024)
    let stream: ReturnType<typeof openStream> | undefined

    const answer = await fetchText(
      (async (_url: unknown, init?: RequestInit) => {
        stream = openStream(init, Array(100).fill(chunk))
        return new Response(stream.body, { status: 500 })
      }) as typeof fetch,
      'https://node.example/x',
      {},
      { timeoutMs: 1000 }
    )

    expect(answer.status).to.equal(500)
    expect(answer.body).to.have.length(MAX_ERROR_BODY_BYTES)
    expect(stream?.pulled.length).to.be.below(100)
    expect(stream?.cancelled).toHaveBeenCalledOnce()
  })

  it('reads a 2xx answer whole', async () => {
    const body = 'y'.repeat(MAX_ERROR_BODY_BYTES * 2)

    const answer = await fetchText(
      (async () => new Response(body)) as typeof fetch,
      'https://node.example/x',
      {},
      { timeoutMs: 1000 }
    )

    expect(answer.body).to.equal(body)
  })

  it('times out while an error body is still being read', async () => {
    vi.useFakeTimers()
    const fetchImpl = (async (_url: unknown, init?: RequestInit) =>
      new Response(openStream(init, ['partial']).body, {
        status: 502
      })) as typeof fetch

    for (const send of [fetchText, fetchResponse]) {
      const pending = send(
        fetchImpl,
        'https://node.example/x',
        {},
        { timeoutMs: 50 }
      ).catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(60)
      expect(await pending, send.name).to.be.instanceOf(RequestTimeoutError)
    }
  })

  it("rejects with the caller's reason when it aborts", async () => {
    for (const send of [fetchText, fetchResponse]) {
      const controller = new AbortController()
      const reason = new Error('stop')
      const pending = send(
        (async (_url: unknown, init?: RequestInit) =>
          new Response(openStream(init).body, { status: 500 })) as typeof fetch,
        'https://node.example/x',
        {},
        { timeoutMs: 10_000, signal: controller.signal }
      ).catch((error: unknown) => error)

      await new Promise((resolve) => setTimeout(resolve, 5))
      controller.abort(reason)
      expect(await pending, send.name).to.equal(reason)
    }
  })

  it('hands back a 2xx response unread, its stream outliving the timeout', async () => {
    vi.useFakeTimers()
    let stream: ReturnType<typeof openStream> | undefined

    const answer = await fetchResponse(
      (async (_url: unknown, init?: RequestInit) => {
        stream = openStream(init, ['a', 'b'])
        return new Response(stream.body)
      }) as typeof fetch,
      'https://node.example/logs',
      {},
      { timeoutMs: 50 }
    )
    await vi.advanceTimersByTimeAsync(100)

    expect(answer.ok).to.equal(true)
    if (!answer.ok) return
    const reader = answer.response.body?.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader?.read())?.value)).to.equal('a')
    expect(decoder.decode((await reader?.read())?.value)).to.equal('b')
  })

  it('reads an error answer as text', async () => {
    const answer = await fetchResponse(
      (async () =>
        new Response('Job not found', {
          status: 404,
          statusText: 'Not Found'
        })) as typeof fetch,
      'https://node.example/logs',
      {},
      { timeoutMs: 1000 }
    )

    expect(answer).to.deep.include({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      body: 'Job not found'
    })
  })

  it('refuses a redirect, as fetchText does', async () => {
    const error = await fetchResponse(
      (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://elsewhere.example/x' }
        })) as typeof fetch,
      'https://node.example/logs?signature=0xabc',
      {},
      { timeoutMs: 1000 }
    ).catch((thrown: unknown) => thrown)

    expect(error).to.be.instanceOf(RedirectError)
    expect((error as RedirectError).locationOrigin).to.equal(
      'https://elsewhere.example'
    )
  })
})
