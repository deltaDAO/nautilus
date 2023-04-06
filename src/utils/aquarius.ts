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
    const response: AxiosResponse<Asset> = await axios.get(
      `${metadataCacheUri}/api/aquarius/assets/ddo/${did}`,
      { signal }
    )
    if (!response || response.status !== 200 || !response.data) return

    const data = { ...response.data }
    return data
  } catch (error) {
    if (axios.isCancel(error)) {
      LoggerInstance.log(error.message)
    } else {
      LoggerInstance.error(error.message)
    }
  }
}
