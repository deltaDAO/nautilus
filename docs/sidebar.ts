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
      text: 'Download',
      collapsed: true,
      items: [{ text: 'Overview', link: '/docs/guides/download' }]
    },
    {
      text: 'Publish',
      collapsed: true,
      items: [
        { text: 'Overview', link: '/docs/guides/publish' },
        { text: 'Configuration', link: '/docs/api/PublishConfig' },
        {
          text: 'Builders',
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
      text: 'The Nautilus API',
      collapsed: true,
      items: [
        {
          text: 'Static',
          items: [
            { text: 'create', link: '/docs/api/nautilus/create' },
            { text: 'setLogLevel', link: '/docs/api/nautilus/setLogLevel' }
          ]
        },
        {
          text: 'Instanced',
          items: [
            { text: 'access', link: '/docs/api/nautilus/access' },
            {
              text: 'compute',
              link: '/docs/api/nautilus/compute',
              items: [
                {
                  text: 'getComputeStatus',
                  link: '/docs/api/nautilus/getComputeStatus'
                },
                {
                  text: 'getComputeResult',
                  link: '/docs/api/nautilus/getComputeResult'
                },
                { text: 'stopCompute', link: '/docs/api/nautilus/stopCompute' }
              ]
            },
            {
              text: 'edit',
              link: '/docs/api/nautilus/edit',
              items: [
                {
                  text: 'setAssetLifecycleState',
                  link: '/docs/api/nautilus/setAssetLifecycleState'
                }
              ]
            },
            { text: 'publish', link: '/docs/api/nautilus/publish' },
            {
              text: 'Helpers',
              items: [
                {
                  text: 'getAquariusAsset',
                  link: '/docs/api/nautilus/getAquariusAsset'
                },
                {
                  text: 'getAquariusAssets',
                  link: '/docs/api/nautilus/getAquariusAsset'
                }
              ]
            }
          ]
        }
      ]
    },
    {
      text: 'Advanced',
      items: [{ text: 'Custom configuration', link: '/docs/guides/config' }]
    }
  ]
} as const satisfies Sidebar
