/**
 * Transport rules for the requests nautilus itself sends: the ocean-node URI, the S3 upload
 * endpoint and the IPFS upload (and gateway) URL.
 *
 * Every one of them carries something that must not travel in clear: the plaintext pointer
 * (S3 read key included) and the signed DDO go to the node for encryption, the envelope and
 * the write key's signatures go to the store, and pinning tokens go to the IPFS service. So
 * plain `http:` is refused, except for loopback hosts, where nothing leaves the machine.
 *
 * URLs are judged the way `fetch` reads them: parsed with the WHATWG `URL` parser, so
 * `http:host`, `http:/host`, `http:\\host` and `HTTP://host` are all plain `http:`.
 *
 * Kept out of the package's exports.
 */

/** ASCII tab, CR, LF and the other C0 control characters. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f]/

/**
 * `localhost`, `*.localhost`, `127.0.0.0/8` and `::1`: hosts that never leave the machine.
 *
 * `*.localhost` names are trusted without resolving them. RFC 6761 reserves them for
 * loopback, and browsers and systemd-resolved map them there, but other resolvers may not;
 * use `localhost` or `127.0.0.1` where yours does not.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    isLoopbackIpv4(host) ||
    host === '::1'
  )
}

/** A dotted-decimal address in `127.0.0.0/8`. */
function isLoopbackIpv4(host: string): boolean {
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)

  return !!octets && octets.slice(1).every((octet) => Number(octet) <= 255)
}

/**
 * Hosts that are not on the public internet: loopback (see `isLoopbackHost`), the IPv4
 * private, shared (CGNAT), link-local (cloud metadata at `169.254.169.254`) and `0.0.0.0/8`
 * ranges, IPv6 `::`, unique-local (`fc00::/7`), link-local (`fe80::/10`) and IPv4-mapped
 * forms of those, single-label names (`metadata`, a container name) and the `.local`,
 * `.internal`, `.lan` and `.home.arpa` suffixes.
 *
 * Judged on the name alone, without resolving it: a public name that resolves to an
 * internal address is not caught.
 */
export function isInternalHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

  if (!host || isLoopbackHost(host)) return true

  const ipv4 = ipv4Octets(host) ?? mappedIpv4Octets(host)
  if (ipv4) return isInternalIpv4(ipv4)

  if (host.includes(':')) {
    const first = Number.parseInt(host.split(':')[0] || '0', 16)
    return (
      /^[0:]+$/.test(host) ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80
    )
  }

  return !host.includes('.') || /\.(local|internal|lan|home\.arpa)$/.test(host)
}

/** The four octets of a dotted-decimal IPv4 address. */
function ipv4Octets(host: string): number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  const octets = match?.slice(1).map(Number)

  return octets?.every((octet) => octet <= 255) ? octets : undefined
}

/** The IPv4 address in an IPv4-mapped IPv6 address (`::ffff:a.b.c.d` or `::ffff:xxxx:xxxx`). */
function mappedIpv4Octets(host: string): number[] | undefined {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host)
  if (dotted) return ipv4Octets(dotted[1])

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (!hex) return undefined

  const [high, low] = [hex[1], hex[2]].map((part) => Number.parseInt(part, 16))
  return [high >> 8, high & 0xff, low >> 8, low & 0xff]
}

function isInternalIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** Whether the host is an IP address (v4 or v6) rather than a DNS name. */
export function isIpAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '')

  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

/**
 * `uri` parsed as `fetch` would parse it, when it is an `http:` or `https:` URL; `undefined`
 * otherwise. A string that does not parse as a URL at all (a libp2p peer id or multiaddr)
 * is `undefined`, as is a URL with any other scheme or with a control character in it.
 */
export function parseHttpUrl(uri: string): URL | undefined {
  const value = uri.trim()
  if (CONTROL_CHARACTERS.test(value)) return undefined

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }

  return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
}

/**
 * Throws for a plain `http:` URL on a non-loopback host, unless `allowInsecure`.
 *
 * The URL is parsed first and judged on its parsed `protocol` and `hostname`. It also
 * throws for a URL containing a tab, CR, LF or another C0 control character (the URL parser
 * would drop or strip them, so what is checked and what is sent could differ), for a URL
 * with a scheme other than `http:`/`https:`, and for an `http:`/`https:` URL that does not
 * parse. Only a string that does not parse as a URL at all (a libp2p peer id or multiaddr
 * for the node) is left to the caller.
 */
export function assertSecureTransport(
  url: string,
  what: string,
  allowInsecure = false
): void {
  const value = url.trim()

  if (CONTROL_CHARACTERS.test(value))
    throw new Error(
      `${what} contains a control character (tab, CR, LF or another C0 character): ${JSON.stringify(url)}`
    )

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    if (/^https?:/i.test(value))
      throw new Error(`${what} is not a valid URL: ${url}`)

    // A peer id or a multiaddr: not a URL, and not this rule's business.
    return
  }

  if (parsed.protocol === 'https:') return

  if (parsed.protocol !== 'http:')
    throw new Error(
      `${what} must be an https:// URL, but its scheme is ${parsed.protocol} (${url})`
    )

  if (allowInsecure || isLoopbackHost(parsed.hostname)) return

  throw new Error(
    `${what} uses plain http:// (${url}). nautilus sends the plaintext DDO pointer, signed DDOs or credentials there, so it requires https:// except for localhost, 127.0.0.0/8, ::1 and *.localhost. Pass allowInsecureTransport: true to accept the risk, e.g. on a private network.`
  )
}
