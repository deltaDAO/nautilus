import { ProviderInstance } from '@oceanprotocol/lib'

export async function getEncryptedFiles(
  files: any,
  chainId: number,
  providerUrl: string
): Promise<string> {
  try {
    // https://github.com/oceanprotocol/provider/blob/v4main/API.md#encrypt-endpoint
    const response = await ProviderInstance.encrypt(files, chainId, providerUrl)
    return response
  } catch (error) {
    console.error('Error parsing json: ' + error.message)
  }
}
