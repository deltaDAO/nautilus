import type { Sidebar } from 'vocs'

export const sidebar = {
  '/docs/': [
    {
      text: 'Introduction',
      items: [
        { text: 'Why Nautilus', link: '/docs/introduction' },
        { text: 'Getting Started', link: '/docs/getting-started' },
        { text: 'FAQ', link: '/docs/faq' },
      ],
    },
    {
      text: 'Guides',
      items: [
        { text: 'Migration Guide', link: '/docs/migration-guide' },
        { text: 'TypeScript', link: '/docs/typescript' },
        { text: 'Publishing', link: '/docs/guides/publish' },
        { text: 'Consumption', link: '/docs/guides/consume' },
      ],
    },
    ],
} as const satisfies Sidebar