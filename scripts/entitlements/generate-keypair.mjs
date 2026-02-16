import crypto from 'node:crypto'

function toBase64Url(input) {
  return Buffer.from(input).toString('base64url')
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const kid = toBase64Url(crypto.randomBytes(12))

const publicJwk = publicKey.export({ format: 'jwk' })
const privateJwk = privateKey.export({ format: 'jwk' })

const normalizedPublic = {
  ...publicJwk,
  kid,
  alg: 'EdDSA',
  use: 'sig',
}

const normalizedPrivate = {
  ...privateJwk,
  kid,
  alg: 'EdDSA',
  use: 'sig',
}

const jwks = { keys: [normalizedPublic] }

console.log('Generated Ed25519 keypair for entitlement signing.')
console.log('')
console.log('VITE_ENTITLEMENT_JWKS=' + JSON.stringify(jwks))
console.log('ENTITLEMENT_DEV_PRIVATE_JWK=' + JSON.stringify(normalizedPrivate))
console.log('')
console.log('Public JWK:')
console.log(JSON.stringify(normalizedPublic, null, 2))
console.log('')
console.log('Private JWK:')
console.log(JSON.stringify(normalizedPrivate, null, 2))
