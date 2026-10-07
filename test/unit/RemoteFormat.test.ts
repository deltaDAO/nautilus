/**
 * The stored DDO format, checked against what ocean-node 4.2 actually does with it.
 *
 * nautilus 2.0.0-beta.0 stored the bare signed JWS and hashed its claims. The 4.2 node
 * `JSON.parse`s the stored object, so every asset went on chain and was never indexed —
 * and the unit suite could not tell, because nothing in it modelled the node.
 *
 * `indexAsOceanNode42` below does: it replays the node's steps from a MetadataCreated
 * event to a DDO it would store, transcribed from OceanProtocolEnterprise/ocean-node
 * v4.2.1 (the indexer is the same in 4.2.0). Only the ECIES key and the storage fetch are
 * stand-ins. If `prepareMetadata` produces something this rejects, the node rejects it too.
 */
import { createHash } from 'node:crypto'
import type { StorageObject } from '@oceanprotocol/lib'
import { getAddress, getBytes, toUtf8String, Wallet } from 'ethers'
import { describe, expect, it } from 'vitest'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { expectedDid, readMetadataState } from '../../src/publish/envelope.js'
import {
  prepareMetadata,
  prepareMetadataForWrite,
  writeMetadata
} from '../../src/publish/index.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import { Eip191VcSigner } from '../../src/signing/vc.js'
import {
  ASSET_DID,
  CHAIN_ID,
  getAssetFixture,
  NFT_ADDRESS
} from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'
import { createNodeMock, MOCK_HEADER, mockDecrypt } from '../mocks/node.js'

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'

const CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

// #region the node, transcribed

/** `utils/crypt.ts` `create256Hash`. */
function create256Hash(input: string): string {
  return `0x${createHash('sha256').update(input).digest('hex')}`
}

/** `core/utils/validateDdoHandler.ts` `isRemoteDDO`. */
function isRemoteDDO(ddo: unknown): boolean {
  let keys: string[]
  try {
    keys = Object.keys(ddo as object)
  } catch {
    return false
  }

  return keys.length === 1 && keys[0] === 'remote'
}

/** ddo-js `V5DDO.makeDid`, which the indexer compares the decrypted `id` against. */
function makeDid(nftAddress: string, chainId: number): string {
  return `did:ope:${createHash('sha256')
    .update(getAddress(nftAddress) + chainId.toString(10))
    .digest('hex')}`
}

/** `BaseProcessor.getDataFromProof`. Note it decodes base64url segments as `'base64'`. */
function getDataFromProof(proof: string) {
  const data = proof.split('.')

  if (data.length > 2) {
    const header = JSON.parse(Buffer.from(data[0], 'base64').toString('utf-8'))
    let ddoObj = JSON.parse(Buffer.from(data[1], 'base64').toString('utf-8'))
    if (ddoObj.vc) ddoObj = ddoObj.vc

    return { header, ddoObj, signature: data[2] }
  }

  return null
}

interface MetadataEvent {
  /** `args[3]`, the flags. */
  flags: number
  /** `args[4]`, the metadata bytes written on chain. */
  metadata: string
  /** `args[5]`, the metadata hash. */
  metadataHash: string
}

interface NodeStandIns {
  /** `KeyManager.decrypt(bytes, ECIES)`. */
  decrypt: (ciphertext: Uint8Array) => string
  /** `Storage.getStorageClass(pointer).getReadableStream()`, read to a string. */
  fetchRemote: (pointer: StorageObject) => string
}

/**
 * ocean-node 4.2 from a MetadataCreated event to the DDO it would store.
 *
 * Throws where the node gives up, with the node's message. SHACL runs later, at the
 * database write, and has its own suite (`Validation.test.ts`).
 */
function indexAsOceanNode42(
  event: MetadataEvent,
  nft: { address: string; chainId: number },
  node: NodeStandIns
) {
  /**
   * `core/handler/ddoHandler.ts` `DecryptDdoHandler.handle`, steps 7–9. The transaction
   * path reads flags, document and hash from the receipt (step 5); the direct path takes
   * them from the request. Both continue here.
   */
  function decryptHandler(
    encryptedDocument: string,
    flags: number,
    documentHash?: string
  ): string {
    // Step 7 (`ddoHandler.ts:391-403`): ECIES only with flags & 2. The other branch
    // lzma-decompresses an undefined buffer, so it always fails.
    if ((flags & 2) === 0)
      throw new Error('Decrypt DDO: Failed to lzma decompress')

    let decryptedDocument: string
    try {
      decryptedDocument = node.decrypt(getBytes(encryptedDocument))
    } catch {
      throw new Error('Decrypt DDO: Failed to decrypt')
    }

    // Step 8 (`ddoHandler.ts:438-447`): `checkId`, then `isRemoteDDO`.
    const ddo = JSON.parse(decryptedDocument)
    if (ddo.id && ddo.id !== makeDid(nft.address, nft.chainId))
      throw new Error('Decrypt DDO: did does not match')

    const ddoObject = JSON.parse(decryptedDocument)

    // Step 9 (`ddoHandler.ts:451-455`): a remote pointer is resolved without a consumer
    // address and streamed back unparsed, with no checksum.
    if (isRemoteDDO(ddoObject)) return node.fetchRemote(ddoObject.remote)

    if (documentHash && create256Hash(decryptedDocument) !== documentHash)
      throw new Error('Decrypt DDO: checksum does not match')

    return decryptedDocument
  }

  /**
   * Step 10, `BaseProcessor.decryptDDO` HTTP branch (`BaseProcessor.ts:371-383, 427-439`):
   * parse the body like axios, hash `JSON.stringify` of the parsed object, compare.
   */
  function decryptDDO(metadata: string, flag: number, metadataHash: string) {
    try {
      const rawBody = decryptHandler(metadata, flag, metadataHash || undefined)

      let data: unknown = rawBody
      try {
        data = JSON.parse(rawBody)
      } catch {
        // not JSON, kept as the raw string
      }

      let ddo: Record<string, unknown>
      let responseHash: string
      if (data instanceof Object) {
        responseHash = create256Hash(JSON.stringify(data))
        ddo = data as Record<string, unknown>
      } else {
        ddo = JSON.parse(data as string)
        responseHash = create256Hash(ddo as unknown as string)
      }

      if (metadataHash && responseHash !== metadataHash)
        throw new Error(
          `Hash check failed: decrypted ddo hash=${responseHash} metadata hash=${metadataHash}`
        )

      return ddo
    } catch (error) {
      throw new Error(
        `Provider exception on decrypt DDO. Status: ${(error as Error).message}`
      )
    }
  }

  /** `BaseProcessor.checkDdoHash`, used on the unencrypted path only. */
  function checkDdoHash(document: unknown, hashFromContract: string): boolean {
    const documentString = JSON.stringify(document)
    const expectedMetadata = `0x${Buffer.from(documentString).toString('hex')}`

    return [
      create256Hash(expectedMetadata),
      create256Hash(documentString)
    ].includes(hashFromContract)
  }

  /** `MetadataEventProcessor.isDDO`. */
  function isDDO(data: unknown): data is Record<string, unknown> {
    const record = data as Record<string, unknown>
    return Boolean(
      data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        typeof record.id === 'string' &&
        typeof record.version === 'string'
    )
  }

  // `MetadataEventProcessor.processEvent`, in the node's order. Step 3: the decrypt call.
  const decrypted = decryptDDO(event.metadata, event.flags, event.metadataHash)
  const isEncryptedMetadata = (event.flags & 2) !== 0

  // Step 11 (`MetadataEventProcessor.ts:135-137, 520-530`): `processDDO` follows a stored
  // `{ remote }` one more hop. The envelope is not one, so this is the stored object.
  let ddo: Record<string, unknown> = isRemoteDDO(decrypted)
    ? JSON.parse(node.fetchRemote(decrypted.remote as StorageObject))
    : decrypted

  if (!isEncryptedMetadata && !checkDdoHash(ddo, event.metadataHash))
    throw new Error('DDO checksum does not match.')

  let proofParts: ReturnType<typeof getDataFromProof> = null

  if (ddo.encryptedData) {
    let { encryptedData } = ddo

    // Step 12 (`MetadataEventProcessor.ts:141-165`): the second decrypt, no tx, no hash.
    // On failure the node silently keeps the stored value as plaintext.
    if (isEncryptedMetadata) {
      try {
        const decryptedIpfsPayload = decryptDDO(
          ddo.encryptedData as string,
          event.flags,
          ''
        )
        encryptedData = decryptedIpfsPayload.encryptedData || encryptedData
      } catch {
        // logged, then the plaintext fallback
      }
    }

    // Step 13 (`BaseProcessor.ts:609-621`, `decryptDDOIPFS`): getBytes → utf8 → JSON.parse.
    const proof = JSON.parse(toUtf8String(getBytes(encryptedData as string)))

    // Step 14 (`BaseProcessor.ts:623-637`): split, base64-decode, unwrap `vc`.
    proofParts = typeof proof === 'string' ? getDataFromProof(proof) : null

    const ddoObj = proofParts?.ddoObj || (isDDO(proof) ? proof : null)
    if (!ddoObj)
      throw new Error(
        'IPFS encryptedData payload is neither a DDO nor a supported DDO proof.'
      )

    // Step 15 (`MetadataEventProcessor.ts:173-186`): the signature is kept, not verified.
    ddo =
      proofParts?.signature && proofParts?.header
        ? {
            ...ddoObj,
            proof: {
              signature: proofParts.signature,
              header: proofParts.header
            }
          }
        : ddoObj
  }

  // Step 16 (`MetadataEventProcessor.ts:187-203`): the id must be the NFT's DID.
  const { indexedMetadata: _indexed, ...updatedDdo } = structuredClone(ddo)
  if (updatedDdo.id !== makeDid(nft.address, nft.chainId))
    throw new Error('Decrypted DDO ID does not match generated DID.')

  // `DDOManager.getDDOClass` picks the class by version; nautilus publishes v5 only.
  if (updatedDdo.version !== '5.0.0')
    throw new Error(`Unexpected DDO version ${String(updatedDdo.version)}`)

  return {
    ddo: updatedDdo,
    header: proofParts?.header,
    signature: proofParts?.signature
  }
}

// #endregion

/** A remote store that keeps what it was given, under a fixed CID. */
function capturingStore() {
  const stored: string[] = []

  const store: RemoteStore = {
    async put(payload: string) {
      stored.push(payload)
      return { type: 'ipfs', hash: CID } as StorageObject
    }
  }

  return { store, stored }
}

/** What a published DDO looks like by the time `writeAsset()` signs it. */
function signableDdo(): Record<string, unknown> {
  const { indexedMetadata: _indexed, ...ddo } =
    getAssetFixture() as unknown as Record<string, unknown>

  return { ...ddo, issuer: new Wallet(PRIVATE_KEY).address }
}

async function prepare(store = capturingStore()) {
  const node = createNodeMock()
  const prepared = await prepareMetadata({
    node: node.client,
    ddo: signableDdo(),
    signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
    remoteStore: store.store,
    did: ASSET_DID
  })

  return { prepared, node, stored: store.stored }
}

function standIns(body: string): NodeStandIns {
  return {
    decrypt: (bytes) => mockDecrypt(Buffer.from(bytes).toString('hex')),
    fetchRemote: (pointer) => {
      expect(pointer).to.deep.equal({ type: 'ipfs', hash: CID })
      return body
    }
  }
}

const NFT = { address: NFT_ADDRESS, chainId: CHAIN_ID }

describe('the stored DDO, as ocean-node 4.2 reads it', () => {
  it('indexes what prepareMetadata produces', async () => {
    const { prepared, stored } = await prepare()

    const indexed = indexAsOceanNode42(
      {
        flags: prepared.flags,
        metadata: prepared.metadata,
        metadataHash: prepared.metadataHash
      },
      NFT,
      standIns(stored[0])
    )

    expect(indexed.ddo.id).to.equal(ASSET_DID)
    expect(indexed.ddo.issuer).to.equal(new Wallet(PRIVATE_KEY).address)
    expect(indexed.header).to.deep.equal({ alg: 'ETH-EIP191', typ: 'JWT' })
    // The node keeps the JWS signature as `proof.signature`.
    expect(indexed.signature).to.equal(prepared.credential.jwt.split('.')[2])
  })

  it('hashes exactly the stored envelope', async () => {
    const { prepared, stored } = await prepare()

    expect(stored).to.have.length(1)
    expect(prepared.metadataHash).to.equal(create256Hash(stored[0]))
    // What the node computes after parsing the body.
    expect(prepared.metadataHash).to.equal(
      create256Hash(JSON.stringify(JSON.parse(stored[0])))
    )
    expect(prepared.stored).to.deep.equal({
      pointer: { type: 'ipfs', hash: CID },
      metadataHash: prepared.metadataHash
    })
  })

  it('stores a single string-valued key, so reformatting cannot break the hash', async () => {
    const { prepared, stored } = await prepare()
    const envelope = JSON.parse(stored[0])

    expect(Object.keys(envelope)).to.deep.equal(['encryptedData'])
    expect(envelope.encryptedData).to.be.a('string')

    // A gateway that pretty-prints, or a store that re-serializes, changes nothing.
    const reformatted = `\n${JSON.stringify(envelope, null, 2)}\n`

    expect(() =>
      indexAsOceanNode42(
        {
          flags: prepared.flags,
          metadata: prepared.metadata,
          metadataHash: prepared.metadataHash
        },
        NFT,
        standIns(reformatted)
      )
    ).not.to.throw()
  })

  it('unwraps the envelope to the hex of the JSON-quoted JWS', async () => {
    const { prepared, node } = await prepare()

    // Two node encryptions, envelope content first, then the pointer.
    expect(node.calls.metadataEncrypt).to.have.length(2)

    const [content, pointer] = node.calls.metadataEncrypt as [
      { encryptedData: string },
      unknown
    ]

    expect(toUtf8String(getBytes(content.encryptedData))).to.equal(
      JSON.stringify(prepared.credential.jwt)
    )
    expect(pointer).to.deep.equal({ remote: { type: 'ipfs', hash: CID } })
  })

  it("fails on the node's error for the 2.0.0-beta.0 format", async () => {
    // beta.0 stored the bare JWS and hashed its claims. This is the error the deployed
    // node recorded for every asset it published.
    const { prepared } = await prepare()
    const jws = prepared.credential.jwt

    expect(() =>
      indexAsOceanNode42(
        {
          flags: prepared.flags,
          metadata: prepared.metadata,
          metadataHash: create256Hash(
            Buffer.from(jws.split('.')[1], 'base64url').toString()
          )
        },
        NFT,
        standIns(jws)
      )
    ).to.throw(/is not valid JSON/)
  })

  it('fails the hash check if the store changes the content', async () => {
    const { prepared, stored } = await prepare()
    const tampered = JSON.stringify({ ...JSON.parse(stored[0]), extra: 1 })

    expect(() =>
      indexAsOceanNode42(
        {
          flags: prepared.flags,
          metadata: prepared.metadata,
          metadataHash: prepared.metadataHash
        },
        NFT,
        standIns(tampered)
      )
    ).to.throw(/Hash check failed/)
  })

  it('refuses a node-persistent-storage pointer from a custom store', async () => {
    const store: RemoteStore = {
      put: async () =>
        ({
          type: 'nodePersistentStorage',
          bucketId: 'b',
          fileName: 'f'
        }) as unknown as StorageObject
    }

    await expectThrowsAsync(
      () => prepare({ store, stored: [] }),
      /IpfsRemoteStore/
    )
  })
})

describe('what nautilus may write', () => {
  const putReturning = (pointer: unknown) =>
    prepare({
      store: { put: async () => pointer as StorageObject },
      stored: []
    })

  it('accepts the storage types the node reads, case-insensitively', async () => {
    for (const pointer of [
      { type: 'IPFS', hash: CID },
      { type: 'url', url: 'https://ddo.test.invalid/x.json', method: 'GET' },
      {
        type: 's3',
        s3Access: {
          endpoint: 'https://sos-ch-gva-2.exo.io',
          bucket: 'b',
          objectKey: 'k.json',
          accessKeyId: 'id',
          secretAccessKey: 'secret'
        }
      },
      { type: 'arweave', transactionId: 'tx' },
      { type: 'ftp', url: 'ftp://ddo.test.invalid/x.json' }
    ]) {
      const { node } = await putReturning(pointer)

      // The pointer plaintext is `{ remote }`, exactly one key.
      expect(node.calls.metadataEncrypt[1]).to.deep.equal({ remote: pointer })
      expect(JSON.stringify(node.calls.metadataEncrypt[1])).to.equal(
        JSON.stringify({ remote: pointer })
      )
    }
  })

  it('refuses any other pointer from any store, before encrypting it', async () => {
    for (const [pointer, message] of [
      [
        { type: 'NodePersistentStorage', bucketId: 'b', fileName: 'f' },
        /IpfsRemoteStore/
      ],
      [
        { type: 'gopher', url: 'x' },
        /reads DDOs only from ipfs, url, s3, arweave, ftp/
      ],
      [{ hash: CID }, /pointer of type undefined/],
      [{ type: 'ipfs', hash: CID, remote: {} }, /not a plain storage object/],
      [undefined, /no pointer object/]
    ] as const)
      await expectThrowsAsync(() => putReturning(pointer), message)
  })

  it('derives the DID from the checksummed NFT address and the decimal chain id', () => {
    // ASSET_DID is ddo-js's `makeDid` output for the fixture.
    expect(expectedDid(NFT_ADDRESS.toLowerCase(), CHAIN_ID)).to.equal(ASSET_DID)
  })

  it('never produces a plaintext envelope, so the node fallback is never what works', async () => {
    // Step 12: if the second decrypt fails, the node treats `encryptedData` as plaintext.
    // The stored value must be ciphertext, so that fallback can never yield the DDO.
    const { prepared, stored } = await prepare()
    const { encryptedData } = JSON.parse(stored[0])

    expect(() => JSON.parse(toUtf8String(getBytes(encryptedData)))).to.throw()

    // A node that cannot decrypt the envelope does not index it, fallback or not.
    let decrypts = 0
    expect(() =>
      indexAsOceanNode42(
        {
          flags: prepared.flags,
          metadata: prepared.metadata,
          metadataHash: prepared.metadataHash
        },
        NFT,
        {
          ...standIns(stored[0]),
          decrypt: (bytes) => {
            decrypts += 1
            if (decrypts > 1) throw new Error('wrong node key')
            return mockDecrypt(Buffer.from(bytes).toString('hex'))
          }
        }
      )
    ).to.throw()
    expect(decrypts).to.equal(2)
  })
})

describe('golden envelope', () => {
  /**
   * Fixed inputs, with the expected values computed independently of nautilus from the
   * formula in the module docs. A change to any byte of the format changes the hash.
   */
  const base64url = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  const JWT = [
    base64url({ alg: 'ETH-EIP191', typ: 'JWT' }),
    base64url({
      id: ASSET_DID,
      version: '5.0.0',
      credentialSubject: { id: ASSET_DID }
    }),
    Buffer.from('0xgolden').toString('base64url')
  ].join('.')

  /** The ECIES overhead on ocean-node 4.2: 65 + 16 + 16 bytes, here `0x04` then `0x11`s. */
  const GOLDEN_HEADER = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.alloc(96, 0x11)
  ])

  /** A cipher of its own, so the golden values depend on nothing outside this test. */
  const goldenNode = {
    async encrypt(data: unknown) {
      const bytes = Buffer.from(JSON.stringify(data))
      return `0x${GOLDEN_HEADER.toString('hex')}${Buffer.from(bytes.map((byte) => byte ^ 0xa5)).toString('hex')}`
    }
  } as unknown as OceanNodeClient

  it('produces the expected envelope, hash and pointer', async () => {
    const { store, stored } = capturingStore()

    const prepared = await prepareMetadata({
      node: goldenNode,
      ddo: { id: ASSET_DID, version: '5.0.0' },
      signer: {
        getIssuer: async () => 'golden',
        sign: async () => ({ jwt: JWT, issuer: 'golden' })
      },
      remoteStore: store,
      did: ASSET_DID
    })

    expect(stored[0].length).to.equal(1564)
    expect(
      stored[0].startsWith('{"encryptedData":"0x04111111111111111111')
    ).to.equal(true)
    expect(stored[0].endsWith('91979787d8"}')).to.equal(true)
    expect(prepared.metadataHash).to.equal(
      '0xeff67c5aa9648ac074122e8bb1b0319996df20d941f43faaabf5aeb481a7679c'
    )
    expect(prepared.metadata).to.equal(
      `0x04${'11'.repeat(96)}de87d7c0c8cad1c0879fde87d1dcd5c0879f87ccd5c3d6878987cdc4d6cd879f87c7c4c3ced7c0ccc2cd97c4ceccd6c6c4ccc9c1c6d4c4c7d6dcc296c1c3d793c6cdd096c3c2d5d7c0c2ccdcc8d6c6ce92c092c4d4c491d69097dfdc87d8d8`
    )
    expect(prepared.flags).to.equal(0x02)

    const unxor = (bytes: Uint8Array) =>
      Buffer.from(
        Buffer.from(bytes)
          .subarray(GOLDEN_HEADER.length)
          .map((byte) => byte ^ 0xa5)
      ).toString()

    const indexed = indexAsOceanNode42(
      {
        flags: prepared.flags,
        metadata: prepared.metadata,
        metadataHash: prepared.metadataHash
      },
      NFT,
      { decrypt: unxor, fetchRemote: () => stored[0] }
    )

    expect(indexed.ddo).to.deep.equal({
      id: ASSET_DID,
      version: '5.0.0',
      credentialSubject: { id: ASSET_DID },
      proof: {
        signature: Buffer.from('0xgolden').toString('base64url'),
        header: { alg: 'ETH-EIP191', typ: 'JWT' }
      }
    })
  })
})

describe('encrypted only', () => {
  it('rejects encrypt: false', async () => {
    const node = createNodeMock()

    await expectThrowsAsync(
      () =>
        prepareMetadata({
          node: node.client,
          ddo: signableDdo(),
          signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
          remoteStore: capturingStore().store,
          did: ASSET_DID,
          encrypt: false
        } as never),
      /encrypt: false is not supported/
    )

    expect(node.calls.encrypt).to.have.length(0)
  })

  it('always writes flags 0x02', async () => {
    const { prepared } = await prepare()

    expect(prepared.flags).to.equal(0x02)
  })

  it('puts nothing readable in the store or on chain', async () => {
    const { prepared, stored } = await prepare()
    const { jwt } = prepared.credential
    const [header, claims] = jwt.split('.')
    const hex = (value: string) => Buffer.from(value).toString('hex')

    const pointerJson = JSON.stringify(prepared.pointer)
    const name = 'Test Dataset'

    for (const clear of [jwt, header, claims, name, ASSET_DID])
      expect(stored[0]).not.to.contain(clear)
    for (const clear of [JSON.stringify(jwt), claims, name])
      expect(stored[0]).not.to.contain(hex(clear))

    for (const clear of [CID, pointerJson])
      expect(prepared.metadata).not.to.contain(clear)
    for (const clear of [CID, pointerJson])
      expect(prepared.metadata).not.to.contain(hex(clear))
  })

  describe('writeMetadata', () => {
    const prepareWrite = () =>
      prepareMetadataForWrite({
        node: createNodeMock().client,
        ddo: signableDdo(),
        signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
        remoteStore: capturingStore().store,
        did: ASSET_DID
      })

    type Prepared = Awaited<ReturnType<typeof prepareWrite>>

    const write = (
      prepared: Prepared,
      overrides: Record<string, unknown> = {},
      params: { nodeUri?: string; lifecycleState?: number } = {}
    ) =>
      writeMetadata({
        signer: new Wallet(PRIVATE_KEY),
        chainConfig: { chainId: CHAIN_ID } as never,
        nftAddress: NFT_ADDRESS,
        nodeUri: params.nodeUri ?? 'https://node.test.invalid',
        lifecycleState: params.lifecycleState ?? 0,
        prepared: {
          ...prepared,
          written: { ...prepared.written, ...overrides }
        } as never
      })

    it('refuses flags other than 0x02', async () => {
      await expectThrowsAsync(
        async () => write(await prepareWrite(), { flags: 0 }),
        /flags 0x00/
      )
    })

    it('refuses a plaintext pointer, whatever the flags say', async () => {
      const prepared = await prepareWrite()
      const plaintext = `0x${Buffer.from(prepared.pointerPlaintext).toString('hex')}`

      await expectThrowsAsync(
        () => write(prepared, { metadata: plaintext }),
        /ECIES output is at least/
      )
    })

    it('refuses a DEPRECATED or REVOKED state', async () => {
      const prepared = await prepareWrite()

      for (const lifecycleState of [2, 3])
        await expectThrowsAsync(
          () => write(prepared, {}, { lifecycleState }),
          new RegExp(`lifecycle state ${lifecycleState}`)
        )
    })

    it('refuses to name a node other than the one that encrypted', async () => {
      await expectThrowsAsync(
        async () =>
          write(
            await prepareWrite(),
            {},
            { nodeUri: 'https://other-node.test.invalid' }
          ),
        /encrypted by https:\/\/node.test.invalid/
      )
    })

    it('refuses metadata that is not ciphertext at all', async () => {
      await expectThrowsAsync(
        async () => write(await prepareWrite(), { metadata: '{"remote":{}}' }),
        /0x hex string/
      )
    })
  })
})

describe('known-plaintext guards', () => {
  /**
   * A node (or proxy, or test double) that "encrypts" by echoing its input in some
   * encoding. The security review got each of these past the old "is it JSON" check.
   * `pad` prepends ECIES-sized filler, so the length check alone cannot catch them.
   */
  const ENCODINGS: [string, (plaintext: string) => Buffer][] = [
    [
      'a JSON string literal',
      (plaintext) => Buffer.from(JSON.stringify(plaintext))
    ],
    [
      'BOM + JSON',
      (plaintext) =>
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(plaintext)])
    ],
    [
      'JSON + NUL',
      (plaintext) => Buffer.concat([Buffer.from(plaintext), Buffer.from([0])])
    ],
    [
      'base64',
      (plaintext) => Buffer.from(Buffer.from(plaintext).toString('base64'))
    ],
    ['hex', (plaintext) => Buffer.from(Buffer.from(plaintext).toString('hex'))],
    ['bare echo', (plaintext) => Buffer.from(plaintext)]
  ]

  function echoingNode(
    target: 'envelope' | 'pointer',
    encode: (plaintext: string) => Buffer,
    pad: boolean
  ): OceanNodeClient {
    const real = createNodeMock().client

    return {
      ...real,
      nodeUri: real.nodeUri,
      async encrypt(data: unknown) {
        const isTarget =
          target === 'pointer'
            ? Object.keys(data as object)[0] === 'remote'
            : Object.keys(data as object)[0] === 'encryptedData'

        if (!isTarget) return real.encrypt(data)

        const bytes = encode(JSON.stringify(data))
        return `0x${Buffer.concat([pad ? MOCK_HEADER : Buffer.alloc(0), bytes]).toString('hex')}`
      }
    } as unknown as OceanNodeClient
  }

  const s3Pointer = {
    type: 's3',
    s3Access: {
      endpoint: 'https://sos-ch-gva-2.exo.io',
      bucket: 'b',
      objectKey: 'ddo/k.json',
      accessKeyId: 'READKEY',
      secretAccessKey: 'read-secret-that-must-not-leak',
      forcePathStyle: false
    }
  }

  for (const target of ['pointer', 'envelope'] as const)
    for (const [name, encode] of ENCODINGS)
      for (const pad of [false, true])
        it(`refuses a ${target} "encrypted" as ${name}${pad ? ', padded to ECIES length' : ''}`, async () => {
          const stored: string[] = []

          await expectThrowsAsync(
            () =>
              prepareMetadata({
                node: echoingNode(target, encode, pad),
                ddo: signableDdo(),
                signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
                remoteStore: {
                  async put(payload) {
                    stored.push(payload)
                    return s3Pointer as unknown as StorageObject
                  }
                },
                did: ASSET_DID
              }),
            pad
              ? new RegExp(
                  `Refusing to write the ${target}: what the node returned contains the plaintext`
                )
              : new RegExp(
                  `Refusing to write the ${target}: (the node returned \\d+ bytes|what the node returned contains the plaintext)`
                )
          )

          // A bad envelope never reaches the (world-readable) store.
          if (target === 'envelope') expect(stored).to.have.length(0)
        })

  it('accepts real-sized ciphertext that shares nothing with the plaintext', async () => {
    const { prepared } = await prepare()

    expect(prepared.metadata).to.match(/^0x04/)
  })
})

describe('redaction', () => {
  it('returns the S3 pointer without its secret, and encrypts it with the secret', async () => {
    const pointer = {
      type: 's3',
      s3Access: {
        endpoint: 'https://sos-ch-gva-2.exo.io',
        region: 'ch-gva-2',
        bucket: 'b',
        objectKey: 'ddo/k.json',
        accessKeyId: 'READKEY',
        secretAccessKey: 'read-secret',
        forcePathStyle: false
      }
    }
    const node = createNodeMock()

    const prepared = await prepareMetadataForWrite({
      node: node.client,
      ddo: signableDdo(),
      signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
      remoteStore: { put: async () => pointer as unknown as StorageObject },
      did: ASSET_DID
    })

    const redacted = {
      ...pointer,
      s3Access: { ...pointer.s3Access, secretAccessKey: '<redacted>' }
    }
    expect(prepared.written.stored.pointer).to.deep.equal(redacted)
    expect(prepared.written.pointer).to.deep.equal({ remote: redacted })
    expect(JSON.stringify(prepared.written)).not.to.contain('read-secret')

    // What goes on chain (node-encrypted) still carries the key the node needs.
    expect(JSON.parse(mockDecrypt(prepared.written.metadata))).to.deep.equal({
      remote: pointer
    })
    expect(prepared.storedPointer).to.deep.equal(pointer)
  })

  it('redacts url header values and URL passwords', async () => {
    for (const [pointer, expected] of [
      [
        {
          type: 'url',
          url: 'https://ddo.test.invalid/x.json',
          method: 'GET',
          headers: { Authorization: 'Bearer secret-token' }
        },
        {
          type: 'url',
          url: 'https://ddo.test.invalid/x.json',
          method: 'GET',
          headers: { Authorization: '<redacted>' }
        }
      ],
      [
        { type: 'ftp', url: 'ftp://user:hunter2@ddo.test.invalid/x.json' },
        {
          type: 'ftp',
          url: 'ftp://user:%3Credacted%3E@ddo.test.invalid/x.json'
        }
      ]
    ]) {
      const prepared = await prepareMetadata({
        node: createNodeMock().client,
        ddo: signableDdo(),
        signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
        remoteStore: { put: async () => pointer as unknown as StorageObject },
        did: ASSET_DID
      })

      expect(prepared.stored.pointer).to.deep.equal(expected)
    }
  })
})

describe('what nautilus takes from stores, signers and the chain', () => {
  const base64url = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  it('validates and encrypts one snapshot of the pointer, not the live object', async () => {
    // `type` inherited, so JSON.stringify drops it: what the node would get has no type.
    const inherited = Object.create({ type: 'ipfs' })
    inherited.hash = CID

    await expectThrowsAsync(
      () =>
        prepareMetadata({
          node: createNodeMock().client,
          ddo: signableDdo(),
          signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
          remoteStore: { put: async () => inherited as StorageObject },
          did: ASSET_DID
        }),
      /pointer of type undefined/
    )

    // A getter that changes its answer after the check: the snapshot is what is checked.
    let reads = 0
    const shifty = {
      get type() {
        reads++
        return reads === 1 ? 'ipfs' : 'nodePersistentStorage'
      },
      hash: CID
    }

    await expectThrowsAsync(
      () =>
        prepareMetadata({
          node: createNodeMock().client,
          ddo: signableDdo(),
          signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
          remoteStore: {
            put: async () => shifty as unknown as StorageObject
          },
          did: ASSET_DID
        }),
      /cannot hold a DDO/
    )
  })

  it('refuses a signer that signed a different document', async () => {
    const node = createNodeMock()
    const ddo = signableDdo()
    const signing = (payload: unknown) => ({
      getIssuer: async () => 'x',
      sign: async () => ({
        jwt: `${base64url({ alg: 'ES256' })}.${base64url(payload)}.sig`,
        issuer: 'x'
      })
    })
    const { store, stored } = capturingStore()

    await expectThrowsAsync(
      () =>
        prepareMetadata({
          node: node.client,
          ddo,
          signer: signing({ id: 'did:ope:other', version: '5.0.0' }),
          remoteStore: store,
          did: ASSET_DID
        }),
      /signed a document with id "did:ope:other"/
    )
    await expectThrowsAsync(
      () =>
        prepareMetadata({
          node: node.client,
          ddo,
          signer: {
            getIssuer: async () => 'x',
            sign: async () => ({ jwt: 'not-a-jws', issuer: 'x' })
          },
          remoteStore: store,
          did: ASSET_DID
        }),
      /did not return a compact JWS/
    )
    expect(stored).to.have.length(0)

    // A `vc`-wrapped payload is unwrapped, as the node does.
    await prepareMetadata({
      node: node.client,
      ddo,
      signer: signing({ vc: { id: ddo.id, version: ddo.version } }),
      remoteStore: store,
      did: ASSET_DID
    })
    expect(stored).to.have.length(1)
  })

  it('fails closed when the metadata state cannot be read', async () => {
    for (const answer of [undefined, [], ['uri', '0x0']])
      await expectThrowsAsync(
        () =>
          readMetadataState(
            { getMetadata: async () => answer } as never,
            NFT_ADDRESS
          ),
        /Could not read the metadata state/
      )

    expect(
      await readMetadataState(
        { getMetadata: async () => ['uri', '0x0', 3n, true] } as never,
        NFT_ADDRESS
      )
    ).to.equal(3)
  })
})
