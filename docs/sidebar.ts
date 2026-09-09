import type { Config } from 'vocs/config'
import { sidebarV1Items } from './sidebar-v1.js'

export const sidebar = {
  '/v1/': { backLink: true, items: sidebarV1Items },
  '/docs/': [
    {
      text: 'Introduction',
      items: [
        { text: 'Why Nautilus', link: '/docs/introduction' },
        { text: 'Getting Started', link: '/docs/getting-started' },
        { text: 'Examples', link: '/docs/examples' },
        { text: 'TypeScript', link: '/docs/typescript' },
        { text: 'FAQ', link: '/docs/faq' },
        {
          text: 'Migrating from v1',
          link: '/docs/migration',
          badge: { text: 'v2', variant: 'success' }
        }
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
      text: 'Working with assets',
      collapsed: true,
      items: [
        { text: 'Reading assets', link: '/docs/guides/reading-assets' },
        { text: 'Validation', link: '/docs/guides/validation' },
        { text: 'Pricing', link: '/docs/guides/pricing' },
        {
          text: 'DDO helpers',
          items: [
            { text: 'validate', link: '/docs/api/ddo/validate' },
            { text: 'assertValid', link: '/docs/api/ddo/assertValid' },
            { text: 'getMetadata', link: '/docs/api/ddo/getMetadata' },
            { text: 'getServices', link: '/docs/api/ddo/getServices' },
            { text: 'getService', link: '/docs/api/ddo/getService' },
            {
              text: 'getServiceByType',
              link: '/docs/api/ddo/getServiceByType'
            },
            { text: 'getOwner', link: '/docs/api/ddo/getOwner' },
            {
              text: 'getLifecycleState',
              link: '/docs/api/ddo/getLifecycleState'
            },
            {
              text: 'getDatatokenForService',
              link: '/docs/api/ddo/getDatatokenForService'
            },
            {
              text: 'getStatsForService',
              link: '/docs/api/ddo/getStatsForService'
            }
          ]
        },
        {
          text: 'Pricing API',
          items: [
            {
              text: 'getPricingInfo',
              link: '/docs/api/pricing/getPricingInfo'
            },
            { text: 'getOrderPrice', link: '/docs/api/pricing/getOrderPrice' },
            { text: 'PricingInfo', link: '/docs/api/pricing/PricingInfo' },
            { text: 'OrderPrice', link: '/docs/api/pricing/OrderPrice' }
          ]
        }
      ]
    },
    {
      text: 'The Nautilus API',
      collapsed: true,
      items: [
        { text: 'Overview', link: '/docs/api/Nautilus' },
        {
          text: 'Static',
          items: [
            { text: 'create', link: '/docs/api/nautilus/create' },
            { text: 'setLogLevel', link: '/docs/api/nautilus/setLogLevel' }
          ]
        },
        {
          text: 'Accessors',
          items: [
            {
              text: 'getOceanConfig',
              link: '/docs/api/nautilus/getOceanConfig'
            },
            {
              text: 'getNodeClient',
              link: '/docs/api/nautilus/getNodeClient'
            },
            { text: 'getSigner', link: '/docs/api/nautilus/getSigner' },
            {
              text: 'setCredentialProvider',
              link: '/docs/api/nautilus/setCredentialProvider'
            }
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
                { text: 'freeCompute', link: '/docs/api/nautilus/freeCompute' },
                {
                  text: 'getComputeEnvironments',
                  link: '/docs/api/nautilus/getComputeEnvironments'
                },
                {
                  text: 'getComputeEnvironment',
                  link: '/docs/api/nautilus/getComputeEnvironment'
                },
                {
                  text: 'getComputeStatus',
                  link: '/docs/api/nautilus/getComputeStatus'
                },
                {
                  text: 'getComputeResult',
                  link: '/docs/api/nautilus/getComputeResult'
                },
                {
                  text: 'streamComputeResult',
                  link: '/docs/api/nautilus/streamComputeResult'
                },
                {
                  text: 'getComputeLogs',
                  link: '/docs/api/nautilus/getComputeLogs'
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
            { text: 'publish', link: '/docs/api/nautilus/publish' },
            {
              text: 'Metadata',
              items: [
                { text: 'getAsset', link: '/docs/api/nautilus/getAsset' },
                { text: 'getAssets', link: '/docs/api/nautilus/getAssets' },
                { text: 'query', link: '/docs/api/nautilus/query' },
                {
                  text: 'waitForIndexer',
                  link: '/docs/api/nautilus/waitForIndexer'
                }
              ]
            }
          ]
        }
      ]
    },
    {
      text: 'Types',
      collapsed: true,
      items: [
        { text: 'PublishResponse', link: '/docs/api/PublishResponse' },
        { text: 'ComputeAssetRef', link: '/docs/api/ComputeAsset' },
        { text: 'ComputeAlgorithmRef', link: '/docs/api/ComputeAlgorithm' },
        {
          text: 'UserCustomParameters',
          link: '/docs/api/UserCustomParameters'
        }
      ]
    },
    {
      text: 'Builder APIs',
      collapsed: true,
      items: [
        {
          text: 'AssetBuilder · core',
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
              text: 'addAttachments',
              link: '/docs/api/assetbuilder/addAttachments'
            },
            {
              text: 'addCategories',
              link: '/docs/api/assetbuilder/addCategories'
            },
            {
              text: 'addCredentialAccessList',
              link: '/docs/api/assetbuilder/addCredentialAccessList'
            },
            {
              text: 'addCredentialAddresses',
              link: '/docs/api/assetbuilder/addCredentialAddresses'
            },
            { text: 'addLinks', link: '/docs/api/assetbuilder/addLinks' },
            {
              text: 'addRequestCredentials',
              link: '/docs/api/assetbuilder/addRequestCredentials'
            },
            { text: 'addService', link: '/docs/api/assetbuilder/addService' },
            { text: 'addTags', link: '/docs/api/assetbuilder/addTags' },
            {
              text: 'removeCredentialAddresses',
              link: '/docs/api/assetbuilder/removeCredentialAddresses'
            },
            {
              text: 'removeService',
              link: '/docs/api/assetbuilder/removeService'
            },
            {
              text: 'setAlgorithm',
              link: '/docs/api/assetbuilder/setAlgorithm'
            },
            { text: 'setAuthor', link: '/docs/api/assetbuilder/setAuthor' },
            {
              text: 'setContentLanguage',
              link: '/docs/api/assetbuilder/setContentLanguage'
            },
            {
              text: 'setCopyrightHolder',
              link: '/docs/api/assetbuilder/setCopyrightHolder'
            },
            {
              text: 'setCredentialMatchRules',
              link: '/docs/api/assetbuilder/setCredentialMatchRules'
            },
            {
              text: 'setDescription',
              link: '/docs/api/assetbuilder/setDescription'
            },
            {
              text: 'setDisplayTitle',
              link: '/docs/api/assetbuilder/setDisplayTitle'
            },
            { text: 'setIssuer', link: '/docs/api/assetbuilder/setIssuer' },
            { text: 'setLicense', link: '/docs/api/assetbuilder/setLicense' },
            {
              text: 'setLifecycleState',
              link: '/docs/api/assetbuilder/setLifecycleState'
            },
            { text: 'setName', link: '/docs/api/assetbuilder/setName' },
            { text: 'setNftData', link: '/docs/api/assetbuilder/setNftData' },
            {
              text: 'setNftTokenName',
              link: '/docs/api/assetbuilder/setNftTokenName'
            },
            {
              text: 'setNftTokenSymbol',
              link: '/docs/api/assetbuilder/setNftTokenSymbol'
            },
            {
              text: 'setNftTokenTemplate',
              link: '/docs/api/assetbuilder/setNftTokenTemplate'
            },
            {
              text: 'setNftTokenTransferable',
              link: '/docs/api/assetbuilder/setNftTokenTransferable'
            },
            {
              text: 'setNftTokenUri',
              link: '/docs/api/assetbuilder/setNftTokenUri'
            },
            { text: 'setOwner', link: '/docs/api/assetbuilder/setOwner' },
            {
              text: 'setProvidedBy',
              link: '/docs/api/assetbuilder/setProvidedBy'
            },
            { text: 'setType', link: '/docs/api/assetbuilder/setType' },
            {
              text: 'setVcPolicies',
              link: '/docs/api/assetbuilder/setVcPolicies'
            },
            {
              text: 'setVpPolicies',
              link: '/docs/api/assetbuilder/setVpPolicies'
            }
          ]
        },
        {
          text: 'ServiceBuilder',
          link: '/docs/api/ServiceBuilder',
          items: [
            {
              text: 'addAdditionalInformation',
              link: '/docs/api/servicebuilder/addAdditionalInformation'
            },
            {
              text: 'addConsumerParameter',
              link: '/docs/api/servicebuilder/addConsumerParameter'
            },
            {
              text: 'addCredentialAddresses',
              link: '/docs/api/servicebuilder/addCredentialAddresses'
            },
            { text: 'addFile', link: '/docs/api/servicebuilder/addFile' },
            {
              text: 'addRequestCredentials',
              link: '/docs/api/servicebuilder/addRequestCredentials'
            },
            {
              text: 'addTrustedAlgorithmPublisher',
              link: '/docs/api/servicebuilder/addTrustedAlgorithmPublisher'
            },
            {
              text: 'addTrustedAlgorithms',
              link: '/docs/api/servicebuilder/addTrustedAlgorithms'
            },
            {
              text: 'allowAlgorithmNetworkAccess',
              link: '/docs/api/servicebuilder/allowAlgorithmNetworkAccess'
            },
            {
              text: 'allowRawAlgorithms',
              link: '/docs/api/servicebuilder/allowRawAlgorithms'
            },
            { text: 'build', link: '/docs/api/servicebuilder/build' },
            {
              text: 'removeTrustedAlgorithm',
              link: '/docs/api/servicebuilder/removeTrustedAlgorithm'
            },
            {
              text: 'removeTrustedAlgorithmPublisher',
              link: '/docs/api/servicebuilder/removeTrustedAlgorithmPublisher'
            },
            { text: 'reset', link: '/docs/api/servicebuilder/reset' },
            {
              text: 'setAllAlgorithmPublishersTrusted',
              link: '/docs/api/servicebuilder/setAllAlgorithmPublishersTrusted'
            },
            {
              text: 'setAllAlgorithmPublishersUntrusted',
              link: '/docs/api/servicebuilder/setAllAlgorithmPublishersUntrusted'
            },
            {
              text: 'setAllAlgorithmsTrusted',
              link: '/docs/api/servicebuilder/setAllAlgorithmsTrusted'
            },
            {
              text: 'setAllAlgorithmsUntrusted',
              link: '/docs/api/servicebuilder/setAllAlgorithmsUntrusted'
            },
            {
              text: 'setDataSchema',
              link: '/docs/api/servicebuilder/setDataSchema'
            },
            {
              text: 'setDatatokenData',
              link: '/docs/api/servicebuilder/setDatatokenData'
            },
            {
              text: 'setDatatokenNameAndSymbol',
              link: '/docs/api/servicebuilder/setDatatokenNameAndSymbol'
            },
            {
              text: 'setDescription',
              link: '/docs/api/servicebuilder/setDescription'
            },
            {
              text: 'setDisplayName',
              link: '/docs/api/servicebuilder/setDisplayName'
            },
            {
              text: 'setInputSchema',
              link: '/docs/api/servicebuilder/setInputSchema'
            },
            { text: 'setName', link: '/docs/api/servicebuilder/setName' },
            {
              text: 'setOutputSchema',
              link: '/docs/api/servicebuilder/setOutputSchema'
            },
            { text: 'setPricing', link: '/docs/api/servicebuilder/setPricing' },
            {
              text: 'setServiceEndpoint',
              link: '/docs/api/servicebuilder/setServiceEndpoint'
            },
            { text: 'setState', link: '/docs/api/servicebuilder/setState' },
            { text: 'setTimeout', link: '/docs/api/servicebuilder/setTimeout' }
          ]
        }
      ]
    },
    {
      text: 'Identity',
      collapsed: true,
      items: [
        { text: 'Credential-gated assets', link: '/docs/guides/identity' },
        {
          text: 'Providers',
          items: [
            {
              text: 'CredentialProvider',
              link: '/docs/api/identity/CredentialProvider'
            },
            {
              text: 'WaltIdCredentialProvider',
              link: '/docs/api/identity/WaltIdCredentialProvider'
            },
            {
              text: 'StaticCredentialProvider',
              link: '/docs/api/identity/StaticCredentialProvider'
            },
            {
              text: 'NoopCredentialProvider',
              link: '/docs/api/identity/NoopCredentialProvider'
            },
            {
              text: 'MemorySessionStore',
              link: '/docs/api/identity/MemorySessionStore'
            }
          ]
        }
      ]
    },
    {
      text: 'Storage, signing & the node',
      collapsed: true,
      items: [
        { text: 'Remote stores', link: '/docs/guides/remote-stores' },
        { text: 'Signing', link: '/docs/guides/signing' },
        { text: 'Ocean Node client', link: '/docs/guides/ocean-node' },
        {
          text: 'Reference',
          items: [
            {
              text: 'RemoteStore',
              link: '/docs/api/remote/RemoteStore'
            },
            {
              text: 'NodePersistentRemoteStore',
              link: '/docs/api/remote/NodePersistentRemoteStore'
            },
            {
              text: 'IpfsRemoteStore',
              link: '/docs/api/remote/IpfsRemoteStore'
            },
            {
              text: 'Eip191VcSigner',
              link: '/docs/api/signing/Eip191VcSigner'
            },
            {
              text: 'WaltIdVcSigner',
              link: '/docs/api/signing/WaltIdVcSigner'
            },
            {
              text: 'decodeCredential',
              link: '/docs/api/signing/decodeCredential'
            },
            {
              text: 'OceanNodeClient',
              link: '/docs/api/node/OceanNodeClient'
            },
            {
              text: 'createAuthToken',
              link: '/docs/api/node/createAuthToken'
            }
          ]
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
} as const satisfies Config['sidebar']
