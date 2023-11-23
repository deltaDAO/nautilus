import { Asset, LoggerInstance } from '@oceanprotocol/lib'
import axios, { AxiosResponse } from 'axios'

export async function getAsset(
  metadataCacheUri: string,
  did: string,
  signal?: AbortSignal
): Promise<Asset> {
  LoggerInstance.debug(
    `[aquarius] Retrieve asset ${did} using cache at ${metadataCacheUri}`
  )
  if (!did || !metadataCacheUri) return
  try {
    const apiPath = `/api/aquarius/assets/ddo/${did}`

    const fullAquariusUrl = new URL(apiPath, metadataCacheUri).href

    const response: AxiosResponse<Asset> = await axios.get(fullAquariusUrl, {
      signal
    })
    if (!response || response.status !== 200 || !response.data) return

    const data = { ...response.data }
    return data
  } catch (error) {
    if (axios.isCancel(error)) {
      LoggerInstance.log(error.message)
    } else {
      LoggerInstance.error(error.message)
    }
    throw error
  }
}

export async function getAssets(
  metadataCacheUri: string,
  dids: string[]
): Promise<{ [did: string]: Asset }> {
  const apiPath = '/api/aquarius/assets/query'

  if (!metadataCacheUri) {
    throw new Error('[aquarius] No metadata cache URI provided')
  }

  if (!dids?.length) {
    throw new Error('[aquarius] The DIDs array is empty')
  }

  const lowerCaseDids = dids.map((did) => did.toLowerCase())

  const queryPayload = {
    query: {
      bool: {
        filter: [
          {
            ids: {
              values: lowerCaseDids
            }
          }
        ]
      }
    }
  }

  const assets: { [did: string]: Asset } = {}

  try {
    const fullAquariusUrl = new URL(apiPath, metadataCacheUri).href
    const response: AxiosResponse<any> = await axios.post(
      fullAquariusUrl,
      queryPayload
    )

    LoggerInstance.debug(`[aquarius] Query status: ${response.status}`)

    if (response?.status === 200 && response?.data?.hits) {
      for (const hit of response.data.hits.hits) {
        const asset: Asset = hit._source
        if (asset && asset.id) {
          assets[asset.id.toLowerCase()] = asset
        }
      }
    }

    return assets
  } catch (error) {
    LoggerInstance.error(`Error in retrieving assets: ${error.message}`)
    throw error
  }
}
