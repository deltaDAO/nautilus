/**
 * Checks on an openid4vp request before a wallet follows it. The request comes from the
 * node, and for a download that is the node in the service's `serviceEndpoint`, which the
 * publisher chose, so none of it is trusted.
 */

import { isLoopbackHost } from '../utils/transport.js'
import { CredentialPresentationError } from './WaltIdProvider.js'

/** The openid4vp parameters whose URL the wallet fetches from, or posts the presentation to. */
const PRESENTATION_URI_PARAMS = [
  'request_uri',
  'response_uri',
  'presentation_definition_uri'
]

/** Cloud metadata services, by host name and by address. */
export const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.azure.internal',
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254'
])

/**
 * Refuses a presentation request the wallet must not follow: anything but an
 * `openid4vp://` URL, and a `request_uri`, `response_uri` or `presentation_definition_uri`
 * that is not `https://` (or `http://` on a loopback host, or anywhere with
 * `allowInsecure`), or that points at a link-local or cloud metadata address. The wallet
 * fetches the first and the last, and posts the presentation to the second.
 */
export function assertPresentationRequest(
  redirectUri: string,
  allowInsecure = false
): void {
  let request: URL
  try {
    request = new URL(redirectUri)
  } catch {
    throw new CredentialPresentationError(
      'The presentation request is not a URL.',
      undefined,
      'request-invalid'
    )
  }

  if (request.protocol !== 'openid4vp:')
    throw new CredentialPresentationError(
      `The presentation request must be an openid4vp:// URL, not ${request.protocol}`,
      undefined,
      'request-invalid'
    )

  for (const param of PRESENTATION_URI_PARAMS) {
    const value = request.searchParams.get(param)
    if (value === null) continue

    const problem = presentationUrlProblem(value, param, allowInsecure)
    if (problem)
      throw new CredentialPresentationError(
        problem,
        undefined,
        'request-invalid'
      )
  }
}

/** Checks one URL carried by the request or resolved by the wallet. */
export function presentationUrlProblem(
  value: string,
  param: string,
  allowInsecure: boolean
): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return `The presentation request's ${param} is not a URL.`
  }

  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

  const allowedScheme =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && (allowInsecure || isLoopbackHost(host)))

  if (!allowedScheme)
    return `The presentation request's ${param} must be https:// (http:// only on a loopback host, or with allowInsecureTransport), not ${url.protocol}//${host}.`

  if (METADATA_HOSTS.has(host) || isLinkLocal(host))
    return `The presentation request's ${param} points at a link-local or metadata address (${host}).`

  return undefined
}

/** `169.254.0.0/16` and `fe80::/10`. */
export function isLinkLocal(host: string): boolean {
  return (
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
  )
}
