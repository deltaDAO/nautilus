# Nautilus

A script library that enables configurable automated publishing and consumption of assets in any ocean ecosystem.

- [Configuration](#configuration)
- [Automated Publishing](#automated-publishing)
- [Automated Consumption](#automated-consumption)
  - [Compute-to-Data](#compute-to-data)
  - [Download](#download)

## Configuration

The following `.env` variables can be set. For an example file see `.example.env`

```bash
PRIVATE_KEY="xxx"
CHAIN_ID="100"
PROVIDER_URI="https://provider.v4.genx.delta-dao.com"
AQUARIUS_URI="https://aquarius.v4.delta-dao.com"
RESULT_FOLDER="/results"
```

## Automated Publishing
```ts
/**
    Uses the provided wallet to publish an asset with the given metadata and service description

    accepted payload is either a filepath with necessary metadata / service config or an object

    metadata.description is allowed to be raw string (markdown supported) or filepath to a .md file
*/
publishAsset(metadata: Metadata | string, service: Service | string)
```

## Automated Consumption

### Compute-to-Data
```ts
/**
    attempts to start a CtD job for the given dataset and algorithm

    options is optional:
      - datasetCustomParams
      - algorithmCustomParams
      - 

    returns a computeJobId
*/
compute(datasetDid: string, algorithmDid: string, options: any)

/**
    attempts to retrieve the results of a CtD job for given jobId

    will be stored in {RESULT_FOLDER}/compute_results/jobId/
*/
retrieveResult(jobId: string)
```

### Download
```ts
/**
    attempts to access (e.g., download) the asset with given DID

    params is optional, depending on service to request

    will be stored in {RESULT_FOLDER}/access/did/
*/
accessAsset(did: string, params: any)
```
