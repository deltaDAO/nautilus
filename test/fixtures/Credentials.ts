export const credentialAddresses = ['0x1234test', '0xtest1234']

export const addressTypeCredential = {
  type: 'address',
  values: credentialAddresses
}

export const addressCredentials = {
  allow: [addressTypeCredential],
  deny: [addressTypeCredential]
}
