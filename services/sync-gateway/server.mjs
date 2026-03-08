import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.PORT || 8787)
const DATA_FILE = process.env.SYNC_DATA_FILE || path.join(__dirname, 'data.json')
const ENTERPRISE_MODE = String(process.env.SYNC_ENTERPRISE_MODE || 'false').toLowerCase() === 'true'
const STREAM_TOKEN_SECRET = process.env.SYNC_STREAM_TOKEN_SECRET || crypto.randomBytes(32).toString('hex')
const SESSION_TOKEN_SECRET = process.env.SYNC_SESSION_TOKEN_SECRET || STREAM_TOKEN_SECRET
const STREAM_TOKEN_TTL_MS = Number(process.env.SYNC_STREAM_TOKEN_TTL_MS || 2 * 60 * 1000)
const SSE_HEARTBEAT_MS = Number(process.env.SYNC_SSE_HEARTBEAT_MS || 20_000)
const MAX_REQUEST_BYTES = Number(process.env.SYNC_MAX_REQUEST_BYTES || 1024 * 1024)
const MAX_BLOB_FILE_BYTES = Number(process.env.SYNC_MAX_BLOB_FILE_BYTES || 20 * 1024 * 1024)
const MAX_BLOB_TOTAL_BYTES = Number(process.env.SYNC_MAX_BLOB_TOTAL_BYTES || 2 * 1024 * 1024 * 1024)
const MAX_BLOB_REQUEST_BYTES = Number(process.env.SYNC_MAX_BLOB_REQUEST_BYTES || 32 * 1024 * 1024)
const RATE_LIMIT_WINDOW_MS = Number(process.env.SYNC_RATE_LIMIT_WINDOW_MS || 60_000)
const RATE_LIMIT_MAX = Number(process.env.SYNC_RATE_LIMIT_MAX || 300)
const ENTITLEMENT_TOKEN = (process.env.SYNC_ENTITLEMENT_TOKEN || '').trim()
const ENTITLEMENT_VERIFY_JWKS = (process.env.SYNC_ENTITLEMENT_VERIFY_JWKS || '').trim()
const ADMIN_ALLOWLIST_EMAILS = new Set((process.env.SYNC_ADMIN_ALLOWLIST_EMAILS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean))
const ADMIN_ALLOWLIST_SUBJECTS = new Set((process.env.SYNC_ADMIN_ALLOWLIST_SUBJECTS || '').split(',').map((v) => v.trim()).filter(Boolean))
const PLAN_CAPABILITIES = {
  free: [],
  premium: ['cloud.sync', 'cloud.cloud_only', 'vault.storage', 'vault.storage.blobs', 'security.breach_scan'],
  enterprise: ['cloud.sync', 'cloud.cloud_only', 'vault.storage', 'vault.storage.blobs', 'security.breach_scan', 'enterprise.self_hosted', 'enterprise.org_admin'],
}
const DEFAULT_FLAGS = {
  'billing.plans_section': true,
  'billing.manual_token_entry': true,
  'experiments.enterprise_team_ui': false,
  'experiments.storage_tab': true,
}

const defaultCorsOrigins = ['http://localhost:4000', 'http://127.0.0.1:4000']
const corsOrigins = (process.env.SYNC_CORS_ORIGINS || defaultCorsOrigins.join(',')).split(',').map((v) => v.trim()).filter(Boolean)
const roleRank = { viewer: 1, editor: 2, admin: 3, owner: 4 }
const metrics = { requestsTotal: 0, authFailuresTotal: 0, pushConflictsTotal: 0, sseDisconnectsTotal: 0, rateLimitedTotal: 0 }
const eventClients = new Set()
const rateRows = new Map()

function nowIso(value = Date.now()) { return new Date(value).toISOString() }
function normalizeRole(v, fallback = 'viewer') { return v === 'owner' || v === 'admin' || v === 'editor' || v === 'viewer' ? v : fallback }
function hasRole(roles, required) { return roles.some((r) => (roleRank[r] || 0) >= (roleRank[required] || 1)) }
function normalizeOwnerHint(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64) }
function normalizeToken(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 256) }
function parseEncryptedFile(v) { try { return JSON.parse(v) } catch { return null } }
function makeAudit(orgId, actorSubject, action, target, metadata = {}) { return { id: `audit_${crypto.randomUUID()}`, orgId, actorSubject, action, target, metadata, createdAt: nowIso() } }
function normalizeBlobMime(value) { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 256) : 'application/octet-stream' }
function normalizeBlobFileName(value) { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 512) : 'file.bin' }
function parseBytes(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 }
function decodeBase64Url(value) { const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/'); const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4); return Buffer.from(padded, 'base64') }
function parseJwksKeys() {
  if (!ENTITLEMENT_VERIFY_JWKS) return []
  try {
    const parsed = JSON.parse(ENTITLEMENT_VERIFY_JWKS)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.keys)) return parsed.keys
  } catch {}
  return []
}
function parseCursor(value) {
  const raw = String(value || '').trim()
  if (!raw || !raw.includes('|')) return null
  const [createdAt, id] = raw.split('|', 2)
  if (!createdAt || !id || !Number.isFinite(Date.parse(createdAt))) return null
  return { createdAt: new Date(Date.parse(createdAt)).toISOString(), id }
}
function encodeCursor(createdAt, id) { return `${createdAt}|${id}` }
function normalizeTargetType(value) { return value === 'userId' || value === 'tokenIdentifier' || value === 'subject' || value === 'email' ? value : null }
function normalizeTargetValue(targetType, value) {
  const trimmed = String(value || '').trim()
  return targetType === 'email' ? trimmed.toLowerCase() : trimmed
}
function entitlementOverrideKey(targetType, targetValue) { return `${targetType}:${targetValue}` }
function subscriptionRecordKey(scopeType, scopeId) { return `${scopeType}:${scopeId}` }
function normalizeScopeId(scopeType, scopeId) { const trimmed = String(scopeId || '').trim(); return scopeType === 'user' && trimmed.includes('@') ? trimmed.toLowerCase() : trimmed }
function isPlanTier(value) { return value === 'free' || value === 'premium' || value === 'enterprise' }
function isSubscriptionStatus(value) { return value === 'active' || value === 'trialing' || value === 'canceled' || value === 'past_due' || value === 'paused' }
function isBillingMode(value) { return value === 'manual' || value === 'external' }
function isSubscriptionEffective(status) { return status === 'active' || status === 'trialing' }
function parseEntitlementClaims(token) {
  const parts = String(token || '').trim().split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]).toString('utf8'))
    return isPlanTier(payload?.tier)
      ? {
        tier: payload.tier,
        capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.filter((value) => typeof value === 'string') : [],
        flags: payload.flags && typeof payload.flags === 'object' ? payload.flags : {},
        exp: Number(payload.exp),
      }
      : null
  } catch {
    return null
  }
}
function buildFreeEntitlementSummary() { return { source: 'free', tier: 'free', capabilities: [], flags: DEFAULT_FLAGS, reason: 'Free plan active', storageLimitBytes: 0, seatLimit: null } }
function buildDefaultEntitlementSummary() { const parsed = parseEntitlementClaims(ENTITLEMENT_TOKEN); return parsed ? { source: 'server_default', tier: parsed.tier, capabilities: parsed.capabilities, flags: parsed.flags, reason: 'Server-issued entitlement token', storageLimitBytes: null, seatLimit: null } : buildFreeEntitlementSummary() }
function buildSubscriptionEntitlementSummary(record) { return record && isSubscriptionEffective(record.status) ? { source: 'subscription', tier: record.tier, capabilities: PLAN_CAPABILITIES[record.tier] || [], flags: DEFAULT_FLAGS, reason: `${record.tier} subscription`, storageLimitBytes: typeof record.storageLimitBytes === 'number' ? record.storageLimitBytes : null, seatLimit: typeof record.seatLimit === 'number' ? record.seatLimit : null } : buildFreeEntitlementSummary() }
function buildOverrideEntitlementSummary(record) { return { source: 'override', tier: isPlanTier(record?.tier) ? record.tier : 'free', capabilities: Array.isArray(record?.capabilities) ? record.capabilities.filter((value) => typeof value === 'string') : [], flags: DEFAULT_FLAGS, reason: typeof record?.note === 'string' && record.note.trim() ? record.note.trim() : `${isPlanTier(record?.tier) ? record.tier : 'free'} entitlement override`, storageLimitBytes: null, seatLimit: null } }

async function verifyEntitlementAdminCapability(token) {
  const parts = String(token || '').trim().split('.')
  if (parts.length !== 3) return { ok: false, reason: 'Token format is invalid' }
  const [encodedHeader, encodedPayload, encodedSig] = parts
  let header
  let payload
  try {
    header = JSON.parse(decodeBase64Url(encodedHeader).toString('utf8'))
    payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'))
  } catch {
    return { ok: false, reason: 'Token payload is invalid' }
  }
  if (!header || typeof header.kid !== 'string' || !header.kid) return { ok: false, reason: 'Token kid is missing' }
  if (header.alg !== 'EdDSA') return { ok: false, reason: 'Token alg must be EdDSA' }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const exp = Number(payload?.exp)
  const iat = Number(payload?.iat)
  const nbf = payload?.nbf === undefined ? undefined : Number(payload.nbf)
  const aud = payload?.aud
  const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities.filter((v) => typeof v === 'string') : []

  if (!Number.isFinite(exp) || !Number.isFinite(iat)) return { ok: false, reason: 'Token timing claims are invalid' }
  if (exp <= nowSeconds - 300) return { ok: false, reason: 'Token is expired' }
  if (Number.isFinite(nbf) && Number(nbf) > nowSeconds + 300) return { ok: false, reason: 'Token is not active yet' }
  if (iat > nowSeconds + 300) return { ok: false, reason: 'Token issued-at is invalid' }
  const audienceMatches = typeof aud === 'string' ? aud === 'armadillo' : Array.isArray(aud) && aud.includes('armadillo')
  if (!audienceMatches) return { ok: false, reason: 'Token audience is invalid' }
  if (!capabilities.includes('enterprise.org_admin')) return { ok: false, reason: 'Token is missing enterprise.org_admin capability' }

  const keys = parseJwksKeys()
  if (keys.length === 0) return { ok: false, reason: 'SYNC_ENTITLEMENT_VERIFY_JWKS is missing' }
  const jwk = keys.find((key) => key && key.kid === header.kid)
  if (!jwk) return { ok: false, reason: 'Token key id is unknown' }

  try {
    const key = await crypto.webcrypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['verify'])
    const valid = await crypto.webcrypto.subtle.verify(
      'Ed25519',
      key,
      decodeBase64Url(encodedSig),
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    )
    if (!valid) return { ok: false, reason: 'Token signature verification failed' }
  } catch {
    return { ok: false, reason: 'Token signature verification failed' }
  }

  return { ok: true, reason: '' }
}

function signPayload(payload, secret) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

function verifyPayload(token, secret) {
  if (!token || !token.includes('.')) return null
  const [b64, sig] = token.split('.', 2)
  if (!b64 || !sig) return null
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try { return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) } catch { return null }
}

function parseSessionToken(token) {
  const p = verifyPayload(token, SESSION_TOKEN_SECRET)
  if (!p || typeof p !== 'object') return null
  const subject = typeof p.sub === 'string' ? p.sub.trim() : ''
  const orgId = typeof p.orgId === 'string' ? p.orgId.trim() : ''
  const sessionId = typeof p.sessionId === 'string' ? p.sessionId.trim() : ''
  const exp = Number(p.exp)
  const roles = Array.isArray(p.roles) ? p.roles.map((r) => normalizeRole(r, '')).filter(Boolean) : []
  if (!subject || !orgId || !sessionId || !Number.isFinite(exp) || exp < Date.now() || roles.length === 0) return null
  return { subject, orgId, sessionId, roles, authenticated: true }
}

function resolveContext(req, url, requireAuth) {
  const authHeader = String(req.headers.authorization || '')
  const orgHeader = normalizeOwnerHint(req.headers['x-armadillo-org'] || url.searchParams.get('orgId') || '')
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearer) {
    const signed = parseSessionToken(String(bearer[1]).trim())
    if (signed) {
      if (orgHeader && orgHeader !== signed.orgId) return { error: 'Requested org does not match authenticated org' }
      return signed
    }
    if (!ENTERPRISE_MODE) {
      const token = normalizeToken(bearer[1])
      if (token) return { subject: `user:${token}`, orgId: orgHeader || `org_${token.slice(0, 16)}`, sessionId: `legacy_${token.slice(0, 12)}`, roles: ['owner'], authenticated: true }
    }
  }
  if (ENTERPRISE_MODE || requireAuth) return { error: 'Authentication required' }
  const hint = normalizeOwnerHint(req.headers['x-armadillo-owner'] || url.searchParams.get('ownerHint') || '')
  if (!hint) return { error: 'Owner could not be resolved' }
  return { subject: `anon:${hint}`, orgId: orgHeader || `org_${hint.slice(0, 24)}`, sessionId: `anon_${hint.slice(0, 12)}`, roles: ['owner'], authenticated: false }
}

function resolveLegacyOwner(req, url) {
  const authHeader = String(req.headers.authorization || '')
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearer) { const token = normalizeToken(bearer[1]); if (token) return { ownerId: `user:${token}`, ownerSource: 'auth' } }
  const queryToken = normalizeToken(url.searchParams.get('token') || '')
  if (queryToken) return { ownerId: `user:${queryToken}`, ownerSource: 'auth' }
  const hint = normalizeOwnerHint(req.headers['x-armadillo-owner'] || url.searchParams.get('ownerHint') || '')
  if (hint) return { ownerId: `anon:${hint}`, ownerSource: 'anonymous' }
  return null
}

function corsHeaders(req) {
  const origin = String(req.headers.origin || '')
  if (!origin) return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, x-armadillo-owner, x-armadillo-org, x-armadillo-session, idempotency-key', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', Vary: 'Origin' }
  if (corsOrigins.includes('*') || corsOrigins.includes(origin)) return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type, authorization, x-armadillo-owner, x-armadillo-org, x-armadillo-session, idempotency-key', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', Vary: 'Origin' }
  return null
}

function json(req, res, status, payload, extraHeaders = {}) { const cors = corsHeaders(req); if (!cors) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Origin not allowed' })); return } res.writeHead(status, { ...cors, ...extraHeaders, 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)) }
function text(req, res, status, payload, extraHeaders = {}) { const cors = corsHeaders(req); if (!cors) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Origin not allowed'); return } res.writeHead(status, { ...cors, ...extraHeaders, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(payload) }

function enforceRate(req, suffix = '') { const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim(); const key = `${ip}:${suffix}`; const now = Date.now(); const row = rateRows.get(key); if (!row || now > row.resetAt) { rateRows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }); return true } row.count += 1; if (row.count > RATE_LIMIT_MAX) { metrics.rateLimitedTotal += 1; return false } return true }

function readJsonBody(req, maxBytes = MAX_REQUEST_BYTES) { return new Promise((resolve, reject) => { let total = 0; const chunks = []; req.on('data', (c) => { total += c.length; if (total > maxBytes) { reject(new Error(`Request body exceeded ${maxBytes} bytes`)); req.destroy(); return } chunks.push(c) }); req.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) { resolve({}); return } try { resolve(JSON.parse(raw)) } catch { reject(new Error('Invalid JSON body')) } }); req.on('error', reject) }) }

function readState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { snapshotsByOwner: {}, snapshotsByOrg: {}, blobsByOrg: {}, orgs: {}, auditByOrg: {}, idempotency: {}, entitlementOverrides: {}, subscriptionRecords: {} }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return { snapshotsByOwner: parsed?.snapshotsByOwner && typeof parsed.snapshotsByOwner === 'object' ? parsed.snapshotsByOwner : {}, snapshotsByOrg: parsed?.snapshotsByOrg && typeof parsed.snapshotsByOrg === 'object' ? parsed.snapshotsByOrg : {}, blobsByOrg: parsed?.blobsByOrg && typeof parsed.blobsByOrg === 'object' ? parsed.blobsByOrg : {}, orgs: parsed?.orgs && typeof parsed.orgs === 'object' ? parsed.orgs : {}, auditByOrg: parsed?.auditByOrg && typeof parsed.auditByOrg === 'object' ? parsed.auditByOrg : {}, idempotency: parsed?.idempotency && typeof parsed.idempotency === 'object' ? parsed.idempotency : {}, entitlementOverrides: parsed?.entitlementOverrides && typeof parsed.entitlementOverrides === 'object' ? parsed.entitlementOverrides : {}, subscriptionRecords: parsed?.subscriptionRecords && typeof parsed.subscriptionRecords === 'object' ? parsed.subscriptionRecords : {} }
  } catch {
    return { snapshotsByOwner: {}, snapshotsByOrg: {}, blobsByOrg: {}, orgs: {}, auditByOrg: {}, idempotency: {}, entitlementOverrides: {}, subscriptionRecords: {} }
  }
}

function writeState(state) { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8') }
const state = readState()

function listOrgVaultBlobs(orgId, vaultId) {
  const byVault = state.blobsByOrg?.[orgId]?.[vaultId]
  if (!byVault || typeof byVault !== 'object') return []
  return Object.values(byVault)
}

function computeOrgVaultBlobUsageBytes(orgId, vaultId, excludingBlobId = '') {
  const rows = listOrgVaultBlobs(orgId, vaultId)
  let total = 0
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (excludingBlobId && row.blobId === excludingBlobId) continue
    total += parseBytes(row.sizeBytes)
  }
  return total
}

function ensureOrg(context) {
  if (state.orgs[context.orgId]) {
    const role = state.orgs[context.orgId].members?.[context.subject]?.role
    return role || null
  }
  state.orgs[context.orgId] = { id: context.orgId, name: `Organization ${context.orgId}`, createdAt: nowIso(), members: { [context.subject]: { role: normalizeRole(context.roles[0], 'owner'), addedAt: nowIso() } } }
  writeState(state)
  return state.orgs[context.orgId].members[context.subject].role
}

function getEntitlementOverride(context) {
  const candidates = [
    { targetType: 'userId', targetValue: String(context.subject || '').split('|')[0] || '' },
    { targetType: 'subject', targetValue: context.subject || '' },
    { targetType: 'tokenIdentifier', targetValue: context.sessionId || '' },
    { targetType: 'email', targetValue: context.email || '' },
  ]
  for (const candidate of candidates) {
    const targetType = normalizeTargetType(candidate.targetType)
    if (!targetType) continue
    const targetValue = normalizeTargetValue(targetType, candidate.targetValue)
    if (!targetValue) continue
    const key = entitlementOverrideKey(targetType, targetValue)
    const row = state.entitlementOverrides?.[key]
    if (!row) continue
    return { row, source: key }
  }
  return null
}

function getSubscriptionRecord(scopeType, scopeId) {
  const normalizedScopeId = normalizeScopeId(scopeType, scopeId)
  if (!normalizedScopeId) return null
  const row = state.subscriptionRecords?.[subscriptionRecordKey(scopeType, normalizedScopeId)] || null
  if (!row || !isPlanTier(row.tier) || !isSubscriptionStatus(row.status) || !isBillingMode(row.billingMode)) return null
  return {
    id: String(row.id || subscriptionRecordKey(scopeType, normalizedScopeId)),
    scopeType,
    scopeId: normalizedScopeId,
    tier: row.tier,
    status: row.status,
    billingMode: row.billingMode,
    seatLimit: typeof row.seatLimit === 'number' ? row.seatLimit : null,
    storageLimitBytes: typeof row.storageLimitBytes === 'number' ? row.storageLimitBytes : null,
    renewalAt: typeof row.renewalAt === 'string' ? row.renewalAt : null,
    endAt: typeof row.endAt === 'string' ? row.endAt : null,
    note: typeof row.note === 'string' ? row.note : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso(),
    updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : 'system',
  }
}

function resolveSubscriptionForContext(context) {
  const candidates = [
    { scopeType: 'user', scopeId: String(context.subject || '').split('|')[0] || '' },
    { scopeType: 'user', scopeId: context.sessionId || '' },
    { scopeType: 'user', scopeId: context.subject || '' },
    { scopeType: 'org', scopeId: context.orgId || '' },
  ]
  for (const candidate of candidates) {
    if (!candidate.scopeId) continue
    const record = getSubscriptionRecord(candidate.scopeType, candidate.scopeId)
    if (record && isSubscriptionEffective(record.status)) return record
  }
  return null
}

async function resolveAdminContext(req, url) {
  const context = resolveContext(req, url, true)
  if (context?.error) {
    return { error: context.error, status: 401 }
  }

  const allowlisted = ADMIN_ALLOWLIST_SUBJECTS.has(context.subject)
    || ADMIN_ALLOWLIST_EMAILS.has(String(context.email || '').toLowerCase())

  const overrideToken = getEntitlementOverride(context)
  const entitlementToken = (typeof overrideToken?.row?.token === 'string' ? overrideToken.row.token : ENTITLEMENT_TOKEN || '').trim()
  const capability = entitlementToken
    ? await verifyEntitlementAdminCapability(entitlementToken)
    : { ok: false, reason: 'No signed entitlement token available' }
  const superAdmin = allowlisted && capability.ok

  let role = state.orgs?.[context.orgId]?.members?.[context.subject]?.role || null
  if (!role && !superAdmin) {
    role = ensureOrg(context)
  }
  if (!role && superAdmin) {
    role = 'owner'
  }

  const orgAdminAllowed = Boolean(role && hasRole([role], 'admin'))
  const reasons = []
  if (!superAdmin && !orgAdminAllowed) {
    reasons.push('Org role is not admin or owner')
    if (!allowlisted) reasons.push('Identity is not in admin allowlist')
    if (!capability.ok) reasons.push(capability.reason)
  }

  return {
    status: 200,
    context: {
      subject: context.subject,
      orgId: context.orgId,
      sessionId: context.sessionId,
      role: role || 'viewer',
      email: null,
      name: null,
      tokenIdentifier: context.sessionId,
      permissions: {
        allowlisted,
        capability: capability.ok,
        superAdmin,
        allowed: superAdmin || orgAdminAllowed,
        reasons,
      },
    },
  }
}

function appendAudit(event) { state.auditByOrg[event.orgId] = state.auditByOrg[event.orgId] || []; state.auditByOrg[event.orgId].push(event); if (state.auditByOrg[event.orgId].length > 2000) state.auditByOrg[event.orgId] = state.auditByOrg[event.orgId].slice(-2000); writeState(state) }
function publishVaultUpdate(orgId, vaultId, revision, updatedAt) { const payload = JSON.stringify({ type: 'vault-updated', vaultId, revision, updatedAt }); for (const client of eventClients) { if (client.orgId !== orgId || client.vaultId !== vaultId) continue; try { client.res.write(`event: vault-updated\n`); client.res.write(`data: ${payload}\n\n`) } catch { eventClients.delete(client); metrics.sseDisconnectsTotal += 1 } } }
function verifyStreamToken(token) { const payload = verifyPayload(token, STREAM_TOKEN_SECRET); if (!payload || typeof payload !== 'object') return null; const orgId = typeof payload.orgId === 'string' ? payload.orgId : ''; const vaultId = typeof payload.vaultId === 'string' ? payload.vaultId : ''; const subject = typeof payload.subject === 'string' ? payload.subject : ''; const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''; const exp = Number(payload.exp); if (!orgId || !vaultId || !subject || !sessionId || !Number.isFinite(exp) || exp < Date.now()) return null; return { orgId, vaultId, subject, sessionId, exp } }

const server = createServer(async (req, res) => {
  metrics.requestsTotal += 1
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (!enforceRate(req, url.pathname)) { json(req, res, 429, { error: 'Rate limit exceeded' }); return }
  if (req.method === 'OPTIONS') { const cors = corsHeaders(req); if (!cors) { json(req, res, 403, { error: 'Origin not allowed' }); return } res.writeHead(204, cors); res.end(); return }
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'PUT' && req.method !== 'DELETE') { json(req, res, 405, { error: 'Method not allowed' }); return }

  try {
    if (url.pathname === '/healthz' && req.method === 'GET') { json(req, res, 200, { ok: true, mode: ENTERPRISE_MODE ? 'enterprise' : 'standard', storage: 'file', now: nowIso() }); return }
    if (url.pathname === '/readyz' && req.method === 'GET') { json(req, res, 200, { ok: true }); return }
    if (url.pathname === '/metrics' && req.method === 'GET') { text(req, res, 200, ['# TYPE sync_requests_total counter', `sync_requests_total ${metrics.requestsTotal}`, '# TYPE sync_auth_failures_total counter', `sync_auth_failures_total ${metrics.authFailuresTotal}`, '# TYPE sync_push_conflicts_total counter', `sync_push_conflicts_total ${metrics.pushConflictsTotal}`, '# TYPE sync_sse_disconnects_total counter', `sync_sse_disconnects_total ${metrics.sseDisconnectsTotal}`, '# TYPE sync_rate_limited_total counter', `sync_rate_limited_total ${metrics.rateLimitedTotal}`].join('\n') + '\n'); return }

    if (url.pathname === '/v2/auth/status' && req.method === 'POST') { const c = resolveContext(req, url, ENTERPRISE_MODE); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 200, { authenticated: false, subject: null, email: null, name: null, tokenIdentifier: null, authContext: null }); return } const role = ensureOrg(c); appendAudit(makeAudit(c.orgId, c.subject, 'auth.status', 'sync-gateway', { sessionId: c.sessionId })); json(req, res, 200, { authenticated: true, subject: c.subject, email: null, name: null, tokenIdentifier: c.sessionId, authContext: { subject: c.subject, orgId: c.orgId, roles: [role], sessionId: c.sessionId } }); return }
    if (url.pathname === '/v2/entitlements/me' && req.method === 'GET') {
      const c = resolveContext(req, url, ENTERPRISE_MODE)
      if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { ok: false, token: null, reason: c.error, expiresAt: null, fetchedAt: nowIso() }); return }
      const override = getEntitlementOverride(c)
      if (typeof override?.row?.token === 'string' && override.row.token.trim()) {
        json(req, res, 200, { ok: true, token: override.row.token.trim(), reason: `User override (${override.source})`, expiresAt: null, fetchedAt: nowIso() })
        return
      }
      if (override?.row?.mode === 'derived') {
        const effective = buildOverrideEntitlementSummary(override.row)
        json(req, res, 200, { ok: true, token: null, reason: effective.reason, fetchedAt: nowIso(), derived: { source: effective.source, tier: effective.tier, capabilities: effective.capabilities, flags: effective.flags, expiresAt: null, subject: c.subject } })
        return
      }
      const subscription = resolveSubscriptionForContext(c)
      if (subscription) {
        const effective = buildSubscriptionEntitlementSummary(subscription)
        json(req, res, 200, { ok: true, token: null, reason: effective.reason, fetchedAt: nowIso(), derived: { source: effective.source, tier: effective.tier, capabilities: effective.capabilities, flags: effective.flags, expiresAt: subscription.endAt, subject: c.subject } })
        return
      }
      const token = (ENTITLEMENT_TOKEN || '').trim()
      json(req, res, 200, token
        ? { ok: true, token, reason: 'Server-issued entitlement token', expiresAt: null, fetchedAt: nowIso() }
        : { ok: false, token: null, reason: 'No signed entitlement token configured', expiresAt: null, fetchedAt: nowIso() })
      return
    }

    if (url.pathname === '/v2/admin/me' && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) {
        metrics.authFailuresTotal += 1
        json(req, res, admin.status || 401, { error: admin.error })
        return
      }
      json(req, res, 200, {
        authenticated: true,
        identity: {
          subject: admin.context.subject,
          email: admin.context.email,
          name: admin.context.name,
          tokenIdentifier: admin.context.tokenIdentifier,
          orgId: admin.context.orgId,
          roles: [admin.context.role],
        },
        permissions: admin.context.permissions,
      })
      return
    }

    if (url.pathname === '/v2/admin/orgs' && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }

      const all = Object.values(state.orgs || {})
      const rows = all.slice()
      if (!rows.some((org) => org?.id === admin.context.orgId)) {
        rows.push({
          id: admin.context.orgId,
          name: `Organization ${admin.context.orgId}`,
          createdAt: nowIso(),
          createdBy: admin.context.subject,
          members: {},
        })
      }
      const orgs = rows
        .filter((org) => admin.context.permissions.superAdmin || Boolean(org?.members?.[admin.context.subject]))
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
        .map((org) => ({
          id: org.id,
          name: org.name || `Organization ${org.id}`,
          createdAt: org.createdAt || nowIso(),
          createdBy: org.createdBy || null,
          myRole: org?.members?.[admin.context.subject]?.role || null,
          memberCount: Object.keys(org?.members || {}).length,
        }))
      json(req, res, 200, { orgs })
      return
    }

    if (url.pathname === '/v2/admin/orgs' && req.method === 'POST') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.superAdmin) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'superadmin required' }); return }

      const body = await readJsonBody(req)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const provided = typeof body.orgId === 'string' ? body.orgId.trim() : ''
      const orgId = (provided || `org_${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
      if (!name) { json(req, res, 400, { error: 'name is required' }); return }
      if (!orgId) { json(req, res, 400, { error: 'orgId is invalid' }); return }

      const createdAt = nowIso()
      const existing = state.orgs[orgId]
      if (!existing) {
        state.orgs[orgId] = {
          id: orgId,
          name,
          createdAt,
          createdBy: admin.context.subject,
          members: {},
        }
      }
      const role = state.orgs[orgId].members?.[admin.context.subject]?.role || 'owner'
      state.orgs[orgId].members[admin.context.subject] = state.orgs[orgId].members[admin.context.subject] || {
        role: 'owner',
        addedAt: createdAt,
      }
      appendAudit(makeAudit(orgId, admin.context.subject, 'org.create', orgId, { name }))
      writeState(state)
      json(req, res, 200, {
        created: !existing,
        org: {
          id: orgId,
          name: state.orgs[orgId].name || name,
          createdAt: state.orgs[orgId].createdAt || createdAt,
          createdBy: state.orgs[orgId].createdBy || admin.context.subject,
          myRole: role,
          memberCount: Object.keys(state.orgs[orgId].members || {}).length,
        },
      })
      return
    }

    const adminMembersV2 = url.pathname.match(/^\/v2\/admin\/orgs\/([^/]+)\/members$/)
    if (adminMembersV2 && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }
      const orgId = decodeURIComponent(adminMembersV2[1])
      if (!admin.context.permissions.superAdmin && orgId !== admin.context.orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const members = Object.entries(state.orgs?.[orgId]?.members || {})
        .map(([memberId, row]) => ({ memberId, role: normalizeRole(row?.role, 'viewer'), addedAt: row?.addedAt || nowIso() }))
        .sort((a, b) => (a.memberId > b.memberId ? 1 : -1))
      json(req, res, 200, { members })
      return
    }

    if (adminMembersV2 && req.method === 'POST') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }
      const orgId = decodeURIComponent(adminMembersV2[1])
      if (!admin.context.permissions.superAdmin && orgId !== admin.context.orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const body = await readJsonBody(req)
      const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
      const memberRole = normalizeRole(body.role, 'viewer')
      if (!memberId) { json(req, res, 400, { error: 'memberId is required' }); return }
      state.orgs[orgId] = state.orgs[orgId] || { id: orgId, name: `Organization ${orgId}`, createdAt: nowIso(), members: {} }
      const existing = state.orgs[orgId].members?.[memberId]
      const addedAt = existing?.addedAt || nowIso()
      state.orgs[orgId].members[memberId] = { role: memberRole, addedAt }
      appendAudit(makeAudit(orgId, admin.context.subject, 'org.member.upsert', memberId, { role: memberRole }))
      writeState(state)
      json(req, res, 200, { member: { memberId, role: memberRole, addedAt } })
      return
    }

    const adminDelMemberV2 = url.pathname.match(/^\/v2\/admin\/orgs\/([^/]+)\/members\/([^/]+)$/)
    if (adminDelMemberV2 && req.method === 'DELETE') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }
      const orgId = decodeURIComponent(adminDelMemberV2[1])
      const memberId = decodeURIComponent(adminDelMemberV2[2])
      if (!admin.context.permissions.superAdmin && orgId !== admin.context.orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const existed = Boolean(state.orgs?.[orgId]?.members?.[memberId])
      if (existed) delete state.orgs[orgId].members[memberId]
      appendAudit(makeAudit(orgId, admin.context.subject, 'org.member.remove', memberId))
      writeState(state)
      json(req, res, 200, { ok: true, deleted: existed })
      return
    }

    const adminAuditV2 = url.pathname.match(/^\/v2\/admin\/orgs\/([^/]+)\/audit$/)
    if (adminAuditV2 && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }
      const orgId = decodeURIComponent(adminAuditV2[1])
      if (!admin.context.permissions.superAdmin && orgId !== admin.context.orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const limitRaw = Number(url.searchParams.get('limit') || 50)
      const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.round(limitRaw))) : 50
      const cursor = parseCursor(url.searchParams.get('cursor'))
      const rows = [...(state.auditByOrg[orgId] || [])].sort((a, b) => {
        if (a.createdAt === b.createdAt) return String(b.id).localeCompare(String(a.id))
        return b.createdAt > a.createdAt ? 1 : -1
      })
      const filtered = cursor
        ? rows.filter((row) => row.createdAt < cursor.createdAt || (row.createdAt === cursor.createdAt && String(row.id) < cursor.id))
        : rows
      const page = filtered.slice(0, limit)
      const next = filtered.length > limit ? filtered[limit - 1] : null
      json(req, res, 200, { events: page, nextCursor: next ? encodeCursor(next.createdAt, String(next.id)) : null })
      return
    }

    const adminVaultsV2 = url.pathname.match(/^\/v2\/admin\/orgs\/([^/]+)\/vaults$/)
    if (adminVaultsV2 && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }
      const orgId = decodeURIComponent(adminVaultsV2[1])
      if (!admin.context.permissions.superAdmin && orgId !== admin.context.orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const snapshots = Object.values(state.snapshotsByOrg?.[orgId] || {}).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      const vaults = snapshots.map((row) => ({
        vaultId: row.vaultId,
        ownerId: row.updatedBy || null,
        revision: Number(row.revision || 0),
        updatedAt: row.updatedAt || nowIso(),
        updatedBy: row.updatedBy || null,
        blobCount: Object.keys(state.blobsByOrg?.[orgId]?.[row.vaultId] || {}).length,
        storageBytes: computeOrgVaultBlobUsageBytes(orgId, row.vaultId),
      }))
      json(req, res, 200, { vaults })
      return
    }

    const adminVaultV2 = url.pathname.match(/^\/v2\/admin\/orgs\/([^/]+)\/vaults\/([^/]+)$/)
    if (adminVaultV2 && req.method === 'DELETE') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }
      const orgId = decodeURIComponent(adminVaultV2[1])
      const vaultId = decodeURIComponent(adminVaultV2[2])
      if (!admin.context.permissions.superAdmin && orgId !== admin.context.orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const hadSnapshot = Boolean(state.snapshotsByOrg?.[orgId]?.[vaultId])
      if (state.snapshotsByOrg?.[orgId]?.[vaultId]) delete state.snapshotsByOrg[orgId][vaultId]
      const hadBlobs = Boolean(state.blobsByOrg?.[orgId]?.[vaultId])
      if (state.blobsByOrg?.[orgId]?.[vaultId]) delete state.blobsByOrg[orgId][vaultId]
      appendAudit(makeAudit(orgId, admin.context.subject, 'org.vault.delete', vaultId))
      writeState(state)
      json(req, res, 200, { ok: true, deleted: hadSnapshot || hadBlobs })
      return
    }

    const adminUsageV2 = url.pathname.match(/^\/v2\/admin\/orgs\/([^/]+)\/usage$/)
    if (adminUsageV2 && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }
      const orgId = decodeURIComponent(adminUsageV2[1])
      if (!admin.context.permissions.superAdmin && orgId !== admin.context.orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const snapshots = Object.values(state.snapshotsByOrg?.[orgId] || {})
      const storageBytes = Object.keys(state.blobsByOrg?.[orgId] || {}).reduce((total, vaultId) => total + computeOrgVaultBlobUsageBytes(orgId, vaultId), 0)
      json(req, res, 200, {
        orgId,
        memberCount: Object.keys(state.orgs?.[orgId]?.members || {}).length,
        vaultCount: snapshots.length,
        storageBytes,
        lastVaultActivityAt: snapshots.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))[0]?.updatedAt || null,
      })
      return
    }

    if (url.pathname === '/v2/admin/subscriptions' && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }
      const scopeType = url.searchParams.get('scopeType')
      const scopeId = normalizeScopeId(scopeType, url.searchParams.get('scopeId') || '')
      if ((scopeType !== 'org' && scopeType !== 'user') || !scopeId) { json(req, res, 400, { error: 'scopeType and scopeId are required' }); return }
      if (!admin.context.permissions.superAdmin && (scopeType !== 'org' || scopeId !== admin.context.orgId)) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const subscription = getSubscriptionRecord(scopeType, scopeId)
      const effective = subscription ? buildSubscriptionEntitlementSummary(subscription) : buildDefaultEntitlementSummary()
      json(req, res, 200, { subscription, effective })
      return
    }

    if (url.pathname === '/v2/admin/subscriptions' && req.method === 'PUT') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.allowed) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: admin.context.permissions.reasons[0] || 'forbidden' }); return }
      const body = await readJsonBody(req)
      const scopeType = body.scopeType === 'org' || body.scopeType === 'user' ? body.scopeType : null
      const scopeId = normalizeScopeId(scopeType, body.scopeId)
      if (!scopeType || !scopeId || !isPlanTier(body.tier) || !isSubscriptionStatus(body.status) || !isBillingMode(body.billingMode)) { json(req, res, 400, { error: 'scopeType, scopeId, tier, status, and billingMode are required' }); return }
      if (!admin.context.permissions.superAdmin) {
        if (scopeType !== 'org' || scopeId !== admin.context.orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
        if (body.tier === 'enterprise') { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'Enterprise plans are operator-managed' }); return }
      }
      const key = subscriptionRecordKey(scopeType, scopeId)
      state.subscriptionRecords[key] = {
        id: state.subscriptionRecords[key]?.id || `subscription_${crypto.randomUUID()}`,
        scopeType,
        scopeId,
        tier: body.tier,
        status: body.status,
        billingMode: body.billingMode,
        seatLimit: typeof body.seatLimit === 'number' ? Math.max(0, Math.round(body.seatLimit)) : null,
        storageLimitBytes: typeof body.storageLimitBytes === 'number' ? Math.max(0, Math.round(body.storageLimitBytes)) : null,
        renewalAt: typeof body.renewalAt === 'string' && body.renewalAt.trim() ? body.renewalAt : null,
        endAt: typeof body.endAt === 'string' && body.endAt.trim() ? body.endAt : null,
        note: typeof body.note === 'string' ? body.note.trim() : '',
        updatedAt: nowIso(),
        updatedBy: admin.context.subject,
      }
      writeState(state)
      appendAudit(makeAudit(scopeType === 'org' ? scopeId : admin.context.orgId, admin.context.subject, 'subscription.upsert', `${scopeType}:${scopeId}`, { tier: body.tier, status: body.status, billingMode: body.billingMode }))
      const subscription = getSubscriptionRecord(scopeType, scopeId)
      const effective = subscription ? buildSubscriptionEntitlementSummary(subscription) : buildDefaultEntitlementSummary()
      json(req, res, 200, { subscription, effective })
      return
    }

    if (url.pathname === '/v2/admin/overview' && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.superAdmin) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'superadmin required' }); return }
      const subscriptionsByTier = { free: 0, premium: 0, enterprise: 0 }
      const subscriptionsByStatus = { active: 0, trialing: 0, canceled: 0, past_due: 0, paused: 0 }
      for (const row of Object.values(state.subscriptionRecords || {})) {
        if (isPlanTier(row?.tier)) subscriptionsByTier[row.tier] += 1
        if (isSubscriptionStatus(row?.status)) subscriptionsByStatus[row.status] += 1
      }
      const totalVaults = Object.values(state.snapshotsByOrg || {}).reduce((total, rows) => total + Object.keys(rows || {}).length, 0)
      const totalStorageBytes = Object.keys(state.blobsByOrg || {}).reduce((total, orgId) => total + Object.keys(state.blobsByOrg[orgId] || {}).reduce((inner, vaultId) => inner + computeOrgVaultBlobUsageBytes(orgId, vaultId), 0), 0)
      json(req, res, 200, { totalOrgs: Object.keys(state.orgs || {}).length, totalMembers: Object.values(state.orgs || {}).reduce((total, org) => total + Object.keys(org?.members || {}).length, 0), totalVaults, totalStorageBytes, subscriptionsByTier, subscriptionsByStatus, provider: 'self_hosted' })
      return
    }

    if (url.pathname === '/v2/admin/customers/search' && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.superAdmin) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'superadmin required' }); return }
      const queryText = String(url.searchParams.get('q') || '').trim().toLowerCase()
      if (!queryText) { json(req, res, 200, { results: [] }); return }
      const results = Object.values(state.orgs || {})
        .filter((org) => org?.id?.toLowerCase?.().includes(queryText) || org?.name?.toLowerCase?.().includes(queryText) || Object.keys(org?.members || {}).some((memberId) => memberId.toLowerCase().includes(queryText)))
        .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
        .map((org) => ({
          orgId: org.id,
          orgName: org.name || `Organization ${org.id}`,
          memberCount: Object.keys(org?.members || {}).length,
          matchedMembers: Object.keys(org?.members || {}).filter((memberId) => memberId.toLowerCase().includes(queryText)),
          subscriptionTier: getSubscriptionRecord('org', org.id)?.tier || null,
          lastActivityAt: Object.values(state.snapshotsByOrg?.[org.id] || {}).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))[0]?.updatedAt || null,
        }))
      json(req, res, 200, { results })
      return
    }

    if (url.pathname === '/v2/admin/system' && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.superAdmin) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'superadmin required' }); return }
      json(req, res, 200, { provider: 'self_hosted', health: { ok: true, now: nowIso() }, readiness: { ok: true }, metrics: { sync_requests_total: metrics.requestsTotal, sync_auth_failures_total: metrics.authFailuresTotal, sync_push_conflicts_total: metrics.pushConflictsTotal, sync_sse_disconnects_total: metrics.sseDisconnectsTotal, sync_rate_limited_total: metrics.rateLimitedTotal } })
      return
    }

    if (url.pathname === '/v2/admin/entitlements/overrides' && req.method === 'GET') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.superAdmin) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'superadmin required' }); return }
      const limitRaw = Number(url.searchParams.get('limit') || 50)
      const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.round(limitRaw))) : 50
      const cursor = parseCursor(url.searchParams.get('cursor'))
      const rows = Object.values(state.entitlementOverrides || {}).sort((a, b) => {
        if (a.updatedAt === b.updatedAt) return String(b.id).localeCompare(String(a.id))
        return b.updatedAt > a.updatedAt ? 1 : -1
      })
      const filtered = cursor
        ? rows.filter((row) => row.updatedAt < cursor.createdAt || (row.updatedAt === cursor.createdAt && String(row.id) < cursor.id))
        : rows
      const page = filtered.slice(0, limit)
      const next = filtered.length > limit ? filtered[limit - 1] : null
      json(req, res, 200, {
        overrides: page.map((row) => ({
          ...row,
          mode: row.mode === 'derived' ? 'derived' : 'token',
          tier: isPlanTier(row.tier) ? row.tier : null,
          capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter((value) => typeof value === 'string') : [],
        })),
        nextCursor: next ? encodeCursor(next.updatedAt, String(next.id)) : null,
      })
      return
    }

    if (url.pathname === '/v2/admin/entitlements/overrides' && req.method === 'PUT') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.superAdmin) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'superadmin required' }); return }
      const body = await readJsonBody(req)
      const targetType = normalizeTargetType(body.targetType)
      if (!targetType) { json(req, res, 400, { error: 'targetType is invalid' }); return }
      const targetValue = normalizeTargetValue(targetType, body.targetValue)
      const token = typeof body.token === 'string' ? body.token.trim() : ''
      const tier = isPlanTier(body.tier) ? body.tier : 'free'
      const capabilities = Array.isArray(body.capabilities) ? Array.from(new Set(body.capabilities.filter((value) => typeof value === 'string'))) : PLAN_CAPABILITIES[tier]
      const note = typeof body.note === 'string' ? body.note.trim() : ''
      if (!targetValue) { json(req, res, 400, { error: 'targetValue is required' }); return }
      const mode = token ? 'token' : 'derived'
      if (mode === 'token' && token.split('.').length !== 3) { json(req, res, 400, { error: 'token must be a signed JWT' }); return }
      if (mode === 'derived' && capabilities.length === 0 && tier === 'free') { json(req, res, 400, { error: 'Select at least one capability or a non-free tier' }); return }
      const now = nowIso()
      const key = entitlementOverrideKey(targetType, targetValue)
      const existing = state.entitlementOverrides[key]
      const row = {
        id: existing?.id || `override_${crypto.randomUUID()}`,
        targetType,
        targetValue,
        mode,
        ...(token ? { token } : {}),
        ...(mode === 'derived' ? { tier, capabilities } : {}),
        note,
        updatedAt: now,
        updatedBy: admin.context.subject,
      }
      state.entitlementOverrides[key] = row
      appendAudit(makeAudit(admin.context.orgId, admin.context.subject, 'entitlement.override.upsert', `${targetType}:${targetValue}`))
      writeState(state)
      json(req, res, 200, { ok: true, override: { id: row.id, targetType, targetValue, mode, tier: mode === 'derived' ? tier : null, capabilities: mode === 'derived' ? capabilities : [], note, updatedAt: now, updatedBy: admin.context.subject } })
      return
    }

    if (url.pathname === '/v2/admin/entitlements/overrides' && req.method === 'DELETE') {
      const admin = await resolveAdminContext(req, url)
      if (admin?.error) { metrics.authFailuresTotal += 1; json(req, res, admin.status || 401, { error: admin.error }); return }
      if (!admin.context.permissions.superAdmin) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'superadmin required' }); return }
      const body = await readJsonBody(req)
      const targetType = normalizeTargetType(body.targetType)
      if (!targetType) { json(req, res, 400, { error: 'targetType is invalid' }); return }
      const targetValue = normalizeTargetValue(targetType, body.targetValue)
      if (!targetValue) { json(req, res, 400, { error: 'targetValue is required' }); return }
      const key = entitlementOverrideKey(targetType, targetValue)
      const deleted = Boolean(state.entitlementOverrides[key])
      if (deleted) delete state.entitlementOverrides[key]
      appendAudit(makeAudit(admin.context.orgId, admin.context.subject, 'entitlement.override.delete', `${targetType}:${targetValue}`))
      writeState(state)
      json(req, res, 200, { ok: true, deleted })
      return
    }
    if (url.pathname === '/v2/events/token' && req.method === 'POST') { const c = resolveContext(req, url, ENTERPRISE_MODE); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return } const role = ensureOrg(c); if (!hasRole([role], 'viewer')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } const body = await readJsonBody(req); const vaultId = typeof body.vaultId === 'string' ? body.vaultId.trim() : ''; if (!vaultId) { json(req, res, 400, { error: 'vaultId is required' }); return } const exp = Date.now() + STREAM_TOKEN_TTL_MS; const streamToken = signPayload({ orgId: c.orgId, vaultId, subject: c.subject, sessionId: c.sessionId, exp }, STREAM_TOKEN_SECRET); json(req, res, 200, { streamToken, expiresAt: nowIso(exp) }); return }

    const eventsMatch = url.pathname.match(/^\/v2\/vaults\/([^/]+)\/events$/)
    if (eventsMatch && req.method === 'GET') { const vaultId = decodeURIComponent(eventsMatch[1]); const verified = verifyStreamToken(String(url.searchParams.get('streamToken') || '').trim()); if (!verified || verified.vaultId !== vaultId) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: 'Invalid or expired stream token' }); return } const cors = corsHeaders(req); if (!cors) { json(req, res, 403, { error: 'Origin not allowed' }); return } res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.write(`event: ready\n`); res.write(`data: ${JSON.stringify({ ok: true, vaultId })}\n\n`); const client = { res, orgId: verified.orgId, vaultId }; eventClients.add(client); const heartbeat = setInterval(() => { try { res.write(`event: ping\n`); res.write(`data: ${Date.now()}\n\n`) } catch {} }, SSE_HEARTBEAT_MS); const close = () => { clearInterval(heartbeat); if (eventClients.delete(client)) metrics.sseDisconnectsTotal += 1 }; req.on('close', close); req.on('error', close); res.on('close', close); return }

    const byOwnerPull = url.pathname === '/v2/vaults/pull-by-owner' && req.method === 'POST'
    const byOwnerList = url.pathname === '/v2/vaults/list-by-owner' && req.method === 'POST'
    if (byOwnerPull || byOwnerList) { const c = resolveContext(req, url, ENTERPRISE_MODE); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return } const role = ensureOrg(c); if (!hasRole([role], 'viewer')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } const rows = Object.values(state.snapshotsByOrg?.[c.orgId] || {}).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)); appendAudit(makeAudit(c.orgId, c.subject, byOwnerPull ? 'vault.pull.latest' : 'vault.list', 'vaults', { count: rows.length })); if (byOwnerPull) { const latest = rows[0] || null; json(req, res, 200, { snapshot: latest ? parseEncryptedFile(latest.encryptedFile) : null, ownerSource: c.authenticated ? 'auth' : 'anonymous' }) } else { json(req, res, 200, { snapshots: rows.map((r) => parseEncryptedFile(r.encryptedFile)).filter(Boolean), ownerSource: c.authenticated ? 'auth' : 'anonymous' }) } return }

    const pullV2 = url.pathname.match(/^\/v2\/vaults\/([^/]+)\/pull$/)
    if (pullV2 && req.method === 'POST') { const c = resolveContext(req, url, ENTERPRISE_MODE); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return } const role = ensureOrg(c); if (!hasRole([role], 'viewer')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } const vaultId = decodeURIComponent(pullV2[1]); const row = state.snapshotsByOrg?.[c.orgId]?.[vaultId] || null; appendAudit(makeAudit(c.orgId, c.subject, 'vault.pull', vaultId)); json(req, res, 200, { snapshot: row ? parseEncryptedFile(row.encryptedFile) : null, ownerSource: c.authenticated ? 'auth' : 'anonymous' }); return }

    const pushV2 = url.pathname.match(/^\/v2\/vaults\/([^/]+)\/push$/)
    if (pushV2 && req.method === 'POST') { const c = resolveContext(req, url, ENTERPRISE_MODE); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return } const role = ensureOrg(c); if (!hasRole([role], 'editor')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } const vaultId = decodeURIComponent(pushV2[1]); const body = await readJsonBody(req); const revision = Number(body.revision); const encryptedFile = typeof body.encryptedFile === 'string' ? body.encryptedFile : ''; const updatedAt = typeof body.updatedAt === 'string' ? body.updatedAt : ''; if (!Number.isFinite(revision) || !encryptedFile || !updatedAt) { json(req, res, 400, { error: 'revision, encryptedFile, and updatedAt are required' }); return } const idempotencyKey = String(req.headers['idempotency-key'] || '').trim(); if (idempotencyKey && state.idempotency[idempotencyKey]) { json(req, res, 200, state.idempotency[idempotencyKey]); return } state.snapshotsByOrg[c.orgId] = state.snapshotsByOrg[c.orgId] || {}; const existing = state.snapshotsByOrg[c.orgId][vaultId]; const accepted = !existing || revision > Number(existing.revision || 0); if (accepted) { state.snapshotsByOrg[c.orgId][vaultId] = { orgId: c.orgId, vaultId, revision, encryptedFile, updatedAt, updatedBy: c.subject }; publishVaultUpdate(c.orgId, vaultId, revision, updatedAt) } else { metrics.pushConflictsTotal += 1 } const payload = { ok: true, accepted, ownerSource: c.authenticated ? 'auth' : 'anonymous' }; if (idempotencyKey) state.idempotency[idempotencyKey] = payload; appendAudit(makeAudit(c.orgId, c.subject, 'vault.push', vaultId, { revision, accepted })); writeState(state); json(req, res, 200, payload); return }

    const deleteV2 = url.pathname.match(/^\/v2\/vaults\/([^/]+)$/)
    if (deleteV2 && req.method === 'DELETE') {
      const c = resolveContext(req, url, ENTERPRISE_MODE)
      if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return }
      const role = ensureOrg(c)
      if (!hasRole([role], 'editor')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const vaultId = decodeURIComponent(deleteV2[1])
      const hadSnapshot = Boolean(state.snapshotsByOrg?.[c.orgId]?.[vaultId])
      if (state.snapshotsByOrg?.[c.orgId]?.[vaultId]) {
        delete state.snapshotsByOrg[c.orgId][vaultId]
      }
      const hadBlobs = Boolean(state.blobsByOrg?.[c.orgId]?.[vaultId])
      if (state.blobsByOrg?.[c.orgId]?.[vaultId]) {
        delete state.blobsByOrg[c.orgId][vaultId]
      }
      writeState(state)
      appendAudit(makeAudit(c.orgId, c.subject, 'vault.delete', vaultId))
      json(req, res, 200, { ok: true, deleted: hadSnapshot || hadBlobs, ownerSource: c.authenticated ? 'auth' : 'anonymous' })
      return
    }

    const blobV2 = url.pathname.match(/^\/v2\/vaults\/([^/]+)\/blobs\/([^/]+)$/)
    if (blobV2 && req.method === 'PUT') {
      const c = resolveContext(req, url, ENTERPRISE_MODE)
      if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return }
      const role = ensureOrg(c)
      if (!hasRole([role], 'editor')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const vaultId = decodeURIComponent(blobV2[1])
      const blobId = decodeURIComponent(blobV2[2])
      const body = await readJsonBody(req, MAX_BLOB_REQUEST_BYTES)
      const nonce = typeof body.nonce === 'string' ? body.nonce : ''
      const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : ''
      const sizeBytes = parseBytes(body.sizeBytes)
      const sha256 = typeof body.sha256 === 'string' ? body.sha256 : ''
      const updatedAt = typeof body.updatedAt === 'string' && body.updatedAt ? body.updatedAt : nowIso()
      if (!blobId || !nonce || !ciphertext || !sha256 || sizeBytes <= 0) { json(req, res, 400, { error: 'blobId, nonce, ciphertext, sizeBytes, and sha256 are required' }); return }
      if (sizeBytes > MAX_BLOB_FILE_BYTES) { json(req, res, 413, { error: `Blob exceeds file limit of ${MAX_BLOB_FILE_BYTES} bytes` }); return }
      const usageWithoutCurrent = computeOrgVaultBlobUsageBytes(c.orgId, vaultId, blobId)
      if (usageWithoutCurrent + sizeBytes > MAX_BLOB_TOTAL_BYTES) { json(req, res, 413, { error: `Vault blob quota exceeded (${MAX_BLOB_TOTAL_BYTES} bytes)` }); return }
      state.blobsByOrg[c.orgId] = state.blobsByOrg[c.orgId] || {}
      state.blobsByOrg[c.orgId][vaultId] = state.blobsByOrg[c.orgId][vaultId] || {}
      state.blobsByOrg[c.orgId][vaultId][blobId] = {
        orgId: c.orgId,
        vaultId,
        blobId,
        nonce,
        ciphertext,
        sizeBytes,
        sha256,
        mimeType: normalizeBlobMime(body.mimeType),
        fileName: normalizeBlobFileName(body.fileName),
        updatedAt,
        updatedBy: c.subject,
      }
      writeState(state)
      appendAudit(makeAudit(c.orgId, c.subject, 'vault.blob.put', `${vaultId}/${blobId}`, { sizeBytes }))
      json(req, res, 200, { ok: true, accepted: true, ownerSource: c.authenticated ? 'auth' : 'anonymous', usedBytes: usageWithoutCurrent + sizeBytes })
      return
    }
    if (blobV2 && req.method === 'GET') {
      const c = resolveContext(req, url, ENTERPRISE_MODE)
      if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return }
      const role = ensureOrg(c)
      if (!hasRole([role], 'viewer')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const vaultId = decodeURIComponent(blobV2[1])
      const blobId = decodeURIComponent(blobV2[2])
      const row = state.blobsByOrg?.[c.orgId]?.[vaultId]?.[blobId] || null
      appendAudit(makeAudit(c.orgId, c.subject, 'vault.blob.get', `${vaultId}/${blobId}`))
      json(req, res, 200, { blob: row, ownerSource: c.authenticated ? 'auth' : 'anonymous' })
      return
    }
    if (blobV2 && req.method === 'DELETE') {
      const c = resolveContext(req, url, ENTERPRISE_MODE)
      if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return }
      const role = ensureOrg(c)
      if (!hasRole([role], 'editor')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return }
      const vaultId = decodeURIComponent(blobV2[1])
      const blobId = decodeURIComponent(blobV2[2])
      const bucket = state.blobsByOrg?.[c.orgId]?.[vaultId]
      const existed = Boolean(bucket?.[blobId])
      if (bucket?.[blobId]) delete bucket[blobId]
      if (bucket && Object.keys(bucket).length === 0) delete state.blobsByOrg[c.orgId][vaultId]
      const usedBytes = computeOrgVaultBlobUsageBytes(c.orgId, vaultId)
      writeState(state)
      appendAudit(makeAudit(c.orgId, c.subject, 'vault.blob.delete', `${vaultId}/${blobId}`))
      json(req, res, 200, { ok: true, deleted: existed, ownerSource: c.authenticated ? 'auth' : 'anonymous', usedBytes })
      return
    }

    const auditV2 = url.pathname.match(/^\/v2\/orgs\/([^/]+)\/audit$/)
    if (auditV2 && req.method === 'GET') { const orgId = decodeURIComponent(auditV2[1]); const c = resolveContext(req, url, true); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return } if (c.orgId !== orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } const role = state.orgs?.[orgId]?.members?.[c.subject]?.role || null; if (!role || !hasRole([role], 'admin')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } json(req, res, 200, { events: [...(state.auditByOrg[orgId] || [])].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)).slice(0, 500) }); return }

    const addMemberV2 = url.pathname.match(/^\/v2\/orgs\/([^/]+)\/members$/)
    if (addMemberV2 && req.method === 'POST') { const orgId = decodeURIComponent(addMemberV2[1]); const c = resolveContext(req, url, true); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return } if (c.orgId !== orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } const role = state.orgs?.[orgId]?.members?.[c.subject]?.role || null; if (!role || !hasRole([role], 'admin')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } const body = await readJsonBody(req); const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''; const memberRole = normalizeRole(body.role, 'viewer'); if (!memberId) { json(req, res, 400, { error: 'memberId is required' }); return } state.orgs[orgId].members[memberId] = { role: memberRole, addedAt: nowIso() }; appendAudit(makeAudit(orgId, c.subject, 'org.member.add', memberId, { role: memberRole })); writeState(state); json(req, res, 200, { member: { memberId, role: memberRole, addedAt: state.orgs[orgId].members[memberId].addedAt } }); return }

    const delMemberV2 = url.pathname.match(/^\/v2\/orgs\/([^/]+)\/members\/([^/]+)$/)
    if (delMemberV2 && req.method === 'DELETE') { const orgId = decodeURIComponent(delMemberV2[1]); const memberId = decodeURIComponent(delMemberV2[2]); const c = resolveContext(req, url, true); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { error: c.error }); return } if (c.orgId !== orgId) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } const role = state.orgs?.[orgId]?.members?.[c.subject]?.role || null; if (!role || !hasRole([role], 'admin')) { metrics.authFailuresTotal += 1; json(req, res, 403, { error: 'forbidden' }); return } if (state.orgs?.[orgId]?.members?.[memberId]) delete state.orgs[orgId].members[memberId]; appendAudit(makeAudit(orgId, c.subject, 'org.member.remove', memberId)); writeState(state); json(req, res, 200, { ok: true }); return }

    // v1 compatibility
    if (url.pathname === '/v1/auth/status' && req.method === 'POST') { const owner = resolveLegacyOwner(req, url); if (!owner) { json(req, res, 200, { authenticated: false }); return } const isAuth = owner.ownerSource === 'auth'; json(req, res, 200, { authenticated: isAuth, subject: isAuth ? owner.ownerId : null, email: null, name: null, tokenIdentifier: null }); return }
    if (url.pathname === '/v1/events/token' && req.method === 'POST') { const owner = resolveLegacyOwner(req, url); if (!owner) { json(req, res, 401, { error: 'Owner could not be resolved.' }); return } const body = await readJsonBody(req); const vaultId = typeof body.vaultId === 'string' ? body.vaultId.trim() : ''; if (!vaultId) { json(req, res, 400, { error: 'vaultId is required' }); return } const exp = Date.now() + STREAM_TOKEN_TTL_MS; const streamToken = signPayload({ orgId: owner.ownerId, vaultId, subject: owner.ownerId, sessionId: owner.ownerId, exp }, STREAM_TOKEN_SECRET); json(req, res, 200, { streamToken, expiresAt: nowIso(exp) }); return }
    if (url.pathname === '/v1/events/stream' && req.method === 'GET') { const verified = verifyStreamToken(String(url.searchParams.get('streamToken') || '').trim()); if (!verified) { json(req, res, 401, { error: 'Invalid or expired stream token' }); return } const cors = corsHeaders(req); if (!cors) { json(req, res, 403, { error: 'Origin not allowed' }); return } res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.write(`event: ready\n`); res.write(`data: ${JSON.stringify({ ok: true, vaultId: verified.vaultId })}\n\n`); const client = { res, orgId: verified.orgId, vaultId: verified.vaultId }; eventClients.add(client); const heartbeat = setInterval(() => { try { res.write(`event: ping\n`); res.write(`data: ${Date.now()}\n\n`) } catch {} }, SSE_HEARTBEAT_MS); const close = () => { clearInterval(heartbeat); if (eventClients.delete(client)) metrics.sseDisconnectsTotal += 1 }; req.on('close', close); req.on('error', close); res.on('close', close); return }

    const owner = resolveLegacyOwner(req, url)
    if (url.pathname === '/v1/vaults/pull-by-owner' && req.method === 'POST') { if (!owner) { json(req, res, 401, { error: 'Owner could not be resolved.' }); return } const rows = Object.values(state.snapshotsByOwner?.[owner.ownerId] || {}).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)); const latest = rows[0] || null; json(req, res, 200, { snapshot: latest ? parseEncryptedFile(latest.encryptedFile) : null, ownerSource: owner.ownerSource }); return }
    if (url.pathname === '/v1/vaults/list-by-owner' && req.method === 'POST') { if (!owner) { json(req, res, 401, { error: 'Owner could not be resolved.' }); return } const rows = Object.values(state.snapshotsByOwner?.[owner.ownerId] || {}).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)); json(req, res, 200, { snapshots: rows.map((r) => parseEncryptedFile(r.encryptedFile)).filter(Boolean), ownerSource: owner.ownerSource }); return }
    const pullV1 = url.pathname.match(/^\/v1\/vaults\/([^/]+)\/pull$/)
    if (pullV1 && req.method === 'POST') { if (!owner) { json(req, res, 401, { error: 'Owner could not be resolved.' }); return } const vaultId = decodeURIComponent(pullV1[1]); const row = state.snapshotsByOwner?.[owner.ownerId]?.[vaultId] || null; json(req, res, 200, { snapshot: row ? parseEncryptedFile(row.encryptedFile) : null, ownerSource: owner.ownerSource }); return }
    const pushV1 = url.pathname.match(/^\/v1\/vaults\/([^/]+)\/push$/)
    if (pushV1 && req.method === 'POST') { if (!owner) { json(req, res, 401, { error: 'Owner could not be resolved.' }); return } const vaultId = decodeURIComponent(pushV1[1]); const body = await readJsonBody(req); const revision = Number(body.revision); const encryptedFile = typeof body.encryptedFile === 'string' ? body.encryptedFile : ''; const updatedAt = typeof body.updatedAt === 'string' ? body.updatedAt : ''; if (!Number.isFinite(revision) || !encryptedFile || !updatedAt) { json(req, res, 400, { error: 'revision, encryptedFile, and updatedAt are required' }); return } state.snapshotsByOwner[owner.ownerId] = state.snapshotsByOwner[owner.ownerId] || {}; const existing = state.snapshotsByOwner[owner.ownerId][vaultId]; const accepted = !existing || revision > Number(existing.revision || 0); if (accepted) { state.snapshotsByOwner[owner.ownerId][vaultId] = { ownerId: owner.ownerId, vaultId, revision, encryptedFile, updatedAt }; publishVaultUpdate(owner.ownerId, vaultId, revision, updatedAt) } else { metrics.pushConflictsTotal += 1 } writeState(state); json(req, res, 200, { ok: true, accepted, ownerSource: owner.ownerSource }); return }
    const deleteV1 = url.pathname.match(/^\/v1\/vaults\/([^/]+)$/)
    if (deleteV1 && req.method === 'DELETE') { if (!owner) { json(req, res, 401, { error: 'Owner could not be resolved.' }); return } const vaultId = decodeURIComponent(deleteV1[1]); const hadSnapshot = Boolean(state.snapshotsByOwner?.[owner.ownerId]?.[vaultId]); if (state.snapshotsByOwner?.[owner.ownerId]?.[vaultId]) delete state.snapshotsByOwner[owner.ownerId][vaultId]; writeState(state); json(req, res, 200, { ok: true, deleted: hadSnapshot, ownerSource: owner.ownerSource }); return }

    if (url.pathname === '/v1/orgs' && req.method === 'GET') { if (!owner) { json(req, res, 401, { error: 'Owner could not be resolved.' }); return } const orgs = Object.values(state.orgs).filter((org) => org?.members?.[owner.ownerId]).map((org) => ({ id: org.id, name: org.name, role: org.members[owner.ownerId].role, createdAt: org.createdAt })); json(req, res, 200, { orgs }); return }
    if (url.pathname === '/v1/orgs' && req.method === 'POST') { if (!owner) { json(req, res, 401, { error: 'Owner could not be resolved.' }); return } const body = await readJsonBody(req); const name = typeof body.name === 'string' ? body.name.trim() : ''; const provided = typeof body.orgId === 'string' ? body.orgId.trim() : ''; const orgId = (provided || `org_${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64); if (!name) { json(req, res, 400, { error: 'name is required' }); return } if (!state.orgs[orgId]) state.orgs[orgId] = { id: orgId, name, createdAt: nowIso(), members: {} }; state.orgs[orgId].members[owner.ownerId] = { role: 'owner', addedAt: nowIso() }; writeState(state); json(req, res, 200, { org: { id: orgId, name, role: 'owner', createdAt: state.orgs[orgId].createdAt } }); return }

    json(req, res, 404, { error: 'Not found' })
  } catch (error) {
    json(req, res, 500, { error: error instanceof Error ? error.message : 'Unknown server error' })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[sync-gateway] listening on http://localhost:${PORT}`)
  console.log(`[sync-gateway] data file: ${DATA_FILE}`)
  console.log(`[sync-gateway] enterprise mode: ${ENTERPRISE_MODE ? 'enabled' : 'disabled'}`)
})
