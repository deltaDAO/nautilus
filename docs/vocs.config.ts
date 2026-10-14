import { defineConfig } from 'vocs/config'
import pkg from '../src/package.json' with { type: 'json' }
import { sidebar } from './sidebar.js'
import { archivedVersions } from './versions.js'

/**
 * `baseUrl` becomes a `<base href>` on every page, so every relative request the client
 * router makes — including the RSC payload it fetches for a link click — resolves against
 * that origin rather than the one serving the page. An absolute value therefore only works
 * on the single host it names.
 *
 * That is not enough for a preview: Vercel serves each deployment under both its unique
 * `VERCEL_URL` and a branch alias, so pinning either one breaks navigation on the other,
 * and `vocs preview` locally breaks on both. Pinning `VERCEL_URL` was the previous attempt
 * and still failed for exactly this reason.
 *
 * So only production — which really is served from the canonical domain — gets an absolute
 * base. Everywhere else it is omitted, no `<base>` is emitted, and every request resolves
 * same-origin on whatever host is serving. The only casualty is sitemap/robots generation,
 * which previews should not have anyway.
 */
const baseUrl =
  process.env.VERCEL_ENV === 'production'
    ? 'https://nautilus.delta-dao.com'
    : undefined

export default defineConfig({
  baseUrl,
  title: 'Nautilus',
  titleTemplate: '%s · Nautilus',
  description:
    'Navigate the data economy — a toolkit to interact with OceanProtocol ecosystems.',
  // No `ogImageUrl`: the previous value called out to vocs.dev's OG service, and the
  // home page pointed at a `/og-image.png` that was never added to `public/`. Nothing
  // here should depend on a third-party host. To restore social previews, drop a
  // 1200x630 image into `docs/public/` and set `ogImageUrl: '/og-image.png'`.
  // `:path` is the page's path relative to the pages directory.
  editLink: {
    link: 'https://github.com/deltaDAO/nautilus/edit/main/docs/pages/:path',
    text: 'Suggest changes to this page'
  },
  // Hanken Grotesk is self-hosted (see pages/_root.css); preload the latin
  // subset every page renders with so text does not reflow on load.
  head: {
    link: [
      {
        rel: 'preload',
        href: '/fonts/hanken-grotesk/hanken-grotesk-latin-wght-normal.woff2',
        as: 'font',
        type: 'font/woff2',
        crossorigin: 'anonymous'
      }
    ]
  },
  iconUrl: { light: '/favicons/light.png', dark: '/favicons/dark.png' },
  logoUrl: { light: '/icon-light.svg', dark: '/icon-dark.svg' },
  // Pages live in `docs/pages`, not the v2 default of `docs/src/pages`.
  srcDir: '.',
  renderStrategy: 'full-static',
  sidebar,
  socials: [
    {
      icon: 'github',
      link: 'https://github.com/deltaDAO/nautilus'
    }
  ],
  colorScheme: 'light dark',
  // deck-blue on light, brand cyan on the navy dark theme
  accentColor: 'light-dark(#2450ec, #00b8e4)',
  topNav: [
    { text: 'Docs', link: '/docs/getting-started', match: '/docs' },
    { text: 'Examples', link: '/docs/examples' },
    {
      text: pkg.version,
      items: [
        { text: 'Migrating from v1', link: '/docs/migration' },
        {
          text: 'Changelog',
          link: 'https://github.com/deltaDAO/nautilus/blob/main/src/CHANGELOG.md'
        },
        ...archivedVersions.map((v) => ({
          text: `${v.label} (legacy)`,
          link: v.link,
          match: v.match
        }))
        // {
        //   text: 'Contributing',
        //   link: 'https://github.com/deltaDAO/nautilus/blob/main/.github/CONTRIBUTING.md',
        // },
      ]
    }
  ]
})
