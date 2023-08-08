import { DDO, Service, generateDid } from '@oceanprotocol/lib'
import { MetadataConfig } from '../../@types'
import { dateToStringNoMS, getAllPromisesOnArray } from '../../utils'
import {
  FileTypes,
  NautilusService,
  ServiceTypes
} from './Service/NautilusService'

export class NautilusDDO {
  id: string
  context: string[] = ['https://w3id.org/did/v1']
  nftAddress: string
  chainId: number
  version: string = '4.1.0'
  metadata: MetadataConfig
  services: NautilusService<ServiceTypes, FileTypes>[] = []

  private ddo: DDO

  static createFromDDO(ddo: DDO): NautilusDDO {
    const nautilusDDO = new NautilusDDO()
    nautilusDDO.ddo = ddo

    nautilusDDO.id = ddo.id
    nautilusDDO.context = ddo['@context']
    nautilusDDO.nftAddress = ddo.nftAddress
    nautilusDDO.chainId = ddo.chainId
    nautilusDDO.version = ddo.version

    return nautilusDDO
  }

  private async buildDDOServices(encrypt = true): Promise<Service[]> {
    if (this.services?.length < 1)
      throw new Error('At least one service needs to be defined.')

    // encrypt files of services
    const servicesWithEncryptedFiles = await getAllPromisesOnArray(
      this.services,
      async (service) => {
        return await service.getOceanService(this.chainId, this.nftAddress)
      }
    )

    // TODO: consider both existing (this.ddo.services) and new services
    return servicesWithEncryptedFiles
  }

  private buildDDOMetadata(create: boolean): DDO['metadata'] {
    // add timestamps to metadata
    const currentTime = dateToStringNoMS(new Date())

    const newMetadata = {
      ...this.ddo?.metadata,
      ...this.metadata, // TODO: nested data is potentially lost because of overwrite
      created: create ? currentTime : this.ddo?.metadata.created,
      updated: currentTime
    }

    return newMetadata
  }

  private async getDDOServices() {
    // build services with encrypted files
    let builtServices: Service[] = []
    if (this.services.length > 0) builtServices = await this.buildDDOServices()

    // replace all "old" services with new ones, based on the service id
    const newServices =
      this.ddo?.services.map((service) => {
        const newService = builtServices.find(
          (builtService) => builtService.id === service.id
        )
        return newService || service
      }) ||
      // or use only the builtServices if no services existed yet
      builtServices

    return newServices
  }

  private async buildDDO(create: boolean): Promise<DDO> {
    // for initial creation we need to set additional info
    if (create) {
      if (!this.nftAddress || !this.chainId)
        throw new Error(
          'When creating a new DDO, erc721Address and chainId are required.'
        )

      this.id = generateDid(this.nftAddress, this.chainId)
    }

    // build new metadata for ddo
    const newMetadata = this.buildDDOMetadata(create)

    // get all services for ddo
    const newServices = await this.getDDOServices()

    // update ddo with metadata and services
    this.ddo = {
      ...this.ddo,
      id: this.id,
      '@context': this.context,
      nftAddress: this.nftAddress,
      chainId: this.chainId,
      version: this.version,
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
    if (chainId) this.chainId = chainId
    if (erc721Address) this.nftAddress = erc721Address

    return this.buildDDO(create)
  }
}
