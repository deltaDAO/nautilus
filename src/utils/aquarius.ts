import { Asset, LoggerInstance } from '@oceanprotocol/lib'
import axios, { AxiosResponse, CancelToken } from 'axios'

const metadataCacheUri =
  process.env.AQUARIUS_URI || 'https://aquarius.v4.delta-dao.com'

export async function getAsset(
  did: string,
  signal: AbortSignal
): Promise<Asset> {
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
