/**
 * What `access()` checks on the resolved asset before it talks to any node or chain: the
 * service exists, it is an `access` service, and `userdata` fits its consumer parameters.
 * `compute()` picks its services with the same `selectService`.
 */
import type { ServiceV5 } from '@oceanprotocol/ddo-js'
import type { AccessConfig } from '../@types/Access.js'
import { getDid, getService, getServiceByType } from '../ddo/read.js'
import { assertConsumerParameters } from '../utils/consumerParameters.js'

const USE_COMPUTE = 'Run a job on it with compute() or freeCompute() instead.'

/**
 * The service a request names: the one with `serviceId`, else the asset's first service of
 * `type`. Throws when the asset has no service with `serviceId`; returns `undefined` when
 * it has none of `type`, for the caller to say what it needed.
 */
export function selectService(
  asset: unknown,
  did: string,
  serviceId: string | undefined,
  type: string
): ServiceV5 | undefined {
  if (!serviceId) return getServiceByType(asset, type)

  const service = getService(asset, serviceId)
  if (!service)
    throw new Error(`Asset ${did} has no service with id ${serviceId}.`)

  return service
}

/**
 * Picks the service `access()` downloads from: `serviceId`, else the asset's first
 * `access` service, and returns it with the `userdata` to forward (without its `undefined`
 * or `null` entries). Throws when there is no such service, when it is not an `access`
 * service, or with a `ConsumerParameterError` when `userdata` does not fit its consumer
 * parameters.
 */
export function assertAccessRequest(
  asset: unknown,
  config: Pick<AccessConfig, 'assetDid' | 'serviceId' | 'userdata'>
): { service: ServiceV5; userdata: AccessConfig['userdata'] } {
  const { assetDid } = config
  const service = selectService(asset, assetDid, config.serviceId, 'access')

  if (!service)
    throw new Error(
      `Asset ${assetDid} has no 'access' service to download from.${
        getServiceByType(asset, 'compute')
          ? ` It offers a 'compute' service. ${USE_COMPUTE}`
          : ''
      }`
    )

  if (service.type !== 'access')
    throw new Error(
      `Service ${service.id} of ${assetDid} is a '${service.type}' service; access() downloads from an 'access' service only.${
        service.type === 'compute' ? ` ${USE_COMPUTE}` : ''
      }`
    )

  const userdata = assertConsumerParameters(
    service.consumerParameters,
    config.userdata,
    { did: getDid(asset), serviceId: service.id, field: 'userdata' }
  )

  return { service, userdata }
}
