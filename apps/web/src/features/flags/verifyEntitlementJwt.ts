import type { CapabilityKey, EntitlementClaims, RolloutFlagMap } from '../../types/entitlements'
import { isCapabilityKey, normalizeTier } from './registry'

export const ENTITLEMENT_AUDIENCE = 'armadillo'
const CLOCK_SKEW_SECONDS = 5 * 60

type VerifyOk = {
  ok: true
  claims: EntitlementClaims
  header: { kid: string; alg: string }
}

type VerifyErr = {
  ok: false
  code: 'format' | 'jwks_missing' | 'kid_missing' | 'kid_unknown' | 'alg_invalid' | 'signature' | 'claims' | 'expired'
  reason: string
}

export type VerifyEntitlementResult = VerifyOk | VerifyErr

type JwkKey = JsonWebKey & { kid?: string; alg?: string; kty?: string; crv?: string }

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const raw = globalThis.atob(padded)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i)
  }
  return bytes
}

function decodeJsonPart<T>(input: string): T | null {
  try {
    const bytes = decodeBase64Url(input)
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

function parseJwksFromEnv(): JwkKey[] {
  const raw = (import.meta.env.VITE_ENTITLEMENT_JWKS || '').trim()
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as { keys?: JwkKey[] } | JwkKey[]
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.keys)) return parsed.keys
  } catch {
    return []
  }
  return []
}

function normalizeCapabilities(input: unknown): CapabilityKey[] {
  if (!Array.isArray(input)) return []
  const deduped = new Set<CapabilityKey>()
  for (const value of input) {
    if (!isCapabilityKey(value)) continue
    deduped.add(value)
  }
  return Array.from(deduped)
}

function normalizeFlags(input: unknown): RolloutFlagMap {
  const flags: RolloutFlagMap = {}
  if (!input || typeof input !== 'object') return flags
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!key || typeof value !== 'boolean') continue
    flags[key] = value
  }
  return flags
}

function parseClaims(input: unknown): EntitlementClaims | null {
  if (!input || typeof input !== 'object') return null
  const row = input as Record<string, unknown>
  const iss = typeof row.iss === 'string' ? row.iss : ''
  const sub = typeof row.sub === 'string' ? row.sub : ''
  const aud = typeof row.aud === 'string' || Array.isArray(row.aud) ? row.aud : ''
  const iat = Number(row.iat)
  const nbf = row.nbf === undefined ? undefined : Number(row.nbf)
  const exp = Number(row.exp)
  const tier = normalizeTier(row.tier)

  if (!iss || !sub || !aud || !Number.isFinite(iat) || !Number.isFinite(exp)) {
    return null
  }

  return {
    iss,
    sub,
    aud,
    iat,
    ...(Number.isFinite(nbf) ? { nbf } : {}),
    exp,
    tier,
    capabilities: normalizeCapabilities(row.capabilities),
    flags: normalizeFlags(row.flags),
  }
}

function audienceMatches(aud: string | string[]) {
  if (typeof aud === 'string') return aud === ENTITLEMENT_AUDIENCE
  return aud.includes(ENTITLEMENT_AUDIENCE)
}

export async function verifyEntitlementJwt(token: string): Promise<VerifyEntitlementResult> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { ok: false, code: 'format', reason: 'Token must contain three sections' }
  }

  const [encodedHeader, encodedPayload, encodedSig] = parts
  const header = decodeJsonPart<{ kid?: unknown; alg?: unknown }>(encodedHeader)
  if (!header || typeof header.kid !== 'string' || !header.kid) {
    return { ok: false, code: 'kid_missing', reason: 'Token header kid is required' }
  }
  if (header.alg !== 'EdDSA') {
    return { ok: false, code: 'alg_invalid', reason: 'Token alg must be EdDSA' }
  }

  const claims = parseClaims(decodeJsonPart<unknown>(encodedPayload))
  if (!claims) {
    return { ok: false, code: 'claims', reason: 'Token claims are missing or invalid' }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'expired', reason: 'Token has expired' }
  }
  if (!audienceMatches(claims.aud)) {
    return { ok: false, code: 'claims', reason: 'Token audience is invalid' }
  }
  if (claims.nbf !== undefined && claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'claims', reason: 'Token is not active yet' }
  }
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'claims', reason: 'Token issued-at is in the future' }
  }

  const keys = parseJwksFromEnv()
  if (keys.length === 0) {
    return { ok: false, code: 'jwks_missing', reason: 'No entitlement verification keys configured' }
  }

  const jwk = keys.find((key) => key.kid === header.kid)
  if (!jwk) {
    return { ok: false, code: 'kid_unknown', reason: `Unknown key id: ${header.kid}` }
  }

  try {
    const verifierKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      'Ed25519',
      false,
      ['verify'],
    )

    const payloadBytes = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    const sigBytes = decodeBase64Url(encodedSig)
    const valid = await crypto.subtle.verify('Ed25519', verifierKey, sigBytes, payloadBytes)
    if (!valid) {
      return { ok: false, code: 'signature', reason: 'Signature verification failed' }
    }
  } catch {
    return { ok: false, code: 'signature', reason: 'Could not verify entitlement signature' }
  }

  return {
    ok: true,
    header: { kid: header.kid, alg: 'EdDSA' },
    claims,
  }
}
