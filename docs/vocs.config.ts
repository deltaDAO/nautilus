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
    'The TypeScript toolkit for the data economy: publish, sell and compute on data across Ocean Enterprise ecosystems.',
  // A static, self-hosted social card (docs/public/og-image.png, 1200x630). Crawlers
  // need an absolute URL, so production prefixes the canonical origin; previews have
  // no `baseUrl` and fall back to the relative path.
  ogImageUrl: (_path, { baseUrl }) => `${baseUrl ?? ''}/og-image.png`,
  // `:path` is the page's path relative to the pages directory.
  editLink: {
    link: 'https://github.com/deltaDAO/nautilus/edit/main/docs/pages/:path',
    text: 'Suggest changes to this page'
  },
  // Hanken Grotesk is self-hosted (see pages/_root.css); preload the latin
  // subset every page renders with so text does not reflow on load.
  head: (_path, { frontmatter }) => {
    // Share cards use the bare page title by default ("Download"); brand it like
    // the <title> so links read "Download · Nautilus" when shared.
    const title = frontmatter?.title
    const shareTitle =
      title && !title.includes('Nautilus') ? `${title} · Nautilus` : undefined
    return {
      link: [
        {
          rel: 'preload',
          href: '/fonts/hanken-grotesk/hanken-grotesk-latin-wght-normal.woff2',
          as: 'font',
          type: 'font/woff2',
          crossorigin: 'anonymous'
        },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
      ],
      meta: {
        ...(shareTitle && { ogTitle: shareTitle, twitterTitle: shareTitle }),
        themeColor: '#0b1322',
        ogLocale: 'en_US',
        ogImageType: 'image/png',
        ogImageWidth: 1200,
        ogImageHeight: 630,
        ogImageAlt: 'Nautilus: the TypeScript toolkit for the data economy',
        twitterImageAlt: 'Nautilus: the TypeScript toolkit for the data economy'
      }
    }
  },
  // One SVG that switches colour with the OS theme (see the file's media query).
  iconUrl: '/favicon.svg',
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
