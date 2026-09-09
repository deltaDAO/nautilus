import {
  getDatatokenForService,
  getMetadata,
  getOrderPrice,
  getPricingInfo,
  getServiceByType,
  getServices,
  type Nautilus
} from '@deltadao/nautilus'

/**
 * Download examples.
 *
 * `access()` returns an object now, not a bare URL string — so the order backing the download
 * is visible to the caller. It also covers the whole flow: satisfying any credential policy,
 * asking the node for provider fees, reusing or placing an order, and building the URL.
 */

/** Orders the service if needed and prints the download URL. */
export async function access(
  nautilus: Nautilus,
  assetDid: string,
  userdata?: { [key: string]: unknown }
) {
  const result = await nautilus.access({ assetDid, userdata })

  console.log('Download URL:', result.url)
  console.log(`  service:      ${result.serviceId}`)
  console.log(`  order tx:     ${result.transferTxId}`)
  // true means no datatoken was bought: an order from a previous access was still inside
  // the service's timeout.
  console.log(`  reused order: ${result.reusedOrder}`)

  return result
}

/** Orders and actually fetches the data. */
export async function download(nautilus: Nautilus, assetDid: string) {
  const { url } = await nautilus.access({ assetDid })

  const response = await fetch(url)

  if (!response.ok)
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`
    )

  const data = await response.text()

  console.log(`Downloaded ${data.length} bytes`)
  console.log(data.slice(0, 500))

  return data
}

/**
 * Downloads from a specific service.
 *
 * Worth doing when an asset offers more than one — nautilus otherwise takes the first
 * `access` service.
 */
export async function accessSpecificService(
  nautilus: Nautilus,
  assetDid: string
) {
  const asset = await nautilus.getAsset(assetDid)
  const services = getServices(asset)

  console.log(
    `${getMetadata(asset).name} offers ${services.length} service(s):`
  )
  for (const service of services)
    console.log(`  ${service.type.padEnd(8)} ${service.name} (${service.id})`)

  const accessService = getServiceByType(asset, 'access')

  if (!accessService)
    throw new Error(`Asset ${assetDid} has no access service.`)

  const result = await nautilus.access({
    assetDid,
    serviceId: accessService.id
  })

  console.log('Download URL:', result.url)

  return result
}

/**
 * What ordering a service would cost, without ordering it.
 *
 * Pricing comes from chain reads and the DDO's indexed stats. v1 read this from the Ocean
 * subgraph, which the current stack no longer runs.
 */
export async function checkPrice(nautilus: Nautilus, assetDid: string) {
  const asset = await nautilus.getAsset(assetDid)
  const serviceId = getServices(asset)[0].id
  const datatoken = getDatatokenForService(asset, serviceId)

  if (!datatoken)
    throw new Error(
      `Could not determine the datatoken for service ${serviceId}.`
    )

  const config = nautilus.getOceanConfig()
  const pricing = await getPricingInfo(nautilus.getSigner(), datatoken, config)
  const price = await getOrderPrice(nautilus.getSigner(), pricing, config)

  console.log(`Pricing for ${assetDid}`)
  // 'none' means the datatoken has neither a fixed-rate exchange nor a dispenser, so it
  // cannot be ordered at all.
  console.log(`  schema:      ${pricing.schema}`)
  console.log(`  template:    ${pricing.templateId}`)
  console.log(`  base token:  ${pricing.baseTokenAddress ?? '—'}`)
  console.log(`  total:       ${price.total}`)
  console.log(`  market fee:  ${price.publishMarketFee}`)

  return { pricing, price }
}

/** Passes values for a service's consumer parameters. */
export async function accessWithUserdata(nautilus: Nautilus, assetDid: string) {
  const asset = await nautilus.getAsset(assetDid)
  const parameters = getServices(asset)[0].consumerParameters ?? []

  if (parameters.length === 0) {
    console.log('This service declares no consumer parameters.')
  } else {
    console.log('This service expects:')
    for (const parameter of parameters)
      console.log(
        `  ${parameter.name} (${parameter.type}${parameter.required ? ', required' : ''}) default=${parameter.default}`
      )
  }

  const result = await nautilus.access({
    assetDid,
    userdata: { myNumberParam: 8 }
  })

  console.log('Download URL:', result.url)

  return result
}
