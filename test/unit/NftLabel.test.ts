/**
 * `readNftLabel`: the NFT's ERC721 name and symbol, which a revoke's messages show. Both
 * come from the contract the caller named, so they are untrusted text: sanitised and
 * bounded, and an unreadable one is left out with the RPC's error on the debug channel.
 */
import { AbiCoder, id, type Signer } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import { type DebugEvent, setDebug } from '../../src/log/debug.js'
import { readNftLabel } from '../../src/utils/contracts.js'
import { NFT_ADDRESS } from '../fixtures/Asset.js'
import { FAKE } from '../secretScan.js'

/** A C0/C1 control character or a bidi override. */
const isControlOrBidi = (char: string) => {
  const code = char.codePointAt(0) ?? 0
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x202a && code <= 0x202e)
  )
}

const NAME = id('name()').slice(0, 10)
const SYMBOL = id('symbol()').slice(0, 10)

/** A runner whose `eth_call` answers `name()` and `symbol()` with `answers`, or throws. */
function runner(answers: {
  name?: string | Error
  symbol?: string | Error
}): Signer {
  return {
    provider: null,
    async call(tx: { data: string }) {
      const answer = tx.data.startsWith(NAME)
        ? answers.name
        : tx.data.startsWith(SYMBOL)
          ? answers.symbol
          : undefined
      if (answer instanceof Error) throw answer
      return AbiCoder.defaultAbiCoder().encode(['string'], [answer ?? ''])
    }
  } as unknown as Signer
}

describe('readNftLabel', () => {
  it('sanitises and bounds a hostile name and symbol', async () => {
    const label = await readNftLabel(
      runner({
        name: `\u001b[2J\u001b]0;pwned\u0007My Data‮TES\nBearer ${'a'.repeat(40)} ${FAKE.rpcUrl} ${'x'.repeat(10_000)}`,
        symbol: 'SY\u0000M\r\nB'
      }),
      NFT_ADDRESS
    )

    for (const text of [label.name, label.symbol] as string[]) {
      expect([...text].filter(isControlOrBidi)).to.deep.equal([])
      // 60 characters, and the ellipsis that marks the cut.
      expect(text.length).to.be.at.most(61)
    }
    expect(label.name).to.match(/^My Data/)
    expect(label.name).to.contain('Bearer <redacted>')
    expect(label.name).not.to.contain(FAKE.rpcPathToken)
    expect(label.name).not.to.contain('pwned\u0007')
    expect(label.symbol).to.equal('SY M B')
  })

  it('leaves out a value that cannot be read, with the error on the debug channel', async () => {
    const events: DebugEvent[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    setDebug({
      level: 'sensitive',
      topics: ['rpc'],
      sink: (event) => events.push(event)
    })

    const label = await readNftLabel(
      runner({ name: new Error('execution reverted'), symbol: 'SYM' }),
      NFT_ADDRESS
    )

    expect(label).to.deep.equal({ name: undefined, symbol: 'SYM' })
    const [raw] = events.filter((event) =>
      event.message.includes(`the name of NFT ${NFT_ADDRESS} could not be read`)
    )
    expect(raw.topic).to.equal('rpc')
    expect(JSON.stringify(raw.data)).to.contain('execution reverted')
  })
})
