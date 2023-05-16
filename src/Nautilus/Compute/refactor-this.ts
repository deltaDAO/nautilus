// // Fetch previously published algorithm
// const aquarius = new Aquarius(nautilus.getOceanConfig().metadataCacheUri)
// const algorithmDdo = await aquarius.waitForAqua(computeAlgorithmDid)

// // Compute published algorithm checksums
// // https://docs.oceanprotocol.com/core-concepts/did-ddo#compute-options
// const algoFileInfo = await ProviderInstance.checkDidFiles(
//   algorithmDdo.id,
//   algorithmDdo.services[0].id,
//   providerUri,
//   true
// )
// const filesChecksum = algoFileInfo?.[0]?.checksum

// const containerChecksum =
//   algorithmDdo.metadata.algorithm.container.entrypoint +
//   algorithmDdo.metadata.algorithm.container.checksum
// const containerSectionChecksum = getHash(containerChecksum)

// const trustedAlgorithm = {
//   did: algorithmDdo.id,
//   containerSectionChecksum,
//   filesChecksum
// }
