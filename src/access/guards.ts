/**
 * What `access()` checks on the resolved asset before it talks to any node or chain: the
 * service exists, it is an `access` service, and `userdata` fits its consumer parameters.
 */
import type { ServiceV5 } from '@oceanprotocol/ddo-js'
import type { AccessConfig } from '../@types/Access.js'
import { getDid, getService, getServiceByType } from '../ddo/read.js'
import { assertConsumerParameters } from '../utils/consumerParameters.js'

const USE_COMPUTE = 'Run a job on it with compute() or freeCompute() instead.'

/**
 * Picks the service `access()` downloads from: `serviceId`, else the asset's first
 * `access` service. Throws when there is none, when it is not an `access` service, or with
 * a `ConsumerParameterError` when `userdata` does not fit its consumer parameters.
 */
export function selectAccessService(
  asset: unknown,
  config: Pick<AccessConfig, 'assetDid' | 'serviceId' | 'userdata'>
): ServiceV5 {
  const { assetDid, serviceId } = config
  const service = serviceId
    ? getService(asset, serviceId)
    : getServiceByType(asset, 'access')

  if (!service)
    throw new Error(
      serviceId
        ? `Asset ${assetDid} has no service with id ${serviceId}.`
        : `Asset ${assetDid} has no 'access' service to download from.${
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

  assertConsumerParameters(service.consumerParameters, config.userdata, {
    did: getDid(asset),
    serviceId: service.id,
    field: 'userdata'
  })

  return service
}
