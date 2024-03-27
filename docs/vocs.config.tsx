import * as React from 'react'
import { defineConfig } from 'vocs'
import pkg from '../src/package.json'
import { sidebar } from './sidebar'

// biome-ignore lint/correctness/noUnusedVariables: <explanation>
function toPatchVersionRange(version: string) {
  const [major, minor] = version.split('.').slice(0, 2)
  return `${major}.${minor}.x`
}

export default defineConfig({
  baseUrl: 'https://nautilus.delta-dao.com',
  title: 'Nautilus',
  titleTemplate: '%s · Nautilus',
  description:
    'Navigate the data economy - a toolkit to intereact with OceanProtocol ecosystems.',
  head: (
    <>
      {/* <script
        src="https://cdn.usefathom.com/script.js"
        defer
      /> */}
      <script src="https://buttons.github.io/buttons.js" async defer />
    </>
  ),
  ogImageUrl: {
    '/': '/og-image.png',
    '/docs':
      'https://vocs.dev/api/og?logo=%logo&title=%title&description=%description',
    '/op-stack':
      'https://vocs.dev/api/og?logo=%logo&title=%title&description=%description'
  },
  iconUrl: { light: '/favicons/light.png', dark: '/favicons/dark.png' },
  logoUrl: { light: '/icon-light.png', dark: '/icon-dark.png' },
  rootDir: '.',
  sidebar,
  socials: [
    {
      icon: 'github',
      link: 'https://github.com/deltaDAO/nautilus'
    }
  ],
  sponsors: [
    {
      name: 'Enterprises',
      height: 80,
      items: [
        [
          {
            name: 'OceanProtocol',
            link: 'https://oceanprotocol.com',
            image:
              'https://oceanprotocol.com/static/ae84296f3b9ccb7054530d3af623f1fa/logo.svg'
          },
          {
            name: 'Oasis Network',
            link: 'https://oasisprotocol.org/',
            image:
              'https://assets-global.website-files.com/63617eb68a66008a1a2130a0/639b268fde36b82f6ca20500_Network%20Logo.svg'
          }
        ]
      ]
    }
  ],
  theme: {
    accentColor: {
      light: '#007599',
      dark: '#00caff'
    }
  },
  topNav: [
    { text: 'Docs', link: '/docs/getting-started', match: '/docs' },
    {
      text: 'Examples',
      link: 'https://github.com/deltaDAO/nautilus-examples'
    },
    {
      text: pkg.version,
      items: [
        // {
        //   text: `Migrating to ${toPatchVersionRange(pkg.version)}`,
        //   link: `/docs/migration-guide#_${toPatchVersionRange(
        //     pkg.version
        //   ).replace(/\./g, '-')}-breaking-changes`
        // },
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
