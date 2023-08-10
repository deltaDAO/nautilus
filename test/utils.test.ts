import { expect } from 'chai'

export const expectThrowsAsync = async (
  method: Function,
  errorMessage?: RegExp
) => {
  let error = null
  try {
    await method()
  } catch (err) {
    error = err
  }
  expect(error).to.be.an('Error')

  if (errorMessage) {
    expect(error.message).to.match(errorMessage)
  }
}
