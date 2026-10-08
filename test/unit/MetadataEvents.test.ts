/**
 * The same-block conflict check reads the NFT's metadata events in the receipt's block.
 * Everywhere else it is mocked, so this pins the read itself: the log filter, the order of
 * the events, and the topic hashes, against the ERC721 template ABI ocean.js ships and the
 * hashes ocean-node 4.2 subscribes to (`EVENT_HASHES` in `src/utils/constants.ts`).
 */
import { Nft } from '@oceanprotocol/lib'
import {
  type Filter,
  Interface,
  type InterfaceAbi,
  id,
  type Signer,
  Wallet
} from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import {
  getMetadataEventsInBlock,
  METADATA_EVENT_TOPICS
} from '../../src/utils/contracts.js'
import { CHAIN_ID, NFT_ADDRESS } from '../fixtures/Asset.js'

const SIGNATURES = [
  'MetadataCreated(address,uint8,string,bytes,bytes,bytes32,uint256,uint256)',
  'MetadataUpdated(address,uint8,string,bytes,bytes,bytes32,uint256,uint256)'
]

/** As ocean-node 4.2 lists them in `EVENT_HASHES`. */
const OCEAN_NODE_HASHES = [
  '0x5463569dcc320958360074a9ab27e809e8a6942c394fb151d139b5f7b4ecb1bd',
  '0xe5c4cf86b1815151e6f453e1e133d4454ae3b0b07145db39f2e0178685deac84'
]

function signerWithLogs(logs: { transactionHash: string; index: number }[]) {
  const getLogs = vi.fn(async (_filter: Filter) => logs)
  const signer = { provider: { getLogs } } as unknown as Signer

  return { signer, getLogs }
}

describe('METADATA_EVENT_TOPICS', () => {
  it("are the ERC721 template's MetadataCreated and MetadataUpdated topics", () => {
    const abi = new Interface(
      new Nft(
        new Wallet(`0x${'01'.repeat(32)}`),
        CHAIN_ID
      ).getDefaultAbi() as InterfaceAbi
    )

    const fromAbi = ['MetadataCreated', 'MetadataUpdated'].map((name) => {
      const event = abi.getEvent(name)
      if (!event) throw new Error(`the ABI has no ${name} event`)
      return event
    })

    expect(fromAbi.map((event) => event.format('sighash'))).to.deep.equal(
      SIGNATURES
    )
    expect(METADATA_EVENT_TOPICS).to.deep.equal(
      fromAbi.map((event) => event.topicHash)
    )
    expect(METADATA_EVENT_TOPICS).to.deep.equal(
      SIGNATURES.map((text) => id(text))
    )
    expect(METADATA_EVENT_TOPICS).to.deep.equal(OCEAN_NODE_HASHES)
  })
})

describe('getMetadataEventsInBlock', () => {
  it("asks for the NFT's two metadata events in that one block", async () => {
    const { signer, getLogs } = signerWithLogs([])

    await getMetadataEventsInBlock(signer, NFT_ADDRESS, 1234)

    expect(getLogs).toHaveBeenCalledTimes(1)
    expect(getLogs.mock.calls[0][0]).to.deep.equal({
      address: NFT_ADDRESS,
      fromBlock: 1234,
      toBlock: 1234,
      // One topic position holding both: either event matches.
      topics: [OCEAN_NODE_HASHES]
    })
  })

  it('returns the events in log order, whatever order the RPC answers in', async () => {
    const { signer } = signerWithLogs([
      { transactionHash: '0xc', index: 9 },
      { transactionHash: '0xa', index: 2 },
      { transactionHash: '0xb', index: 5 }
    ])

    expect(
      await getMetadataEventsInBlock(signer, NFT_ADDRESS, 1)
    ).to.deep.equal([
      { transactionHash: '0xa', index: 2 },
      { transactionHash: '0xb', index: 5 },
      { transactionHash: '0xc', index: 9 }
    ])
  })

  it('throws for a signer that cannot read logs', async () => {
    await expect(
      getMetadataEventsInBlock({} as Signer, NFT_ADDRESS, 1)
    ).rejects.toThrow(/no provider that can read logs/)
  })
})
