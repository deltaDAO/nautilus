import { describe, expect, it } from 'vitest'
import { redactPointer, redactUrl } from '../../src/remote/redact.js'

const R = '%3Credacted%3E'

describe('redactUrl', () => {
  it('keeps a URL without credentials exactly as given', () => {
    for (const url of [
      'https://ddo.test.invalid/x.json',
      'https://DDO.test.invalid/a%20b/x.json',
      'ftp://ddo.test.invalid:2121/dir/x.json'
    ])
      expect(redactUrl(url)).to.equal(url)
  })

  it('redacts the user name as well as the password', () => {
    expect(redactUrl('ftp://user:hunter2@ddo.test.invalid/x.json')).to.equal(
      `ftp://${R}:${R}@ddo.test.invalid/x.json`
    )
    // A token as the user name alone, GitHub-style.
    expect(redactUrl('https://ghp_secret@ddo.test.invalid/x.json')).to.equal(
      `https://${R}@ddo.test.invalid/x.json`
    )
  })

  it('redacts every query value, whatever the parameter is called, and keeps the names', () => {
    const signed =
      'https://bucket.s3.test.invalid/ddo/x.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20261007&X-Amz-Signature=deadbeef'
    expect(redactUrl(signed)).to.equal(
      `https://bucket.s3.test.invalid/ddo/x.json?X-Amz-Algorithm=${R}&X-Amz-Credential=${R}&X-Amz-Signature=${R}`
    )

    // Azure SAS, a plain token, a name nautilus has no list entry for.
    expect(
      redactUrl(
        'https://a.blob.test.invalid/c/x.json?sv=2024&sig=abc%2B&token=t&ddo_auth=zzz'
      )
    ).to.equal(
      `https://a.blob.test.invalid/c/x.json?sv=${R}&sig=${R}&token=${R}&ddo_auth=${R}`
    )
  })

  it('replaces a nameless query part whole, and leaves empty values alone', () => {
    expect(
      redactUrl(
        'https://ddo.test.invalid/x.json?sk_live_123&download=&&a=1;b=2'
      )
    ).to.equal(`https://ddo.test.invalid/x.json?${R}&download=&&a=${R}`)
  })

  it('redacts the fragment', () => {
    expect(
      redactUrl('https://ddo.test.invalid/x.json#access_token=secret')
    ).to.equal(`https://ddo.test.invalid/x.json#${R}`)
  })

  it('redacts a string that is not a URL whole', () => {
    expect(redactUrl('ddo.test.invalid/x.json?token=secret')).to.equal(
      '<redacted>'
    )
  })
})

describe('redactPointer', () => {
  it('redacts a url pointer and leaves the original untouched', () => {
    const pointer = {
      type: 'url',
      url: 'https://user:pw@ddo.test.invalid/x.json?token=t#frag',
      method: 'GET',
      headers: { Authorization: 'Bearer t' }
    }
    const before = JSON.stringify(pointer)

    expect(redactPointer(pointer as never)).to.deep.equal({
      type: 'url',
      url: `https://${R}:${R}@ddo.test.invalid/x.json?token=${R}#${R}`,
      method: 'GET',
      headers: { Authorization: '<redacted>' }
    })
    expect(JSON.stringify(pointer)).to.equal(before)
  })

  it('keeps what S3RemoteStore.remove() needs, and IPFS pointers as they are', () => {
    const s3 = {
      type: 's3',
      s3Access: {
        endpoint: 'https://sos-de-fra-1.exo.io',
        region: 'de-fra-1',
        bucket: 'ddos',
        objectKey: 'ddo/abc/def.json',
        accessKeyId: 'EXO-read',
        secretAccessKey: 'read-secret',
        forcePathStyle: false
      }
    }

    expect(redactPointer(s3 as never)).to.deep.equal({
      ...s3,
      s3Access: { ...s3.s3Access, secretAccessKey: '<redacted>' }
    })

    const ipfs = {
      type: 'ipfs',
      hash: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    }
    expect(redactPointer(ipfs as never)).to.deep.equal(ipfs)
  })
})
