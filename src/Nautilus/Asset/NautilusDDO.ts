import {
  DDO,
  LoggerInstance,
  ProviderInstance,
  Service,
  generateDid,
  getHash
} from '@oceanprotocol/lib'
import { MetadataConfig, PrePublishDDO, ServiceConfig } from '../../@types'
import { SHA256 } from 'crypto-js'
import {
  FileTypes,
  NautilusService,
  ServiceTypes
} from './Service/NautilusService'
import { dateToStringNoMS } from '../../utils'
import { getEncryptedFiles } from '../../utils/provider'

export class NautilusDDO {
  metadata: MetadataConfig
  services: NautilusService<ServiceTypes, FileTypes>[] = []

  private ddo: DDO = {
    '@context': ['https://w3id.org/did/v1'],
    id: '',
    nftAddress: '',
    chainId: undefined,
    metadata: undefined,
    services: [],
    version: '4.1.0'
  }

  static createFromDDO(ddo: DDO): NautilusDDO {
    const nautilusDDO = new NautilusDDO()
    nautilusDDO.ddo = ddo

    return nautilusDDO
  }

  private async encryptServiceFiles(
    service: ServiceConfig,
    datatokenAddress: string,
    nftAddress: string,
    chainId: number,
    providerUri: string
  ): Promise<Service> {
    const assetURL = {
      datatokenAddress,
      nftAddress,
      files: service.files
    }

    const encryptedFiles = await getEncryptedFiles(
      assetURL,
      chainId,
      providerUri
    )

    const serviceWithEncryptedFiles: Service = {
      ...service,
      id: getHash(encryptedFiles),
      files: encryptedFiles,
      datatokenAddress
    }

    return serviceWithEncryptedFiles
  }

  private async buildDDOServices(): Promise<Service[]> {
    if (this.services?.length < 1)
      throw new Error('At least one service needs to be defined.')

    const serviceConfigs: ServiceConfig[] = await Promise.all(
      this.services.map((service) => service.getConfig())
    )

    // encrypt files of services
    const servicesWithEncryptedFiles = await Promise.all(
      serviceConfigs.map(async (service) => {
        return this.encryptServiceFiles(
          service,
          service.datatokenAddress,
          this.ddo.nftAddress,
          this.ddo.chainId,
          service.serviceEndpoint
        )
      })
    )

    return servicesWithEncryptedFiles
  }

  private buildDDOMetadata(create: boolean): DDO['metadata'] {
    // add timestamps to metadata
    const currentTime = dateToStringNoMS(new Date())

    const newMetadata = {
      ...this.ddo.metadata,
      ...this.metadata,
      created: create ? currentTime : this.ddo.metadata.created,
      updated: currentTime
    }

    return newMetadata
  }

  private async buildDDO(
    create: boolean,
    erc721Address?: string,
    chainId?: number
  ): Promise<DDO> {
    // for initial creation we need to set additional info
    if (create) {
      if (!erc721Address || !chainId)
        throw new Error(
          'When creating a new DDO, erc721Address and chainId are required.'
        )

      this.ddo.id = generateDid(erc721Address, chainId)
      this.ddo.chainId = chainId
      this.ddo.nftAddress = erc721Address
    }

    // build new metadata for ddo
    const newMetadata = this.buildDDOMetadata(create)

    // build services with encrypted files
    const newServices = await this.buildDDOServices()

    // update ddo with metadata and services
    this.ddo = {
      ...this.ddo,
      metadata: newMetadata,
      services: newServices
    }

    return this.ddo
  }

  async getDDO(
    create = false,
    chainId?: number,
    erc721Address?: string
  ): Promise<DDO> {
    return this.buildDDO(create, erc721Address, chainId)
  }
}
