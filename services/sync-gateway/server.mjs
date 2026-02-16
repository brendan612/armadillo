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
const RATE_LIMIT_WINDOW_MS = Number(process.env.SYNC_RATE_LIMIT_WINDOW_MS || 60_000)
const RATE_LIMIT_MAX = Number(process.env.SYNC_RATE_LIMIT_MAX || 300)
const ENTITLEMENT_TOKEN = (process.env.SYNC_ENTITLEMENT_TOKEN || '').trim()

const defaultCorsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4000', 'http://127.0.0.1:4000']
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
  if (!origin) return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, x-armadillo-owner, x-armadillo-org, x-armadillo-session, idempotency-key', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', Vary: 'Origin' }
  if (corsOrigins.includes('*') || corsOrigins.includes(origin)) return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type, authorization, x-armadillo-owner, x-armadillo-org, x-armadillo-session, idempotency-key', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', Vary: 'Origin' }
  return null
}

function json(req, res, status, payload, extraHeaders = {}) { const cors = corsHeaders(req); if (!cors) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Origin not allowed' })); return } res.writeHead(status, { ...cors, ...extraHeaders, 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)) }
function text(req, res, status, payload, extraHeaders = {}) { const cors = corsHeaders(req); if (!cors) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Origin not allowed'); return } res.writeHead(status, { ...cors, ...extraHeaders, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(payload) }

function enforceRate(req, suffix = '') { const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim(); const key = `${ip}:${suffix}`; const now = Date.now(); const row = rateRows.get(key); if (!row || now > row.resetAt) { rateRows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }); return true } row.count += 1; if (row.count > RATE_LIMIT_MAX) { metrics.rateLimitedTotal += 1; return false } return true }

function readJsonBody(req) { return new Promise((resolve, reject) => { let total = 0; const chunks = []; req.on('data', (c) => { total += c.length; if (total > MAX_REQUEST_BYTES) { reject(new Error(`Request body exceeded ${MAX_REQUEST_BYTES} bytes`)); req.destroy(); return } chunks.push(c) }); req.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) { resolve({}); return } try { resolve(JSON.parse(raw)) } catch { reject(new Error('Invalid JSON body')) } }); req.on('error', reject) }) }

function readState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { snapshotsByOwner: {}, snapshotsByOrg: {}, orgs: {}, auditByOrg: {}, idempotency: {} }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return { snapshotsByOwner: parsed?.snapshotsByOwner && typeof parsed.snapshotsByOwner === 'object' ? parsed.snapshotsByOwner : {}, snapshotsByOrg: parsed?.snapshotsByOrg && typeof parsed.snapshotsByOrg === 'object' ? parsed.snapshotsByOrg : {}, orgs: parsed?.orgs && typeof parsed.orgs === 'object' ? parsed.orgs : {}, auditByOrg: parsed?.auditByOrg && typeof parsed.auditByOrg === 'object' ? parsed.auditByOrg : {}, idempotency: parsed?.idempotency && typeof parsed.idempotency === 'object' ? parsed.idempotency : {} }
  } catch {
    return { snapshotsByOwner: {}, snapshotsByOrg: {}, orgs: {}, auditByOrg: {}, idempotency: {} }
  }
}

function writeState(state) { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8') }
const state = readState()

function ensureOrg(context) {
  if (state.orgs[context.orgId]) {
    const role = state.orgs[context.orgId].members?.[context.subject]?.role
    return role || null
  }
  state.orgs[context.orgId] = { id: context.orgId, name: `Organization ${context.orgId}`, createdAt: nowIso(), members: { [context.subject]: { role: normalizeRole(context.roles[0], 'owner'), addedAt: nowIso() } } }
  writeState(state)
  return state.orgs[context.orgId].members[context.subject].role
}

function appendAudit(event) { state.auditByOrg[event.orgId] = state.auditByOrg[event.orgId] || []; state.auditByOrg[event.orgId].push(event); if (state.auditByOrg[event.orgId].length > 2000) state.auditByOrg[event.orgId] = state.auditByOrg[event.orgId].slice(-2000); writeState(state) }
function publishVaultUpdate(orgId, vaultId, revision, updatedAt) { const payload = JSON.stringify({ type: 'vault-updated', vaultId, revision, updatedAt }); for (const client of eventClients) { if (client.orgId !== orgId || client.vaultId !== vaultId) continue; try { client.res.write(`event: vault-updated\n`); client.res.write(`data: ${payload}\n\n`) } catch { eventClients.delete(client); metrics.sseDisconnectsTotal += 1 } } }
function verifyStreamToken(token) { const payload = verifyPayload(token, STREAM_TOKEN_SECRET); if (!payload || typeof payload !== 'object') return null; const orgId = typeof payload.orgId === 'string' ? payload.orgId : ''; const vaultId = typeof payload.vaultId === 'string' ? payload.vaultId : ''; const subject = typeof payload.subject === 'string' ? payload.subject : ''; const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''; const exp = Number(payload.exp); if (!orgId || !vaultId || !subject || !sessionId || !Number.isFinite(exp) || exp < Date.now()) return null; return { orgId, vaultId, subject, sessionId, exp } }

const server = createServer(async (req, res) => {
  metrics.requestsTotal += 1
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (!enforceRate(req, url.pathname)) { json(req, res, 429, { error: 'Rate limit exceeded' }); return }
  if (req.method === 'OPTIONS') { const cors = corsHeaders(req); if (!cors) { json(req, res, 403, { error: 'Origin not allowed' }); return } res.writeHead(204, cors); res.end(); return }
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') { json(req, res, 405, { error: 'Method not allowed' }); return }

  try {
    if (url.pathname === '/healthz' && req.method === 'GET') { json(req, res, 200, { ok: true, mode: ENTERPRISE_MODE ? 'enterprise' : 'standard', storage: 'file', now: nowIso() }); return }
    if (url.pathname === '/readyz' && req.method === 'GET') { json(req, res, 200, { ok: true }); return }
    if (url.pathname === '/metrics' && req.method === 'GET') { text(req, res, 200, ['# TYPE sync_requests_total counter', `sync_requests_total ${metrics.requestsTotal}`, '# TYPE sync_auth_failures_total counter', `sync_auth_failures_total ${metrics.authFailuresTotal}`, '# TYPE sync_push_conflicts_total counter', `sync_push_conflicts_total ${metrics.pushConflictsTotal}`, '# TYPE sync_sse_disconnects_total counter', `sync_sse_disconnects_total ${metrics.sseDisconnectsTotal}`, '# TYPE sync_rate_limited_total counter', `sync_rate_limited_total ${metrics.rateLimitedTotal}`].join('\n') + '\n'); return }

    if (url.pathname === '/v2/auth/status' && req.method === 'POST') { const c = resolveContext(req, url, ENTERPRISE_MODE); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 200, { authenticated: false, subject: null, email: null, name: null, tokenIdentifier: null, authContext: null }); return } const role = ensureOrg(c); appendAudit(makeAudit(c.orgId, c.subject, 'auth.status', 'sync-gateway', { sessionId: c.sessionId })); json(req, res, 200, { authenticated: true, subject: c.subject, email: null, name: null, tokenIdentifier: c.sessionId, authContext: { subject: c.subject, orgId: c.orgId, roles: [role], sessionId: c.sessionId } }); return }
    if (url.pathname === '/v2/entitlements/me' && req.method === 'GET') { const c = resolveContext(req, url, ENTERPRISE_MODE); if (c?.error) { metrics.authFailuresTotal += 1; json(req, res, 401, { ok: false, token: null, reason: c.error, expiresAt: null, fetchedAt: nowIso() }); return } json(req, res, 200, ENTITLEMENT_TOKEN ? { ok: true, token: ENTITLEMENT_TOKEN, reason: 'Server-issued entitlement token', expiresAt: null, fetchedAt: nowIso() } : { ok: false, token: null, reason: 'No signed entitlement token configured', expiresAt: null, fetchedAt: nowIso() }); return }
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
