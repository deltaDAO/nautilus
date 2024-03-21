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
      items: [
        { text: 'Migration Guide', link: '/docs/migration-guide' },
        { text: 'TypeScript', link: '/docs/typescript' },
        { text: 'Publishing', link: '/docs/guides/publish' },
        { text: 'Downloads', link: '/docs/guides/download' },
        { text: 'Compute to Data', link: '/docs/guides/compute' }
      ]
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
