# Nautilus Docs

## Release

To build new docs make sure to run the `start` command first, which generates the lates version of the documentation via [typedoc](https://typedoc.org/). See also: https://www.npmjs.com/package/docusaurus-plugin-typedoc

Once you are happy with the documentation, make sure the version you are trying to release has the docs generated correctly:

```
$ npm run docusaurus docs:version {{ YOUR_VERSION }}
```

This will create a folder in the `versioned_docs` directory holding the documentation for your release version.

For example, releasing version `1.0.0` expects that the docs previously have been generated using

```
$ npm run docusaurus docs:version 1.0.0
```

### Local Development

```
$ npm start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

### Build

```
$ npm build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.
