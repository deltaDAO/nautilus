/**
 * AWS Signature Version 4 for the few S3 requests `S3RemoteStore` sends, over WebCrypto.
 *
 * Kept out of the package's exports: it signs exactly what nautilus sends (no query
 * strings, no session tokens, no chunked uploads) and is not meant as a general SigV4
 * implementation.
 */

export interface SigV4Credentials {
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Returns the headers to send, including `authorization`. The payload is always hashed (no
 * `UNSIGNED-PAYLOAD`).
 */
export async function signS3Request(params: {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  credentials: SigV4Credentials
  region: string
  date: Date
}): Promise<Record<string, string>> {
  const url = new URL(params.url)
  const amzDate = params.date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const payloadHash = await sha256Hex(params.body)

  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(params.headers).map(([name, value]) => [
        name.toLowerCase(),
        value.trim()
      ])
    ),
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  }

  const names = Object.keys(headers).sort()
  const signedHeaders = names.join(';')

  const query = [...url.searchParams.entries()]
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')

  const canonicalRequest = [
    params.method,
    url.pathname || '/',
    query,
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    signedHeaders,
    payloadHash
  ].join('\n')

  const scope = `${day}/${params.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest)
  ].join('\n')

  let key: ArrayBuffer = await hmac(
    new TextEncoder().encode(`AWS4${params.credentials.secretAccessKey}`),
    day
  )
  for (const part of [params.region, 's3', 'aws4_request'])
    key = await hmac(key, part)

  const signature = toHex(await hmac(key, stringToSign))

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${params.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  }
}

/** RFC 3986 percent-encoding, as SigV4 requires (`encodeURIComponent` leaves `!'()*`). */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  )
}

async function hmac(
  key: ArrayBuffer | Uint8Array<ArrayBuffer>,
  value: string
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value))
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
