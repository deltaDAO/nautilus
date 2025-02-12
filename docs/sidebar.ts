import type { Sidebar } from 'vocs'

export const sidebar = {
  '/docs/': [
    {
      text: 'Introduction',
      items: [
        { text: 'Why Nautilus', link: '/docs/introduction' },
        { text: 'Getting Started', link: '/docs/getting-started' }
        // { text: 'FAQ', link: '/docs/faq' }
      ]
    },
    {
      text: 'Download',
      collapsed: true,
      items: [{ text: 'Overview', link: '/docs/guides/download' }]
    },
    {
      text: 'Compute',
      collapsed: true,
      items: [{ text: 'Overview', link: '/docs/guides/compute' }]
    },
    {
      text: 'Publish',
      collapsed: true,
      items: [
        { text: 'Overview', link: '/docs/guides/publish' },
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
      items: [
        { text: 'Overview', link: '/docs/guides/edit' },
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
                  text: 'setServicePrice',
                  link: '/docs/api/nautilus/setServicePrice'
                },
                {
                  text: 'setAssetLifecycleState',
                  link: '/docs/api/nautilus/setAssetLifecycleState'
                }
              ]
            },
            { text: 'publish', link: '/docs/api/nautilus/publish' }
            // {
            //   text: 'Helpers',
            //   items: [
            //     {
            //       text: 'getAquariusAsset',
            //       link: '/docs/api/nautilus/getAquariusAsset'
            //     },
            //     {
            //       text: 'getAquariusAssets',
            //       link: '/docs/api/nautilus/getAquariusAsset'
            //     }
            //   ]
            // }
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
          link: '/docs/api/AssetBuilder',
          items: [
            {
              text: 'addAdditionalInformation',
              link: '/docs/api/assetbuilder/addAdditionalInformation'
            },
            {
              text: 'addCategories',
              link: '/docs/api/assetbuilder/addCategories'
            },
            {
              text: 'addCredentialAddresses',
              link: '/docs/api/assetbuilder/addCredentialAddresses'
            },
            { text: 'addLinks', link: '/docs/api/assetbuilder/addLinks' },
            { text: 'addService', link: '/docs/api/assetbuilder/addService' },
            {
              text: 'removeCredentialAddresses',
              link: '/docs/api/assetbuilder/removeCredentialAddresses'
            },
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
            { text: 'setNftTokenName', link: '/docs/api/assetbuilder/setNftTokenName' },
            { text: 'setNftTokenSymbol', link: '/docs/api/assetbuilder/setNftTokenSymbol' },
            { text: 'setNftTokenTemplate', link: '/docs/api/assetbuilder/setNftTokenTemplate' },
            { text: 'setNftTokenTransferable', link: '/docs/api/assetbuilder/setNftTokenTransferable' },
            { text: 'setNftTokenUri', link: '/docs/api/assetbuilder/setNftTokenUri' },
            { text: 'setType', link: '/docs/api/assetbuilder/setType' }
          ]
        },
        {
          text: 'ServiceBuilder',
          link: '/docs/api/ServiceBuilder',
          items: []
        }
      ]
    },
    {
      text: 'Advanced',
      items: [{ text: 'Custom configuration', link: '/docs/guides/config' }]
    },
    {
      text: 'Legal',
      items: [
        { text: 'Privacy', link: 'https://docs.pontus-x.eu/privacy' },
        { text: 'Imprint', link: 'https://delta-dao.com/imprint' }
      ]
    }
  ]
} as const satisfies Sidebar
