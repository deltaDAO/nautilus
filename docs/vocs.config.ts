import { defineConfig } from 'vocs/config'
import pkg from '../src/package.json' with { type: 'json' }
import { sidebar } from './sidebar.js'

/**
 * Vocs bakes `baseUrl` into the client chunk URLs, so a deployment served from any other
 * origin fetches its JS from this one and never hydrates. Vercel preview deployments get
 * their own `*.vercel.app` domain, hence the override — production and local builds keep
 * using the canonical domain.
 */
const baseUrl =
  process.env.VERCEL_URL && process.env.VERCEL_ENV !== 'production'
    ? `https://${process.env.VERCEL_URL}`
    : 'https://nautilus.delta-dao.com'

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
  iconUrl: { light: '/favicons/light.png', dark: '/favicons/dark.png' },
  logoUrl: { light: '/icon-light.png', dark: '/icon-dark.png' },
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
  accentColor: 'light-dark(#007599, #00caff)',
  topNav: [
    { text: 'Docs', link: '/docs/getting-started', match: '/docs' },
    {
      text: 'Examples',
      link: 'https://github.com/deltaDAO/nautilus-examples'
    },
    {
      text: pkg.version,
      items: [
        { text: 'Migrating from v1', link: '/docs/migration' },
        {
          text: 'Changelog',
          link: 'https://github.com/deltaDAO/nautilus/blob/main/src/CHANGELOG.md'
        }
        // {
        //   text: 'Contributing',
        //   link: 'https://github.com/deltaDAO/nautilus/blob/main/.github/CONTRIBUTING.md',
        // },
      ]
    }
  ]
})
