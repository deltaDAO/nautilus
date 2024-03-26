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
      text: 'Builder APIs',
      collapsed: true,
      items: [
        {
          text: 'Global',
          items: [
            { text: 'build', link: '/docs/api/assetbuilder/build' },
            { text: 'reset', link: '/docs/api/assetbuilder/reset' }
          ]
        },
        {
          text: 'AssetBuilder',
          items: [
            {
              text: 'addAdditionalInformation',
              link: '/docs/api/assetbuilder/addAdditionalInformation'
            },
            {
              text: 'addCategories',
              link: '/docs/api/assetbuilder/addCategories'
            },
            { text: 'addLinks', link: '/docs/api/assetbuilder/addLinks' },
            { text: 'addService', link: '/docs/api/assetbuilder/addService' },
            {
              text: 'setAlgorithm',
              link: '/docs/api/assetbuilder/setAlgorithm'
            },
            { text: 'setAuthor', link: '/docs/api/assetbuilder/setAuthor' },
            // {
            //   text: 'setContentLanguage',
            //   link: '/docs/api/assetbuilder/setContentLanguage'
            // },
            // {
            //   text: 'setCopyrightHolder',
            //   link: '/docs/api/assetbuilder/setCopyrightHolder'
            // },
            {
              text: 'setDescription',
              link: '/docs/api/assetbuilder/setDescription'
            },
            { text: 'setLicense', link: '/docs/api/assetbuilder/setLicense' },
            { text: 'setName', link: '/docs/api/assetbuilder/setName' },
            { text: 'setType', link: '/docs/api/assetbuilder/setType' }
          ]
        },
        {
          text: 'ServiceBuilder',
          items: []
        }
      ]
    },
    {
      text: 'Advanced',
      items: [{ text: 'Custom configuration', link: '/docs/guides/config' }]
    }
  ]
} as const satisfies Sidebar
