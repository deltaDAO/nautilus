import type { Config } from 'vocs/config'

type SidebarItems = Extract<NonNullable<Config['sidebar']>, readonly unknown[]>

// Snapshot of the v1 docs sidebar (origin/main docs/sidebar.ts), links
// prefixed with /v1. Wired as the '/v1/' key in ./sidebar.ts.
export const sidebarV1Items = [
  {
    text: 'Introduction',
    items: [
      { text: 'Why Nautilus', link: '/v1/docs/introduction' },
      { text: 'Getting Started', link: '/v1/docs/getting-started' }
      // { text: 'FAQ', link: '/v1/docs/faq' }
    ]
  },
  {
    text: 'Download',
    collapsed: true,
    items: [{ text: 'Overview', link: '/v1/docs/guides/download' }]
  },
  {
    text: 'Compute',
    collapsed: true,
    items: [{ text: 'Overview', link: '/v1/docs/guides/compute' }]
  },
  {
    text: 'Publish',
    collapsed: true,
    items: [
      { text: 'Overview', link: '/v1/docs/guides/publish' },
      {
        text: 'Builders',
        items: [
          { text: 'AssetBuilder', link: '/v1/docs/api/AssetBuilder' },
          { text: 'ServiceBuilder', link: '/v1/docs/api/ServiceBuilder' },
          {
            text: 'ConsumerParameterBuilder',
            link: '/v1/docs/api/ConsumerParameterBuilder'
          }
        ]
      }
    ]
  },
  {
    text: 'Edit',
    collapsed: true,
    items: [
      { text: 'Overview', link: '/v1/docs/guides/edit' },
      {
        text: 'Builders',
        items: [
          { text: 'AssetBuilder', link: '/v1/docs/api/AssetBuilder' },
          { text: 'ServiceBuilder', link: '/v1/docs/api/ServiceBuilder' },
          {
            text: 'ConsumerParameterBuilder',
            link: '/v1/docs/api/ConsumerParameterBuilder'
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
          { text: 'create', link: '/v1/docs/api/nautilus/create' },
          { text: 'setLogLevel', link: '/v1/docs/api/nautilus/setLogLevel' }
        ]
      },
      {
        text: 'Instanced',
        items: [
          { text: 'access', link: '/v1/docs/api/nautilus/access' },
          {
            text: 'compute',
            link: '/v1/docs/api/nautilus/compute',
            items: [
              {
                text: 'getComputeStatus',
                link: '/v1/docs/api/nautilus/getComputeStatus'
              },
              {
                text: 'getComputeResult',
                link: '/v1/docs/api/nautilus/getComputeResult'
              },
              { text: 'stopCompute', link: '/v1/docs/api/nautilus/stopCompute' }
            ]
          },
          {
            text: 'edit',
            link: '/v1/docs/api/nautilus/edit',
            items: [
              {
                text: 'setServicePrice',
                link: '/v1/docs/api/nautilus/setServicePrice'
              },
              {
                text: 'setAssetLifecycleState',
                link: '/v1/docs/api/nautilus/setAssetLifecycleState'
              }
            ]
          },
          { text: 'publish', link: '/v1/docs/api/nautilus/publish' }
          // {
          //   text: 'Helpers',
          //   items: [
          //     {
          //       text: 'getAquariusAsset',
          //       link: '/v1/docs/api/nautilus/getAquariusAsset'
          //     },
          //     {
          //       text: 'getAquariusAssets',
          //       link: '/v1/docs/api/nautilus/getAquariusAsset'
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
          { text: 'build', link: '/v1/docs/api/assetbuilder/build' },
          { text: 'reset', link: '/v1/docs/api/assetbuilder/reset' }
        ]
      },
      {
        text: 'AssetBuilder',
        link: '/v1/docs/api/AssetBuilder',
        items: [
          {
            text: 'addAdditionalInformation',
            link: '/v1/docs/api/assetbuilder/addAdditionalInformation'
          },
          {
            text: 'addCategories',
            link: '/v1/docs/api/assetbuilder/addCategories'
          },
          {
            text: 'addCredentialAddresses',
            link: '/v1/docs/api/assetbuilder/addCredentialAddresses'
          },
          { text: 'addLinks', link: '/v1/docs/api/assetbuilder/addLinks' },
          { text: 'addService', link: '/v1/docs/api/assetbuilder/addService' },
          {
            text: 'removeCredentialAddresses',
            link: '/v1/docs/api/assetbuilder/removeCredentialAddresses'
          },
          {
            text: 'setAlgorithm',
            link: '/v1/docs/api/assetbuilder/setAlgorithm'
          },
          { text: 'setAuthor', link: '/v1/docs/api/assetbuilder/setAuthor' },
          // {
          //   text: 'setContentLanguage',
          //   link: '/v1/docs/api/assetbuilder/setContentLanguage'
          // },
          // {
          //   text: 'setCopyrightHolder',
          //   link: '/v1/docs/api/assetbuilder/setCopyrightHolder'
          // },
          {
            text: 'setDescription',
            link: '/v1/docs/api/assetbuilder/setDescription'
          },
          { text: 'setLicense', link: '/v1/docs/api/assetbuilder/setLicense' },
          { text: 'setName', link: '/v1/docs/api/assetbuilder/setName' },
          { text: 'setNftTokenName', link: '/v1/docs/api/assetbuilder/setNftTokenName' },
          { text: 'setNftTokenSymbol', link: '/v1/docs/api/assetbuilder/setNftTokenSymbol' },
          { text: 'setNftTokenTemplate', link: '/v1/docs/api/assetbuilder/setNftTokenTemplate' },
          { text: 'setNftTokenTransferable', link: '/v1/docs/api/assetbuilder/setNftTokenTransferable' },
          { text: 'setNftTokenUri', link: '/v1/docs/api/assetbuilder/setNftTokenUri' },
          { text: 'setType', link: '/v1/docs/api/assetbuilder/setType' }
        ]
      },
      {
        text: 'ServiceBuilder',
        link: '/v1/docs/api/ServiceBuilder',
        items: []
      }
    ]
  },
  {
    text: 'Advanced',
    items: [{ text: 'Custom configuration', link: '/v1/docs/guides/config' }]
  },
  {
    text: 'Legal',
    items: [
      { text: 'Privacy', link: 'https://docs.pontus-x.eu/privacy' },
      { text: 'Imprint', link: 'https://delta-dao.com/imprint' }
    ]
  }
] as const satisfies SidebarItems
