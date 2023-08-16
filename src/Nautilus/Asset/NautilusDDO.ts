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
  metadata: Partial<MetadataConfig> = {}
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

  private async buildDDOServices(): Promise<Service[]> {
    if (this.services.length < 1)
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
    // take ddo.services
    const newServices: Service[] = this.ddo?.services || []

    if (this.services.length < 1) return newServices

    // build new services if needed
    const builtServices = await this.buildDDOServices()

    // for all existing services, check if a replacement is needed
    newServices.map((service) => {
      const newlyBuiltServiceIndex = builtServices.findIndex(
        (builtService) => builtService.id === service.id
      )

      if (newlyBuiltServiceIndex > -1) {
        // remove this service from built service array
        // so we only add new services later on
        const newlyBuiltService = builtServices.splice(
          newlyBuiltServiceIndex,
          1
        )[0]

        // replace existing service with the new one
        return newlyBuiltService
      }

      // return old service if nothing found to replace with
      return service
    })

    // add all new services from builtServices array
    return newServices.concat(builtServices)
  }

  private async buildDDO(create: boolean): Promise<DDO> {
    // for initial creation we need to set additional info
    if (create) {
      if (!this.nftAddress || !this.chainId)
        throw new Error(
          'When creating a new DDO, nftAddress and chainId are required.'
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
    createDDOData: {
      create: boolean
      chainId?: number
      nftAddress?: string
    } = {
      create: false
    }
  ): Promise<DDO> {
    const { create, chainId, nftAddress } = createDDOData

    if (chainId) this.chainId = chainId
    if (nftAddress) this.nftAddress = nftAddress

    // first check that all necessary properties can be built when creating
    if (create && !this.hasAllRequiredOceanDDOAttributes())
      throw new Error(
        'Required attributes are missing to create a valid Ocean DDO'
      )

    return this.buildDDO(create)
  }

  hasAllRequiredOceanDDOAttributes() {
    // if we have a valid ddo baseline, all properties can be derived from there
    if (this.ddo) return true

    // check required first level DDO properties
    if (!this.chainId || !this.nftAddress || !this.context || !this.version)
      return false

    // check required metadata properties
    if (
      !this.metadata.name ||
      !this.metadata.description ||
      !this.metadata.type ||
      !this.metadata.author ||
      !this.metadata.license
    )
      return false

    // for algorithms check if algoMetadata is given and complete
    if (this.metadata.type === 'algorithm')
      if (
        !this.metadata.algorithm ||
        !this.metadata.algorithm.container ||
        !this.metadata.algorithm.container.entrypoint ||
        !this.metadata.algorithm.container.image ||
        !this.metadata.algorithm.container.tag ||
        !this.metadata.algorithm.container.checksum
      )
        return false

    return true
  }
}
