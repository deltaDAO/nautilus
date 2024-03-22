// vocs.config.tsx
import * as React from "file:///Users/moritzkirstein/Documents/deltaDAO/nautilus/node_modules/react/index.js";
import { defineConfig } from "file:///Users/moritzkirstein/Documents/deltaDAO/nautilus/node_modules/vocs/_lib/index.js";

// ../src/package.json
var package_default = {
  name: "@deltadao/nautilus",
  description: "A typescript library enabling automated publish & consume in Ocean Protocol ecosystems",
  version: "1.0.0-beta.2",
  type: "module",
  main: "./_cjs/index.js",
  module: "./_esm/index.js",
  types: "./_types/index.d.ts",
  typings: "./_types/index.d.ts",
  exports: {
    ".": {
      types: "./_types/index.d.ts",
      import: "./_esm/index.js",
      default: "./_cjs/index.js"
    }
  },
  peerDependencies: {
    "@oceanprotocol/lib": "^3.1.1",
    ethers: "^5.7.2"
  },
  overrides: {
    graphql: "15.8.0"
  },
  dependencies: {
    "@oceanprotocol/lib": "^3.1.1",
    axios: "^1.3.4",
    "decimal.js": "^10.4.3",
    ethers: "^5.7.2",
    urql: "^3.0.4"
  },
  codegen: {
    schema: "https://v4.subgraph.goerli.oceanprotocol.com/subgraphs/name/oceanprotocol/ocean-subgraph",
    documents: "./src/**/*.gql.ts",
    generates: {
      "./src/@types/subgraph/api.ts": {
        plugins: ["typescript"]
      },
      "./src/": {
        preset: "near-operation-file",
        presetConfig: {
          baseTypesPath: "@types/subgraph/api.ts",
          extension: ".generated.ts"
        },
        plugins: ["typescript-operations"],
        config: {
          omitOperationSuffix: true,
          typesPrefix: "I"
        }
      }
    }
  },
  repository: {
    type: "git",
    url: "git+https://github.com/deltaDAO/nautilus.git"
  },
  author: "deltaDAO",
  license: "Apache-2.0",
  bugs: {
    url: "https://github.com/deltaDAO/nautilus/issues"
  },
  homepage: "https://github.com/deltaDAO/nautilus#readme"
};

// sidebar.ts
var sidebar = {
  "/docs/": [
    {
      text: "Introduction",
      items: [
        { text: "Why Nautilus", link: "/docs/introduction" },
        { text: "Getting Started", link: "/docs/getting-started" },
        { text: "FAQ", link: "/docs/faq" }
      ]
    },
    {
      text: "The Nautilus Instance",
      items: [
        { text: "Overview", link: "/docs/api/Nautilus" },
        {
          text: "Static",
          items: [
            { text: "create", link: "/docs/api/nautilus/create" },
            { text: "setLogLevel", link: "/docs/api/nautilus/setLogLevel" }
          ]
        },
        {
          text: "Instanced",
          items: [
            { text: "publish", link: "/docs/api/nautilus/publish" },
            { text: "edit", link: "/docs/api/nautilus/edit" },
            {
              text: "setServicePrice",
              link: "/docs/api/nautilus/setServicePrice"
            },
            {
              text: "getAquariusAssets",
              link: "/docs/api/nautilus/getAquariusAssets"
            },
            {
              text: "getAquariusAsset",
              link: "/docs/api/nautilus/getAquariusAsset"
            },
            {
              text: "setAssetLifecycleState",
              link: "/docs/api/nautilus/setAssetLifecycleState"
            },
            { text: "access", link: "/docs/api/nautilus/access" },
            { text: "compute", link: "/docs/api/nautilus/compute" },
            {
              text: "getComputeStatus",
              link: "/docs/api/nautilus/getComputeStatus"
            },
            {
              text: "getComputeResult",
              link: "/docs/api/nautilus/getComputeResult"
            },
            { text: "stopCompute", link: "/docs/api/nautilus/stopCompute" }
          ]
        }
      ]
    },
    {
      text: "Publish",
      collapsed: true,
      items: [
        { text: "Overview", link: "/docs/guides/publish" },
        { text: "Configuration", link: "/docs/api/PublishConfig" },
        {
          text: "Builders",
          items: [
            { text: "AssetBuilder", link: "/docs/api/AssetBuilder" },
            { text: "ServiceBuilder", link: "/docs/api/ServiceBuilder" },
            {
              text: "ConsumerParameterBuilder",
              link: "/docs/api/ConsumerParameterBuilder"
            }
          ]
        }
      ]
    },
    {
      text: "Edit",
      collapsed: true,
      items: [{ text: "Overview", link: "/docs/guides/edit" }]
    },
    {
      text: "Compute",
      collapsed: true,
      items: [{ text: "Overview", link: "/docs/guides/compute" }]
    },
    {
      text: "Download",
      collapsed: true,
      items: [{ text: "Overview", link: "/docs/guides/download" }]
    },
    {
      text: "Advanced",
      items: [{ text: "Custom configuration", link: "/docs/guides/config" }]
    }
  ]
};

// vocs.config.tsx
var vocs_config_default = defineConfig({
  baseUrl: "https://nautilus.delta-dao.com",
  title: "Nautilus",
  titleTemplate: "%s \xB7 Nautilus",
  description: "Navigate the data economy - a toolkit to intereact with OceanProtocol ecosystems.",
  head: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("script", { src: "https://buttons.github.io/buttons.js", async: true, defer: true })),
  ogImageUrl: {
    "/": "/og-image.png",
    "/docs": "https://vocs.dev/api/og?logo=%logo&title=%title&description=%description",
    "/op-stack": "https://vocs.dev/api/og?logo=%logo&title=%title&description=%description"
  },
  iconUrl: { light: "/favicons/light.png", dark: "/favicons/dark.png" },
  logoUrl: { light: "/icon-light.png", dark: "/icon-dark.png" },
  rootDir: ".",
  sidebar,
  socials: [
    {
      icon: "github",
      link: "https://github.com/deltaDAO/nautilus"
    }
  ],
  sponsors: [
    {
      name: "Enterprises",
      height: 80,
      items: [
        [
          {
            name: "OceanProtocol",
            link: "https://oceanprotocol.com",
            image: "https://oceanprotocol.com/static/ae84296f3b9ccb7054530d3af623f1fa/logo.svg"
          },
          {
            name: "Oasis Network",
            link: "https://oasisprotocol.org/",
            image: "https://assets-global.website-files.com/63617eb68a66008a1a2130a0/639b268fde36b82f6ca20500_Network%20Logo.svg"
          }
        ]
      ]
    }
  ],
  theme: {
    accentColor: {
      light: "#007599",
      dark: "#00caff"
    }
  },
  topNav: [
    { text: "Docs", link: "/docs/getting-started", match: "/docs" },
    {
      text: "Examples",
      link: "https://github.com/deltaDAO/nautilus-examples"
    },
    {
      text: package_default.version,
      items: [
        // {
        //   text: `Migrating to ${toPatchVersionRange(pkg.version)}`,
        //   link: `/docs/migration-guide#_${toPatchVersionRange(
        //     pkg.version
        //   ).replace(/\./g, '-')}-breaking-changes`
        // },
        {
          text: "Changelog",
          link: "https://github.com/deltaDAO/nautilus/blob/main/src/CHANGELOG.md"
        }
        // {
        //   text: 'Contributing',
        //   link: 'https://github.com/deltaDAO/nautilus/blob/main/.github/CONTRIBUTING.md',
        // },
      ]
    }
  ]
});
export {
  vocs_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidm9jcy5jb25maWcudHN4IiwgIi4uL3NyYy9wYWNrYWdlLmpzb24iLCAic2lkZWJhci50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0ICogYXMgUmVhY3QgZnJvbSAncmVhY3QnXG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2b2NzJ1xuaW1wb3J0IHBrZyBmcm9tICcuLi9zcmMvcGFja2FnZS5qc29uJ1xuaW1wb3J0IHsgc2lkZWJhciB9IGZyb20gJy4vc2lkZWJhcidcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYmFzZVVybDogJ2h0dHBzOi8vbmF1dGlsdXMuZGVsdGEtZGFvLmNvbScsXG4gIHRpdGxlOiAnTmF1dGlsdXMnLFxuICB0aXRsZVRlbXBsYXRlOiAnJXMgXHUwMEI3IE5hdXRpbHVzJyxcbiAgZGVzY3JpcHRpb246XG4gICAgJ05hdmlnYXRlIHRoZSBkYXRhIGVjb25vbXkgLSBhIHRvb2xraXQgdG8gaW50ZXJlYWN0IHdpdGggT2NlYW5Qcm90b2NvbCBlY29zeXN0ZW1zLicsXG4gIGhlYWQ6IChcbiAgICA8PlxuICAgICAgey8qIDxzY3JpcHRcbiAgICAgICAgc3JjPVwiaHR0cHM6Ly9jZG4udXNlZmF0aG9tLmNvbS9zY3JpcHQuanNcIlxuICAgICAgICBkZWZlclxuICAgICAgLz4gKi99XG4gICAgICA8c2NyaXB0IHNyYz1cImh0dHBzOi8vYnV0dG9ucy5naXRodWIuaW8vYnV0dG9ucy5qc1wiIGFzeW5jIGRlZmVyIC8+XG4gICAgPC8+XG4gICksXG4gIG9nSW1hZ2VVcmw6IHtcbiAgICAnLyc6ICcvb2ctaW1hZ2UucG5nJyxcbiAgICAnL2RvY3MnOlxuICAgICAgJ2h0dHBzOi8vdm9jcy5kZXYvYXBpL29nP2xvZ289JWxvZ28mdGl0bGU9JXRpdGxlJmRlc2NyaXB0aW9uPSVkZXNjcmlwdGlvbicsXG4gICAgJy9vcC1zdGFjayc6XG4gICAgICAnaHR0cHM6Ly92b2NzLmRldi9hcGkvb2c/bG9nbz0lbG9nbyZ0aXRsZT0ldGl0bGUmZGVzY3JpcHRpb249JWRlc2NyaXB0aW9uJ1xuICB9LFxuICBpY29uVXJsOiB7IGxpZ2h0OiAnL2Zhdmljb25zL2xpZ2h0LnBuZycsIGRhcms6ICcvZmF2aWNvbnMvZGFyay5wbmcnIH0sXG4gIGxvZ29Vcmw6IHsgbGlnaHQ6ICcvaWNvbi1saWdodC5wbmcnLCBkYXJrOiAnL2ljb24tZGFyay5wbmcnIH0sXG4gIHJvb3REaXI6ICcuJyxcbiAgc2lkZWJhcixcbiAgc29jaWFsczogW1xuICAgIHtcbiAgICAgIGljb246ICdnaXRodWInLFxuICAgICAgbGluazogJ2h0dHBzOi8vZ2l0aHViLmNvbS9kZWx0YURBTy9uYXV0aWx1cydcbiAgICB9XG4gIF0sXG4gIHNwb25zb3JzOiBbXG4gICAge1xuICAgICAgbmFtZTogJ0VudGVycHJpc2VzJyxcbiAgICAgIGhlaWdodDogODAsXG4gICAgICBpdGVtczogW1xuICAgICAgICBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbmFtZTogJ09jZWFuUHJvdG9jb2wnLFxuICAgICAgICAgICAgbGluazogJ2h0dHBzOi8vb2NlYW5wcm90b2NvbC5jb20nLFxuICAgICAgICAgICAgaW1hZ2U6XG4gICAgICAgICAgICAgICdodHRwczovL29jZWFucHJvdG9jb2wuY29tL3N0YXRpYy9hZTg0Mjk2ZjNiOWNjYjcwNTQ1MzBkM2FmNjIzZjFmYS9sb2dvLnN2ZydcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdPYXNpcyBOZXR3b3JrJyxcbiAgICAgICAgICAgIGxpbms6ICdodHRwczovL29hc2lzcHJvdG9jb2wub3JnLycsXG4gICAgICAgICAgICBpbWFnZTpcbiAgICAgICAgICAgICAgJ2h0dHBzOi8vYXNzZXRzLWdsb2JhbC53ZWJzaXRlLWZpbGVzLmNvbS82MzYxN2ViNjhhNjYwMDhhMWEyMTMwYTAvNjM5YjI2OGZkZTM2YjgyZjZjYTIwNTAwX05ldHdvcmslMjBMb2dvLnN2ZydcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIF1cbiAgICB9XG4gIF0sXG4gIHRoZW1lOiB7XG4gICAgYWNjZW50Q29sb3I6IHtcbiAgICAgIGxpZ2h0OiAnIzAwNzU5OScsXG4gICAgICBkYXJrOiAnIzAwY2FmZidcbiAgICB9XG4gIH0sXG4gIHRvcE5hdjogW1xuICAgIHsgdGV4dDogJ0RvY3MnLCBsaW5rOiAnL2RvY3MvZ2V0dGluZy1zdGFydGVkJywgbWF0Y2g6ICcvZG9jcycgfSxcbiAgICB7XG4gICAgICB0ZXh0OiAnRXhhbXBsZXMnLFxuICAgICAgbGluazogJ2h0dHBzOi8vZ2l0aHViLmNvbS9kZWx0YURBTy9uYXV0aWx1cy1leGFtcGxlcydcbiAgICB9LFxuICAgIHtcbiAgICAgIHRleHQ6IHBrZy52ZXJzaW9uLFxuICAgICAgaXRlbXM6IFtcbiAgICAgICAgLy8ge1xuICAgICAgICAvLyAgIHRleHQ6IGBNaWdyYXRpbmcgdG8gJHt0b1BhdGNoVmVyc2lvblJhbmdlKHBrZy52ZXJzaW9uKX1gLFxuICAgICAgICAvLyAgIGxpbms6IGAvZG9jcy9taWdyYXRpb24tZ3VpZGUjXyR7dG9QYXRjaFZlcnNpb25SYW5nZShcbiAgICAgICAgLy8gICAgIHBrZy52ZXJzaW9uXG4gICAgICAgIC8vICAgKS5yZXBsYWNlKC9cXC4vZywgJy0nKX0tYnJlYWtpbmctY2hhbmdlc2BcbiAgICAgICAgLy8gfSxcbiAgICAgICAge1xuICAgICAgICAgIHRleHQ6ICdDaGFuZ2Vsb2cnLFxuICAgICAgICAgIGxpbms6ICdodHRwczovL2dpdGh1Yi5jb20vZGVsdGFEQU8vbmF1dGlsdXMvYmxvYi9tYWluL3NyYy9DSEFOR0VMT0cubWQnXG4gICAgICAgIH1cbiAgICAgICAgLy8ge1xuICAgICAgICAvLyAgIHRleHQ6ICdDb250cmlidXRpbmcnLFxuICAgICAgICAvLyAgIGxpbms6ICdodHRwczovL2dpdGh1Yi5jb20vZGVsdGFEQU8vbmF1dGlsdXMvYmxvYi9tYWluLy5naXRodWIvQ09OVFJJQlVUSU5HLm1kJyxcbiAgICAgICAgLy8gfSxcbiAgICAgIF1cbiAgICB9XG4gIF1cbn0pXG5cbmZ1bmN0aW9uIHRvUGF0Y2hWZXJzaW9uUmFuZ2UodmVyc2lvbjogc3RyaW5nKSB7XG4gIGNvbnN0IFttYWpvciwgbWlub3JdID0gdmVyc2lvbi5zcGxpdCgnLicpLnNsaWNlKDAsIDIpXG4gIHJldHVybiBgJHttYWpvcn0uJHttaW5vcn0ueGBcbn1cbiIsICJ7XG4gIFwibmFtZVwiOiBcIkBkZWx0YWRhby9uYXV0aWx1c1wiLFxuICBcImRlc2NyaXB0aW9uXCI6IFwiQSB0eXBlc2NyaXB0IGxpYnJhcnkgZW5hYmxpbmcgYXV0b21hdGVkIHB1Ymxpc2ggJiBjb25zdW1lIGluIE9jZWFuIFByb3RvY29sIGVjb3N5c3RlbXNcIixcbiAgXCJ2ZXJzaW9uXCI6IFwiMS4wLjAtYmV0YS4yXCIsXG4gIFwidHlwZVwiOiBcIm1vZHVsZVwiLFxuICBcIm1haW5cIjogXCIuL19janMvaW5kZXguanNcIixcbiAgXCJtb2R1bGVcIjogXCIuL19lc20vaW5kZXguanNcIixcbiAgXCJ0eXBlc1wiOiBcIi4vX3R5cGVzL2luZGV4LmQudHNcIixcbiAgXCJ0eXBpbmdzXCI6IFwiLi9fdHlwZXMvaW5kZXguZC50c1wiLFxuICBcImV4cG9ydHNcIjoge1xuICAgIFwiLlwiOiB7XG4gICAgICBcInR5cGVzXCI6IFwiLi9fdHlwZXMvaW5kZXguZC50c1wiLFxuICAgICAgXCJpbXBvcnRcIjogXCIuL19lc20vaW5kZXguanNcIixcbiAgICAgIFwiZGVmYXVsdFwiOiBcIi4vX2Nqcy9pbmRleC5qc1wiXG4gICAgfVxuICB9LFxuICBcInBlZXJEZXBlbmRlbmNpZXNcIjoge1xuICAgIFwiQG9jZWFucHJvdG9jb2wvbGliXCI6IFwiXjMuMS4xXCIsXG4gICAgXCJldGhlcnNcIjogXCJeNS43LjJcIlxuICB9LFxuICBcIm92ZXJyaWRlc1wiOiB7XG4gICAgXCJncmFwaHFsXCI6IFwiMTUuOC4wXCJcbiAgfSxcbiAgXCJkZXBlbmRlbmNpZXNcIjoge1xuICAgIFwiQG9jZWFucHJvdG9jb2wvbGliXCI6IFwiXjMuMS4xXCIsXG4gICAgXCJheGlvc1wiOiBcIl4xLjMuNFwiLFxuICAgIFwiZGVjaW1hbC5qc1wiOiBcIl4xMC40LjNcIixcbiAgICBcImV0aGVyc1wiOiBcIl41LjcuMlwiLFxuICAgIFwidXJxbFwiOiBcIl4zLjAuNFwiXG4gIH0sXG4gIFwiY29kZWdlblwiOiB7XG4gICAgXCJzY2hlbWFcIjogXCJodHRwczovL3Y0LnN1YmdyYXBoLmdvZXJsaS5vY2VhbnByb3RvY29sLmNvbS9zdWJncmFwaHMvbmFtZS9vY2VhbnByb3RvY29sL29jZWFuLXN1YmdyYXBoXCIsXG4gICAgXCJkb2N1bWVudHNcIjogXCIuL3NyYy8qKi8qLmdxbC50c1wiLFxuICAgIFwiZ2VuZXJhdGVzXCI6IHtcbiAgICAgIFwiLi9zcmMvQHR5cGVzL3N1YmdyYXBoL2FwaS50c1wiOiB7XG4gICAgICAgIFwicGx1Z2luc1wiOiBbXCJ0eXBlc2NyaXB0XCJdXG4gICAgICB9LFxuICAgICAgXCIuL3NyYy9cIjoge1xuICAgICAgICBcInByZXNldFwiOiBcIm5lYXItb3BlcmF0aW9uLWZpbGVcIixcbiAgICAgICAgXCJwcmVzZXRDb25maWdcIjoge1xuICAgICAgICAgIFwiYmFzZVR5cGVzUGF0aFwiOiBcIkB0eXBlcy9zdWJncmFwaC9hcGkudHNcIixcbiAgICAgICAgICBcImV4dGVuc2lvblwiOiBcIi5nZW5lcmF0ZWQudHNcIlxuICAgICAgICB9LFxuICAgICAgICBcInBsdWdpbnNcIjogW1widHlwZXNjcmlwdC1vcGVyYXRpb25zXCJdLFxuICAgICAgICBcImNvbmZpZ1wiOiB7XG4gICAgICAgICAgXCJvbWl0T3BlcmF0aW9uU3VmZml4XCI6IHRydWUsXG4gICAgICAgICAgXCJ0eXBlc1ByZWZpeFwiOiBcIklcIlxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9LFxuICBcInJlcG9zaXRvcnlcIjoge1xuICAgIFwidHlwZVwiOiBcImdpdFwiLFxuICAgIFwidXJsXCI6IFwiZ2l0K2h0dHBzOi8vZ2l0aHViLmNvbS9kZWx0YURBTy9uYXV0aWx1cy5naXRcIlxuICB9LFxuICBcImF1dGhvclwiOiBcImRlbHRhREFPXCIsXG4gIFwibGljZW5zZVwiOiBcIkFwYWNoZS0yLjBcIixcbiAgXCJidWdzXCI6IHtcbiAgICBcInVybFwiOiBcImh0dHBzOi8vZ2l0aHViLmNvbS9kZWx0YURBTy9uYXV0aWx1cy9pc3N1ZXNcIlxuICB9LFxuICBcImhvbWVwYWdlXCI6IFwiaHR0cHM6Ly9naXRodWIuY29tL2RlbHRhREFPL25hdXRpbHVzI3JlYWRtZVwiXG59XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9Vc2Vycy9tb3JpdHpraXJzdGVpbi9Eb2N1bWVudHMvZGVsdGFEQU8vbmF1dGlsdXMvZG9jc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL21vcml0emtpcnN0ZWluL0RvY3VtZW50cy9kZWx0YURBTy9uYXV0aWx1cy9kb2NzL3NpZGViYXIudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL21vcml0emtpcnN0ZWluL0RvY3VtZW50cy9kZWx0YURBTy9uYXV0aWx1cy9kb2NzL3NpZGViYXIudHNcIjtpbXBvcnQgdHlwZSB7IFNpZGViYXIgfSBmcm9tICd2b2NzJ1xuXG5leHBvcnQgY29uc3Qgc2lkZWJhciA9IHtcbiAgJy9kb2NzLyc6IFtcbiAgICB7XG4gICAgICB0ZXh0OiAnSW50cm9kdWN0aW9uJyxcbiAgICAgIGl0ZW1zOiBbXG4gICAgICAgIHsgdGV4dDogJ1doeSBOYXV0aWx1cycsIGxpbms6ICcvZG9jcy9pbnRyb2R1Y3Rpb24nIH0sXG4gICAgICAgIHsgdGV4dDogJ0dldHRpbmcgU3RhcnRlZCcsIGxpbms6ICcvZG9jcy9nZXR0aW5nLXN0YXJ0ZWQnIH0sXG4gICAgICAgIHsgdGV4dDogJ0ZBUScsIGxpbms6ICcvZG9jcy9mYXEnIH1cbiAgICAgIF1cbiAgICB9LFxuICAgIHtcbiAgICAgIHRleHQ6ICdUaGUgTmF1dGlsdXMgSW5zdGFuY2UnLFxuICAgICAgaXRlbXM6IFtcbiAgICAgICAgeyB0ZXh0OiAnT3ZlcnZpZXcnLCBsaW5rOiAnL2RvY3MvYXBpL05hdXRpbHVzJyB9LFxuICAgICAgICB7XG4gICAgICAgICAgdGV4dDogJ1N0YXRpYycsXG4gICAgICAgICAgaXRlbXM6IFtcbiAgICAgICAgICAgIHsgdGV4dDogJ2NyZWF0ZScsIGxpbms6ICcvZG9jcy9hcGkvbmF1dGlsdXMvY3JlYXRlJyB9LFxuICAgICAgICAgICAgeyB0ZXh0OiAnc2V0TG9nTGV2ZWwnLCBsaW5rOiAnL2RvY3MvYXBpL25hdXRpbHVzL3NldExvZ0xldmVsJyB9XG4gICAgICAgICAgXVxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdGV4dDogJ0luc3RhbmNlZCcsXG4gICAgICAgICAgaXRlbXM6IFtcbiAgICAgICAgICAgIHsgdGV4dDogJ3B1Ymxpc2gnLCBsaW5rOiAnL2RvY3MvYXBpL25hdXRpbHVzL3B1Ymxpc2gnIH0sXG4gICAgICAgICAgICB7IHRleHQ6ICdlZGl0JywgbGluazogJy9kb2NzL2FwaS9uYXV0aWx1cy9lZGl0JyB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0ZXh0OiAnc2V0U2VydmljZVByaWNlJyxcbiAgICAgICAgICAgICAgbGluazogJy9kb2NzL2FwaS9uYXV0aWx1cy9zZXRTZXJ2aWNlUHJpY2UnXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0ZXh0OiAnZ2V0QXF1YXJpdXNBc3NldHMnLFxuICAgICAgICAgICAgICBsaW5rOiAnL2RvY3MvYXBpL25hdXRpbHVzL2dldEFxdWFyaXVzQXNzZXRzJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdGV4dDogJ2dldEFxdWFyaXVzQXNzZXQnLFxuICAgICAgICAgICAgICBsaW5rOiAnL2RvY3MvYXBpL25hdXRpbHVzL2dldEFxdWFyaXVzQXNzZXQnXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0ZXh0OiAnc2V0QXNzZXRMaWZlY3ljbGVTdGF0ZScsXG4gICAgICAgICAgICAgIGxpbms6ICcvZG9jcy9hcGkvbmF1dGlsdXMvc2V0QXNzZXRMaWZlY3ljbGVTdGF0ZSdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7IHRleHQ6ICdhY2Nlc3MnLCBsaW5rOiAnL2RvY3MvYXBpL25hdXRpbHVzL2FjY2VzcycgfSxcbiAgICAgICAgICAgIHsgdGV4dDogJ2NvbXB1dGUnLCBsaW5rOiAnL2RvY3MvYXBpL25hdXRpbHVzL2NvbXB1dGUnIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHRleHQ6ICdnZXRDb21wdXRlU3RhdHVzJyxcbiAgICAgICAgICAgICAgbGluazogJy9kb2NzL2FwaS9uYXV0aWx1cy9nZXRDb21wdXRlU3RhdHVzJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdGV4dDogJ2dldENvbXB1dGVSZXN1bHQnLFxuICAgICAgICAgICAgICBsaW5rOiAnL2RvY3MvYXBpL25hdXRpbHVzL2dldENvbXB1dGVSZXN1bHQnXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyB0ZXh0OiAnc3RvcENvbXB1dGUnLCBsaW5rOiAnL2RvY3MvYXBpL25hdXRpbHVzL3N0b3BDb21wdXRlJyB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSxcbiAgICB7XG4gICAgICB0ZXh0OiAnUHVibGlzaCcsXG4gICAgICBjb2xsYXBzZWQ6IHRydWUsXG4gICAgICBpdGVtczogW1xuICAgICAgICB7IHRleHQ6ICdPdmVydmlldycsIGxpbms6ICcvZG9jcy9ndWlkZXMvcHVibGlzaCcgfSxcbiAgICAgICAgeyB0ZXh0OiAnQ29uZmlndXJhdGlvbicsIGxpbms6ICcvZG9jcy9hcGkvUHVibGlzaENvbmZpZycgfSxcbiAgICAgICAge1xuICAgICAgICAgIHRleHQ6ICdCdWlsZGVycycsXG4gICAgICAgICAgaXRlbXM6IFtcbiAgICAgICAgICAgIHsgdGV4dDogJ0Fzc2V0QnVpbGRlcicsIGxpbms6ICcvZG9jcy9hcGkvQXNzZXRCdWlsZGVyJyB9LFxuICAgICAgICAgICAgeyB0ZXh0OiAnU2VydmljZUJ1aWxkZXInLCBsaW5rOiAnL2RvY3MvYXBpL1NlcnZpY2VCdWlsZGVyJyB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0ZXh0OiAnQ29uc3VtZXJQYXJhbWV0ZXJCdWlsZGVyJyxcbiAgICAgICAgICAgICAgbGluazogJy9kb2NzL2FwaS9Db25zdW1lclBhcmFtZXRlckJ1aWxkZXInXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSxcbiAgICB7XG4gICAgICB0ZXh0OiAnRWRpdCcsXG4gICAgICBjb2xsYXBzZWQ6IHRydWUsXG4gICAgICBpdGVtczogW3sgdGV4dDogJ092ZXJ2aWV3JywgbGluazogJy9kb2NzL2d1aWRlcy9lZGl0JyB9XVxuICAgIH0sXG4gICAge1xuICAgICAgdGV4dDogJ0NvbXB1dGUnLFxuICAgICAgY29sbGFwc2VkOiB0cnVlLFxuICAgICAgaXRlbXM6IFt7IHRleHQ6ICdPdmVydmlldycsIGxpbms6ICcvZG9jcy9ndWlkZXMvY29tcHV0ZScgfV1cbiAgICB9LFxuICAgIHtcbiAgICAgIHRleHQ6ICdEb3dubG9hZCcsXG4gICAgICBjb2xsYXBzZWQ6IHRydWUsXG4gICAgICBpdGVtczogW3sgdGV4dDogJ092ZXJ2aWV3JywgbGluazogJy9kb2NzL2d1aWRlcy9kb3dubG9hZCcgfV1cbiAgICB9LFxuICAgIHtcbiAgICAgIHRleHQ6ICdBZHZhbmNlZCcsXG4gICAgICBpdGVtczogW3sgdGV4dDogJ0N1c3RvbSBjb25maWd1cmF0aW9uJywgbGluazogJy9kb2NzL2d1aWRlcy9jb25maWcnIH1dXG4gICAgfVxuICBdXG59IGFzIGNvbnN0IHNhdGlzZmllcyBTaWRlYmFyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQUEsWUFBWSxXQUFXO0FBQ3ZCLFNBQVMsb0JBQW9COzs7QUNEN0I7QUFBQSxFQUNFLE1BQVE7QUFBQSxFQUNSLGFBQWU7QUFBQSxFQUNmLFNBQVc7QUFBQSxFQUNYLE1BQVE7QUFBQSxFQUNSLE1BQVE7QUFBQSxFQUNSLFFBQVU7QUFBQSxFQUNWLE9BQVM7QUFBQSxFQUNULFNBQVc7QUFBQSxFQUNYLFNBQVc7QUFBQSxJQUNULEtBQUs7QUFBQSxNQUNILE9BQVM7QUFBQSxNQUNULFFBQVU7QUFBQSxNQUNWLFNBQVc7QUFBQSxJQUNiO0FBQUEsRUFDRjtBQUFBLEVBQ0Esa0JBQW9CO0FBQUEsSUFDbEIsc0JBQXNCO0FBQUEsSUFDdEIsUUFBVTtBQUFBLEVBQ1o7QUFBQSxFQUNBLFdBQWE7QUFBQSxJQUNYLFNBQVc7QUFBQSxFQUNiO0FBQUEsRUFDQSxjQUFnQjtBQUFBLElBQ2Qsc0JBQXNCO0FBQUEsSUFDdEIsT0FBUztBQUFBLElBQ1QsY0FBYztBQUFBLElBQ2QsUUFBVTtBQUFBLElBQ1YsTUFBUTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLFNBQVc7QUFBQSxJQUNULFFBQVU7QUFBQSxJQUNWLFdBQWE7QUFBQSxJQUNiLFdBQWE7QUFBQSxNQUNYLGdDQUFnQztBQUFBLFFBQzlCLFNBQVcsQ0FBQyxZQUFZO0FBQUEsTUFDMUI7QUFBQSxNQUNBLFVBQVU7QUFBQSxRQUNSLFFBQVU7QUFBQSxRQUNWLGNBQWdCO0FBQUEsVUFDZCxlQUFpQjtBQUFBLFVBQ2pCLFdBQWE7QUFBQSxRQUNmO0FBQUEsUUFDQSxTQUFXLENBQUMsdUJBQXVCO0FBQUEsUUFDbkMsUUFBVTtBQUFBLFVBQ1IscUJBQXVCO0FBQUEsVUFDdkIsYUFBZTtBQUFBLFFBQ2pCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxZQUFjO0FBQUEsSUFDWixNQUFRO0FBQUEsSUFDUixLQUFP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
