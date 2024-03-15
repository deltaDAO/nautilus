import * as React from 'react'
import { defineConfig } from 'vocs'
import pkg from '../package.json'
import { sidebar } from './sidebar'

export default defineConfig({
  baseUrl: 'https://nautilus.io',
  title: 'Nautilus',
  titleTemplate: '%s · Nautilus',
  description:
    'Navigate the data economy - a toolkit to intereact with OceanProtocol ecosystems.',
  head: (
    <>
      <script
        src="https://cdn.usefathom.com/script.js"
        data-site="BYCJMNBD"
        defer
      />
    </>
  ),
  // ogImageUrl: {
  //   '/': '/og-image.png',
  //   '/docs':
  //     'https://vocs.dev/api/og?logo=%logo&title=%title&description=%description',
  //   '/op-stack':
  //     'https://vocs.dev/api/og?logo=%logo&title=%title&description=%description',
  // },
  iconUrl: { light: '/favicons/light.png', dark: '/favicons/dark.png' },
  logoUrl: { light: '/icon-light.png', dark: '/icon-dark.png' },
  rootDir: '.',
  sidebar,
  socials: [
    {
      icon: 'github',
      link: 'https://github.com/deltaDAO/nautilus',
    }
  ],
  sponsors: [],
  theme: {
    accentColor: {
      light: '#ff9318',
      dark: '#ffc517',
    },
  },
  topNav: [
    { text: 'Docs', link: '/docs/getting-started', match: '/docs' },
    {
      text: 'Examples',
      link: 'https://github.com/deltaDAO/nautilus-examples',
    },
    {
      text: pkg.version,
      items: [
        {
          text: `Migrating to ${toPatchVersionRange(pkg.version)}`,
          link: `/docs/migration-guide#_${toPatchVersionRange(
            pkg.version,
          ).replace(/\./g, '-')}-breaking-changes`,
        },
        {
          text: 'Changelog',
          link: 'https://github.com/deltaDAO/nautilus/blob/main/src/CHANGELOG.md',
        },
        // {
        //   text: 'Contributing',
        //   link: 'https://github.com/deltaDAO/nautilus/blob/main/.github/CONTRIBUTING.md',
        // },
      ],
    },
  ],
})

function toPatchVersionRange(version: string) {
  const [major, minor] = version.split('.').slice(0, 2)
  return `${major}.${minor}.x`
}