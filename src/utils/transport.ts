/**
 * Transport rules for the requests nautilus itself sends: the ocean-node URI, the S3 upload
 * endpoint and the IPFS upload (and gateway) URL.
 *
 * Every one of them carries something that must not travel in clear: the plaintext pointer
 * (S3 read key included) and the signed DDO go to the node for encryption, the envelope and
 * the write key's signatures go to the store, and pinning tokens go to the IPFS service. So
 * plain `http:` is refused, except for loopback hosts, where nothing leaves the machine.
 *
 * Kept out of the package's exports.
 */

/** `localhost`, `*.localhost`, `127.0.0.1` and `::1`: hosts that never leave the machine. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1'
  )
}

/** Whether the host is an IP address (v4 or v6) rather than a DNS name. */
export function isIpAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '')

  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

/**
 * Throws for a plain `http:` URL on a non-loopback host, unless `allowInsecure`.
 *
 * Only `http:`/`https:` URLs are judged. Anything else (a libp2p peer id or multiaddr for
 * the node) is left to the caller.
 */
export function assertSecureTransport(
  url: string,
  what: string,
  allowInsecure = false
): void {
  if (allowInsecure || !/^http:\/\//i.test(url.trim())) return

  let hostname: string
  try {
    hostname = new URL(url.trim()).hostname
  } catch {
    throw new Error(`${what} is not a valid URL: ${url}`)
  }

  if (isLoopbackHost(hostname)) return

  throw new Error(
    `${what} uses plain http:// (${url}). nautilus sends the plaintext DDO pointer, signed DDOs or credentials there, so it requires https:// except for localhost, 127.0.0.1, ::1 and *.localhost. Pass allowInsecureTransport: true to accept the risk, e.g. on a private network.`
  )
}
