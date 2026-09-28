import { expect } from 'vitest'

/** Asserts an async call rejects, optionally matching the message. */
export async function expectThrowsAsync(
  method: () => Promise<unknown>,
  errorMessage?: string | RegExp
): Promise<void> {
  let error: Error | undefined

  try {
    await method()
  } catch (thrown) {
    error = thrown as Error
  }

  expect(error, 'expected the call to reject, but it resolved').to.be.an(
    'Error'
  )

  if (errorMessage === undefined) return

  if (errorMessage instanceof RegExp)
    expect(error?.message).to.match(errorMessage)
  else expect(error?.message).to.equal(errorMessage)
}
