import { expect, it } from 'vitest'
import { AddressSignIn } from '../../src/identity/waltid/addressSignIn.js'
import { GATEWAY, mockGateway, signer } from '../mocks/addressGateway.js'

it('requires a valid proof for logout before revoking the address token', async () => {
  const gateway = mockGateway()
  const signIn = new AddressSignIn({
    gateway: GATEWAY,
    signer: signer().wallet,
    fetchImpl: gateway.fetchImpl as unknown as typeof fetch
  })
  const token = await signIn.getToken()
  for (const dpop of [undefined, 'invalid']) {
    const response = await gateway.fetchImpl(`${GATEWAY}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `DPoP ${token}`,
        ...(dpop ? { DPoP: dpop } : {})
      }
    })
    expect(response.status).to.equal(401)
    expect(gateway.tokens.has(token)).to.equal(true)
    expect(gateway.revoked).to.deep.equal([])
  }
  await signIn.signOut()
  expect(gateway.tokens.has(token)).to.equal(false)
  expect(gateway.revoked).to.deep.equal([token])
})
