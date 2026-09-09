/**
 * Where the example asset files live, and which container the algorithm
 * examples run in.
 *
 * Both are indirected through the environment so the examples work unchanged
 * against a remote network *and* against the local dev stack.
 *
 * ## Why the URL matters more than it looks
 *
 * You never fetch these URLs — the **ocean-node** does, to encrypt the files
 * object at publish time and to stream the data on download. So the URL has to
 * resolve from inside Docker, not from your shell. `dev-stack` therefore sets
 * `ASSET_BASE_URL=http://host.docker.internal:8081`.
 *
 * Do not be tempted to use `http://127.0.0.1:8081` — ocean-node's
 * `DEFAULT_UNSAFE_URLS` blocks anything matching 127.0.0.1 outright, and you
 * get "URL is marked as unsafe" rather than a connection error.
 */

const DEFAULT_ASSET_BASE_URL =
  'https://raw.githubusercontent.com/deltaDAO/nautilus/main/examples/example_publish_assets'

/** Absolute URL for a file in `example_publish_assets/`. */
export function assetUrl(filename: string): string {
  const base = (process.env.ASSET_BASE_URL ?? DEFAULT_ASSET_BASE_URL).replace(
    /\/+$/,
    ''
  )

  return `${base}/${filename}`
}

export const EXAMPLE_DATASET_URL = () => assetUrl('example-dataset.json')
export const EXAMPLE_ALGORITHM_URL = () => assetUrl('count-lines-algorithm.js')

/**
 * The container the algorithm examples run in.
 *
 * The checksum is env-overridable because image digests are **per platform**.
 * The value below is the one published for the linux/amd64 manifest; an Apple
 * Silicon host resolves node:18.17.1 to a different digest entirely, and
 * ocean-node verifies the manifest before it will start a job. `stack:seed`
 * resolves the right digest for your machine and writes ALGO_IMAGE_CHECKSUM.
 */
export const NODE_CONTAINER = {
  language: 'Node.js',
  version: '1.0.0',
  container: {
    entrypoint: 'node $ALGO',
    image: process.env.ALGO_IMAGE_NAME ?? 'node',
    tag: process.env.ALGO_IMAGE_TAG ?? '18.17.1',
    checksum:
      process.env.ALGO_IMAGE_CHECKSUM ??
      'sha256:91e37377b960d0b15d3c15d15321084163bc8d950e14f77bbc84ab23cf3d6da7'
  }
}
