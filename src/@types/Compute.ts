import Web3 from 'web3'

export interface ComputeConfigOptions {
  datasetServiceParams?: any
  algorithmServiceParams?: any
  algoCustomData?: any
}

export interface ComputeConfig {
  datasetDid: string
  algorithmDid: string
  web3: Web3
  options?: ComputeConfigOptions
}
