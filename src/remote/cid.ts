/** IPFS CID shape checks. Kept out of the package's exports. */

/**
 * CIDv0 (`Qm` + 44 base58btc characters) or CIDv1 in base32 (`b…`) or base36 (`k…`). The
 * node joins the hash under `/ipfs/` on its gateway, so anything path-like must not pass.
 */
export function isCid(value: string): boolean {
  return (
    /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value) ||
    /^b[a-z2-7]{20,}$/.test(value) ||
    /^k[0-9a-z]{20,}$/.test(value)
  )
}
