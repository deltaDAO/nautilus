import { DDO, Service, generateDid } from '@oceanprotocol/lib'
import { MetadataConfig } from '../../@types'
import { dateToStringNoMS, getAllPromisesOnArray } from '../../utils'
import {
  FileTypes,
  NautilusService,
  ServiceTypes
} from './Service/NautilusService'

export class NautilusDDO {
  metadata: MetadataConfig = {
    type: undefined,
    author: '',
    name: '',
    description: '',
    license: ''
  }

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

  private async buildDDOServices(encrypt = true): Promise<Service[]> {
    if (this.services?.length < 1)
      throw new Error('At least one service needs to be defined.')

    // encrypt files of services
    const servicesWithEncryptedFiles = await getAllPromisesOnArray(
      this.services,
      async (service) => {
        return await service.getOceanService(
          this.ddo.chainId,
          this.ddo.nftAddress
        )
      }
    )

    // TODO: consider both existing (this.ddo.services) and new services
    return servicesWithEncryptedFiles
  }

  private buildDDOMetadata(create: boolean): DDO['metadata'] {
    // add timestamps to metadata
    const currentTime = dateToStringNoMS(new Date())

    const newMetadata = {
      ...this.ddo.metadata,
      ...this.metadata, // TODO: nested data is potentially lost because of overwrite
      created: create ? currentTime : this.ddo.metadata.created,
      updated: currentTime
    }

    return newMetadata
  }

  private async getDDOServices() {
    // build services with encrypted files
    let builtServices: Service[] = []
    if (this.services.length > 0) builtServices = await this.buildDDOServices()

    // replace all "old" services with new ones
    const newServices =
      this.ddo.services.map((service) => {
        const replaceWithNew = newServices.find(
          (newService) => newService.id === service.id
        )
        return replaceWithNew || service
      }) ||
      // or use only the builtServices if no services existed yet
      builtServices

    return newServices
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

    // get all services for ddo
    const newServices = await this.getDDOServices()

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
