/**
 * Registry of archived documentation versions, rendered into the topNav
 * version dropdown (see vocs.config.ts).
 *
 * Archiving a major (e.g. v2 when v3 lands):
 *   1. git archive <last-v2-ref> docs/pages/docs | tar -x --strip-components=2 -C docs/pages/v2
 *   2. node docs/scripts/archive-transform.mjs docs/pages/v2/docs /docs /v2/docs v2.x.y
 *   3. Copy the then-current '/docs/' sidebar items into docs/sidebar-v2.ts,
 *      prefix all links with /v2, and add a '/v2/' key in docs/sidebar.ts.
 *   4. Add an entry below.
 */
export interface ArchivedVersion {
  /** Exact last release of the archived major — hardcoded, never derived from pkg.version. */
  label: string
  /** Entry page of the archived docs. */
  link: string
  /** Path prefix for topNav active-state matching. */
  match: string
}

export const archivedVersions: ArchivedVersion[] = [
  { label: 'v1.1.0', link: '/v1/docs/introduction', match: '/v1' }
]
