import type { Sidebar } from 'vocs'

export const sidebar = {
  '/docs/': [
    {
      text: 'Introduction',
      items: [
        { text: 'Why Nautilus', link: '/docs/introduction' },
        { text: 'Getting Started', link: '/docs/getting-started' },
        { text: 'FAQ', link: '/docs/faq' }
      ]
    },
    {
      text: 'Guides',
      items: [{ text: 'Custom configuration', link: '/docs/guides/config' }]
    },
    {
      text: 'Publish',
      collapsed: true,
      items: [{ text: 'Overview', link: '/docs/guides/publish' }]
    },
    {
      text: 'Edit',
      collapsed: true,
      items: [{ text: 'Overview', link: '/docs/guides/edit' }]
    },
    {
      text: 'Compute',
      collapsed: true,
      items: [{ text: 'Overview', link: '/docs/guides/compute' }]
    },
    {
      text: 'Download',
      collapsed: true,
      items: [{ text: 'Overview', link: '/docs/guides/download' }]
    },
    {
      text: 'API',
      collapsed: true,
      items: [
        { text: 'Overview', link: '/docs/api/overview' },
        {
          text: 'Builders',
          collapsed: true,
          items: [
            { text: 'AssetBuilder', link: '/docs/api/AssetBuilder' },
            { text: 'ServiceBuilder', link: '/docs/api/ServiceBuilder' },
            {
              text: 'ConsumerParameterBuilder',
              link: '/docs/api/ConsumerParameterBuilder'
            }
          ]
        }
      ]
    }
  ]
} as const satisfies Sidebar
