/**
 * Answers the OpenID4VP 1.0 request of a node with the native SSI module from a walt.id
 * **wallet-api2** (the pontusx identity wallet).
 *
 *   nautilus -> node `ssiInitiate` -> verifier-api2 session, `openid4vp://` request
 *   wallet-api2 preview-handle (resolves the request) -> submit-handle -> verifier-api2
 *   nautilus -> node `ssiStatus` until verified
 *
 * nautilus opens the session and checks the result itself (`PolicySessionResolver`). This
 * provider does the part in between, and trusts none of the request, which for a download
 * comes from the node the publisher chose:
 *
 *   - the request must be an `openid4vp://` URL whose `request_uri` is `https://` (or
 *     `http://` on a loopback host), and point at the node's announced verifier host;
 *   - the preview's `response_uri`, where the presentation is posted, must be on that host;
 *   - every DCQL query the preview offers credentials for must be one the node asked for;
 *   - every `transaction_data` item must be the node's asset-access type and name this
 *     consumer, asset and service;
 *   - only credentials the wallet offered for a query are presented.
 *
 * A request that fails a check is declined (`reject-handle`), so the handle is not left
 * open. Selection is **headless by default**: for every required combination of DCQL
 * queries, the first one the wallet can satisfy, with the first matching credential of
 * each query. Supply `onSelectCredentials` to drive a UI instead.
 */
import type { DcqlQuery } from '../ddo/types.js'
import { debugEnabled, debugRaw } from '../log/debug.js'
import { sanitize, sessionIdRemover } from '../node/messages.js'
import type {
  CredentialChallenge,
  CredentialPreparation,
  CredentialProvider
} from './CredentialProvider.js'
import {
  assertPresentationRequest,
  presentationUrlProblem
} from './requestChecks.js'
import { ASSET_ACCESS_TRANSACTION_DATA_TYPE, requestUriHost } from './ssi.js'
import { CredentialPresentationError } from './WaltIdProvider.js'
import { WaltIdWalletError } from './waltid/client.js'
import {
  type WalletApi2,
  type WalletApi2CredentialOption,
  WalletApi2HttpClient,
  type WalletApi2Preview
} from './waltid/wallet2.js'

/** How much of the wallet's message goes into a `CredentialPresentationError`. */
const MAX_PRESENTATION_ERROR_LENGTH = 500

/** The credentials chosen for a presentation: credential ids by DCQL query id. */
export type CredentialSelection = Record<string, string[]>

export interface WalletApi2CredentialProviderOptions {
  /** Base URL of wallet-api2. Ignored if `wallet` is supplied. */
  walletApi?: string
  /**
   * The account's wallet-api2 session token (a Hanko session JWT on the platform), or a
   * function returning a current one. Required with `walletApi`. Never logged.
   */
  token?: string | (() => string | Promise<string>)
  /** A custom wallet-api2 implementation, e.g. a backend-for-frontend, or for tests. */
  wallet?: WalletApi2
  /**
   * The wallet to present from. By default the organisation's wallet of the consumer's
   * address (`GET /org/wallets`), so the wallet always belongs to the account that pays.
   */
  walletId?: string
  /** The holder DID to sign as. By default wallet-api2's choice for the request. */
  holderDid?: string
  /**
   * The verifier host to expect when the node does not announce one
   * (`status.ssi.verifierPublicHost`). A node that announces one is always checked
   * against its own.
   */
  expectedVerifierHost?: string
  /**
   * Accept a plain `http://` wallet URL or `request_uri` on a host other than a loopback
   * one, e.g. a stack on a private network. Default `false`. Link-local and cloud metadata
   * addresses are refused either way.
   */
  allowInsecureTransport?: boolean
  /**
   * Choose the credentials to present. Gets the wallet's matches by DCQL query and the
   * preview (verifier, `transaction_data`, required combinations, holder); returns
   * credential ids by query id. Only offered credentials are accepted, one per query
   * unless the query allows several. Default: the first satisfiable combination of every
   * requirement, the first match of each query.
   */
  onSelectCredentials?: (
    matches: Record<string, WalletApi2CredentialOption[]>,
    preview: WalletApi2Preview
  ) => Promise<CredentialSelection>
}

export class WalletApi2CredentialProvider implements CredentialProvider {
  private readonly wallet: WalletApi2
  private readonly options: WalletApi2CredentialProviderOptions

  constructor(options: WalletApi2CredentialProviderOptions) {
    if (!options.wallet && !(options.walletApi && options.token))
      throw new Error(
        'WalletApi2CredentialProvider needs a walletApi URL and its session token, or a wallet implementation.'
      )

    this.options = options
    this.wallet =
      options.wallet ??
      new WalletApi2HttpClient({
        apiUrl: options.walletApi as string,
        token: options.token as NonNullable<typeof options.token>,
        allowInsecureTransport: options.allowInsecureTransport
      })
  }

  /**
   * Resolves the consumer's wallet before nautilus opens a session at the node, so a wallet
   * account without a wallet for the consumer's address (or a rejected token) fails with
   * `wallet-setup` and no pending session is left behind.
   */
  async prepare(context: CredentialPreparation): Promise<void> {
    await this.walletFor(context.consumerAddress)
  }

  async present(challenge: CredentialChallenge): Promise<void> {
    if (challenge.protocol !== 'oid4vp')
      throw new CredentialPresentationError(
        `${challenge.node.nodeUri} has a policy server, whose presentation requests walt.id's wallet-api2 cannot answer. Use a WaltIdCredentialProvider.`,
        undefined,
        'request-invalid'
      )

    const requestUri = challenge.redirectUri
    assertPresentationRequest(
      requestUri,
      this.options.allowInsecureTransport === true
    )

    const verifierHost = (
      challenge.verifierHost ?? this.options.expectedVerifierHost
    )?.toLowerCase()
    const requestHost = requestUriHost(requestUri)
    if (verifierHost && requestHost !== verifierHost)
      throw new CredentialPresentationError(
        `The presentation request points at ${requestHost ?? 'no request_uri'}, not at the node's verifier (${verifierHost}).`,
        undefined,
        'request-invalid'
      )

    const walletId = await this.walletFor(challenge.consumerAddress)
    const remove = sessionIdRemover(challenge.sessionId)

    let opened: Awaited<ReturnType<WalletApi2['previewPresentation']>>
    try {
      opened = await this.wallet.previewPresentation(walletId, {
        requestUrl: requestUri,
        ...(this.options.holderDid ? { did: this.options.holderDid } : {})
      })
    } catch (error) {
      throw walletError(
        'The wallet could not read the presentation request',
        error,
        remove
      )
    }

    const { handle, preview } = opened
    const decline = async (errorCode: string, error: Error): Promise<never> => {
      await this.wallet
        .rejectPresentation(walletId, { handle, errorCode })
        .catch((rejectError) => {
          if (debugEnabled('sensitive', 'wallet'))
            debugRaw('wallet', 'reject-handle failed', rejectError)
        })
      throw error
    }

    if (!preview.valid)
      return decline(
        preview.error?.code ?? 'invalid_request',
        new CredentialPresentationError(
          `The wallet refused the presentation request (${preview.error?.code ?? 'invalid_request'}${preview.error?.message ? `: ${remove(sanitize(remove(preview.error.message), MAX_PRESENTATION_ERROR_LENGTH, null))}` : ''}).`,
          preview.error ? { errorCode: preview.error.code } : undefined,
          'request-invalid'
        )
      )

    const problem = requestProblem(
      preview,
      challenge,
      verifierHost,
      this.options.allowInsecureTransport === true
    )
    if (problem)
      return decline(
        'invalid_request',
        new CredentialPresentationError(problem, undefined, 'request-invalid')
      )

    const matches: Record<string, WalletApi2CredentialOption[]> = {}
    for (const option of preview.credentialOptions) {
      const list = matches[option.queryId] ?? []
      list.push(option)
      matches[option.queryId] = list
    }

    let selection: CredentialSelection
    if (this.options.onSelectCredentials) {
      selection = await this.options.onSelectCredentials(matches, preview)
      const invalid = selectionProblem(selection, matches)
      if (invalid)
        return decline(
          'access_denied',
          new CredentialPresentationError(invalid, undefined, 'none-selected')
        )
    } else {
      const chosen = defaultSelection(preview, matches, challenge.dcql)
      if ('missing' in chosen)
        return decline(
          'access_denied',
          new CredentialPresentationError(
            `The wallet holds no credentials for ${chosen.missing.map((ids) => ids.join(' + ')).join(', or ')}, which the presentation requires.`,
            { missing: chosen.missing },
            'no-matching-credential'
          )
        )
      selection = chosen.selection
    }

    const selectedCredentialOptions = Object.entries(selection).flatMap(
      ([queryId, ids]) => ids.map((credentialId) => ({ queryId, credentialId }))
    )
    if (!selectedCredentialOptions.length)
      return decline(
        'access_denied',
        new CredentialPresentationError(
          'No credentials were selected to present.',
          undefined,
          'none-selected'
        )
      )

    const sdQueries = new Set(
      challenge.dcql?.credentials
        .filter((query) => query?.format === 'dc+sd-jwt')
        .map((query) => query.id)
    )
    const boundQueries = new Set(
      preview.transactionData.flatMap((item) => item.credentialQueryIds ?? [])
    )
    for (const { queryId, credentialId } of selectedCredentialOptions) {
      const isSdJwt =
        sdQueries.has(queryId) ||
        matches[queryId].some(
          (option) =>
            option.credentialId === credentialId &&
            option.format === 'dc+sd-jwt'
        )
      if (isSdJwt && !boundQueries.has(queryId))
        return decline(
          'invalid_request',
          new CredentialPresentationError(
            `The selected dc+sd-jwt query "${queryId.slice(0, 64)}" has no asset-access transaction data.`,
            undefined,
            'request-invalid'
          )
        )
    }

    const keyId = preview.holder?.keyId ?? preview.keyId
    let result: Awaited<ReturnType<WalletApi2['submitPresentation']>>
    try {
      result = await this.wallet.submitPresentation(walletId, {
        handle,
        selectedCredentialOptions,
        ...(keyId ? { keyId } : {}),
        ...(preview.holder ? { did: preview.holder.did } : {})
      })
    } catch (error) {
      throw walletError(
        'The wallet could not present the credentials',
        error,
        remove
      )
    }

    if (result.transmissionSuccess === false)
      throw new CredentialPresentationError(
        'The verifier rejected the presentation.',
        undefined,
        'verifier-rejected'
      )
  }

  /** Wallet ids already resolved, by lower-cased address. */
  private readonly wallets = new Map<string, string>()

  /** The wallet to present from: the pinned one, or the organisation's for `address`. */
  private async walletFor(address: string): Promise<string> {
    if (this.options.walletId) return this.options.walletId
    const known = this.wallets.get(address.toLowerCase())
    if (known) return known

    let wallets: Awaited<ReturnType<WalletApi2['listWallets']>>
    try {
      wallets = await this.wallet.listWallets()
    } catch (error) {
      throw new CredentialPresentationError(
        `Could not list the organisation's wallets (${error instanceof Error ? error.message : String(error)}). Pass walletId to pick one.`,
        undefined,
        'wallet-setup'
      )
    }

    const own = wallets.find(
      (wallet) => wallet.address?.toLowerCase() === address.toLowerCase()
    )
    if (!own)
      throw new CredentialPresentationError(
        `The wallet account has no wallet for ${address}, the address the session is bound to. Link the address in the wallet, or pass the walletId of that address's wallet.`,
        undefined,
        'wallet-setup'
      )

    this.wallets.set(address.toLowerCase(), own.walletId)
    return own.walletId
  }
}

/**
 * What is wrong with a preview, or `undefined`: a `response_uri` off the verifier host, a
 * credential offered for a query the node did not ask for, or `transaction_data` the node
 * did not attach for this consumer, asset and service.
 */
function requestProblem(
  preview: WalletApi2Preview,
  challenge: CredentialChallenge,
  verifierHost: string | undefined,
  allowInsecure: boolean
): string | undefined {
  if (preview.responseUri !== undefined) {
    const problem = presentationUrlProblem(
      preview.responseUri,
      'response_uri',
      allowInsecure
    )
    if (problem) return problem
  }
  if (verifierHost) {
    let responseHost: string | undefined
    try {
      responseHost = preview.responseUri
        ? new URL(preview.responseUri).host.toLowerCase()
        : undefined
    } catch {
      responseHost = undefined
    }
    if (responseHost !== verifierHost)
      return `The presentation would be posted to ${responseHost ?? 'no response_uri'}, not to the node's verifier (${verifierHost}).`
  }

  const asked = queryIds(challenge.dcql)
  if (asked) {
    const unasked = [
      ...preview.credentialOptions.map((option) => option.queryId),
      ...preview.credentialRequirements.flatMap((requirement) =>
        requirement.options.flat()
      )
    ].find((id) => !asked.has(id))
    if (unasked !== undefined)
      return `The presentation request asks for the credential query "${unasked.slice(0, 64)}", which the node's session does not.`
  }

  for (const item of preview.transactionData) {
    const details = { ...(item.rawJson ?? {}), ...(item.details ?? {}) }
    if (item.type !== ASSET_ACCESS_TRANSACTION_DATA_TYPE)
      return `The presentation request carries transaction data of an unknown type (${String(item.type).slice(0, 100)}).`
    const consumer = details.consumer_address
    if (
      typeof consumer !== 'string' ||
      consumer.toLowerCase() !== challenge.consumerAddress.toLowerCase()
    )
      return `The presentation request is bound to another account (${String(consumer).slice(0, 42)}), not to ${challenge.consumerAddress}.`
    if (details.document_id !== challenge.asset.id)
      return 'The presentation request is bound to another asset.'
    if (details.service_id !== challenge.serviceId)
      return 'The presentation request is bound to another service.'
  }

  return undefined
}

/** The ids of a DCQL query's credential queries, or `undefined` without one. */
function queryIds(dcql: DcqlQuery | undefined): Set<string> | undefined {
  if (!dcql || !Array.isArray(dcql.credentials)) return undefined
  return new Set(
    dcql.credentials
      .map((credential) => credential?.id)
      .filter((id): id is string => typeof id === 'string')
  )
}

/** Why a selection cannot be presented, or `undefined`. */
function selectionProblem(
  selection: unknown,
  matches: Record<string, WalletApi2CredentialOption[]>
): string | undefined {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection))
    return 'onSelectCredentials must return credential ids by DCQL query id.'

  for (const [queryId, ids] of Object.entries(selection)) {
    const offered = Object.hasOwn(matches, queryId)
      ? matches[queryId]
      : undefined
    if (!offered || !Array.isArray(ids))
      return `onSelectCredentials chose credentials for "${queryId.slice(0, 64)}", for which the wallet offered none.`
    if (
      !ids.every((id) => offered.some((option) => option.credentialId === id))
    )
      return `onSelectCredentials chose a credential the wallet did not offer for "${queryId.slice(0, 64)}".`
    if (ids.length > 1 && !offered.some((option) => option.multiple))
      return `The query "${queryId.slice(0, 64)}" takes one credential.`
  }

  return undefined
}

/**
 * The default selection: every required combination satisfied with its first option the
 * wallet holds credentials for, the first match of each of its queries. Without listed
 * requirements, every query of the DCQL query (or every query with matches) is required.
 */
function defaultSelection(
  preview: WalletApi2Preview,
  matches: Record<string, WalletApi2CredentialOption[]>,
  dcql: DcqlQuery | undefined
): { selection: CredentialSelection } | { missing: string[][] } {
  const requirements = preview.credentialRequirements.length
    ? preview.credentialRequirements
    : [
        {
          options: [
            [...(queryIds(dcql) ?? new Set(Object.keys(matches)))]
          ].filter((option) => option.length > 0)
        }
      ]

  const selection: CredentialSelection = {}
  const missing: string[][] = []

  for (const requirement of requirements) {
    const option = requirement.options.find((ids) =>
      ids.every((id) => matches[id]?.length)
    )
    if (!option) {
      missing.push(...requirement.options)
      continue
    }
    for (const id of option) selection[id] ??= [matches[id][0].credentialId]
  }

  return missing.length ? { missing } : { selection }
}

/** A wallet-api2 failure as a `CredentialPresentationError` (`wallet-failed`). */
function walletError(
  what: string,
  error: unknown,
  remove: (text: string) => string
): CredentialPresentationError {
  if (error instanceof CredentialPresentationError) return error
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown error')
  const errorMessage = remove(
    sanitize(remove(message), MAX_PRESENTATION_ERROR_LENGTH, null)
  )
  const status = error instanceof WaltIdWalletError ? error.status : undefined

  return new CredentialPresentationError(
    `${what}: ${errorMessage}`,
    { errorMessage, ...(status ? { status } : {}) },
    status === 401 || status === 403 ? 'wallet-setup' : 'wallet-failed'
  )
}
