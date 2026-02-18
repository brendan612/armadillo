import crypto from 'node:crypto'

const PLAN_CAPABILITIES = {
  free: [],
  premium: ['cloud.sync', 'cloud.cloud_only', 'vault.storage', 'vault.storage.blobs'],
  enterprise: ['cloud.sync', 'cloud.cloud_only', 'vault.storage', 'vault.storage.blobs', 'enterprise.self_hosted', 'enterprise.org_admin'],
}

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      args[key] = 'true'
      continue
    }
    args[key] = value
    i += 1
  }
  return args
}

function parseTier(value) {
  if (value === 'premium' || value === 'enterprise') return value
  return 'free'
}

function parseCapabilities(value, tier) {
  const fromTier = PLAN_CAPABILITIES[tier] || []
  if (!value) return fromTier
  const explicit = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return Array.from(new Set([...fromTier, ...explicit]))
}

function parseFlags(value) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return {}
    const flags = {}
    for (const [key, rowValue] of Object.entries(parsed)) {
      if (!key || typeof rowValue !== 'boolean') continue
      flags[key] = rowValue
    }
    return flags
  } catch {
    throw new Error('Invalid --flags JSON')
  }
}

function encodePart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

const args = parseArgs(process.argv)
const privateJwkRaw = process.env.ENTITLEMENT_DEV_PRIVATE_JWK || ''

if (!privateJwkRaw) {
  console.error('ENTITLEMENT_DEV_PRIVATE_JWK is required.')
  process.exit(1)
}

let privateJwk
try {
  privateJwk = JSON.parse(privateJwkRaw)
} catch {
  console.error('ENTITLEMENT_DEV_PRIVATE_JWK must be valid JSON.')
  process.exit(1)
}

const tier = parseTier(args.tier || 'free')
const now = Math.floor(Date.now() / 1000)
const ttlDays = Math.max(1, Number(args.days || 30))
const expiresAt = now + Math.floor(ttlDays * 24 * 60 * 60)
const kid = args.kid || privateJwk.kid

if (!kid) {
  console.error('Missing key id: provide --kid or include kid in ENTITLEMENT_DEV_PRIVATE_JWK.')
  process.exit(1)
}

const capabilities = parseCapabilities(args.capabilities || '', tier)
const flags = parseFlags(args.flags)
const payload = {
  iss: args.iss || 'armadillo-dev',
  sub: args.sub || 'dev-user',
  aud: args.aud || 'armadillo',
  iat: now,
  nbf: now - 30,
  exp: expiresAt,
  tier,
  capabilities,
  flags,
}

const header = {
  alg: 'EdDSA',
  typ: 'JWT',
  kid,
}

const encodedHeader = encodePart(header)
const encodedPayload = encodePart(payload)
const signingInput = `${encodedHeader}.${encodedPayload}`
const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' })
const signature = crypto.sign(null, Buffer.from(signingInput), privateKey).toString('base64url')
const token = `${signingInput}.${signature}`

console.log(token)
console.log('')
console.log('Payload:')
console.log(JSON.stringify(payload, null, 2))
