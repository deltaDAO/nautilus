import type { MetadataConfig } from '../../src/@types/Publish.js'
import type { UrlFileObject } from '../../src/Nautilus/Asset/Service/NautilusService.js'

/** Minimal valid DDO v5 dataset metadata — note `providedBy`, which v5 requires. */
export const datasetMetadata: MetadataConfig = {
  type: 'dataset',
  name: 'Nautilus Test Dataset',
  description: 'Published by the nautilus integration suite',
  author: 'deltaDAO',
  providedBy: 'deltaDAO AG',
  copyrightHolder: 'deltaDAO AG',
  license: 'https://market.oceanprotocol.com/terms',
  tags: ['nautilus', 'test']
}

export const algorithmMetadata: MetadataConfig = {
  type: 'algorithm',
  name: 'Nautilus Test Algorithm',
  description: 'A trivial algorithm used by the nautilus integration suite',
  author: 'deltaDAO',
  providedBy: 'deltaDAO AG',
  license: 'https://market.oceanprotocol.com/terms',
  algorithm: {
    language: 'python',
    version: '0.1.0',
    /**
     * Env-overridable because image digests are per-platform and ocean-node
     * verifies the manifest before it will start a job.
     *
     * The defaults are amd64-only: `oceanprotocol/algo_dockers` publishes no
     * arm64 manifest at all, so on Apple Silicon compute needs a multi-arch
     * image instead — export these three variables with a digest resolved for
     * the host platform (e.g. from `node:18.17.1`) to run there.
     */
    container: {
      entrypoint: process.env.ALGO_IMAGE_ENTRYPOINT ?? 'python $ALGO',
      image: process.env.ALGO_IMAGE_NAME ?? 'oceanprotocol/algo_dockers',
      tag: process.env.ALGO_IMAGE_TAG ?? 'python-branin',
      checksum:
        process.env.ALGO_IMAGE_CHECKSUM ??
        'sha256:8f36c4b2b7b4b0e6b0d0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0'
    }
  }
}

/**
 * The ocean-node — not this process — fetches these URLs, to encrypt the files
 * object at publish time and to stream the data on download. They must
 * therefore resolve from wherever the node runs, not from this process; point
 * ASSET_BASE_URL at a host the node can reach to override the public defaults.
 *
 * Note that ocean-node rejects any URL matching 127.0.0.1 outright
 * (DEFAULT_UNSAFE_URLS), so a node in Docker needs host.docker.internal.
 */
const assetBase =
  process.env.ASSET_BASE_URL ??
  'https://raw.githubusercontent.com/oceanprotocol'

const localAssets = Boolean(process.env.ASSET_BASE_URL)

export const datasetFile: UrlFileObject = {
  type: 'url',
  url: localAssets
    ? `${assetBase}/example-dataset.json`
    : `${assetBase}/testdatasets/main/shs_dataset_test.txt`,
  method: 'GET'
}

export const algorithmFile: UrlFileObject = {
  type: 'url',
  url: localAssets
    ? `${assetBase}/count-lines-algorithm.js`
    : `${assetBase}/test-algorithm/master/javascript/algo.js`,
  method: 'GET'
}
