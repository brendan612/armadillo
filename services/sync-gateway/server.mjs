import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.PORT || 8787)
const DATA_FILE = process.env.SYNC_DATA_FILE || path.join(__dirname, 'data.json')
const SSE_HEARTBEAT_MS = 20000
const STREAM_TOKEN_TTL_MS = 2 * 60 * 1000
const STREAM_TOKEN_SECRET = process.env.SYNC_STREAM_TOKEN_SECRET || crypto.randomBytes(32).toString('hex')
const eventClients = new Set()

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-armadillo-owner',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function normalizeOwnerHint(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64)
}

function normalizeToken(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 128)
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function createStreamToken(payload) {
  const payloadB64 = toBase64Url(JSON.stringify(payload))
  const signature = crypto
    .createHmac('sha256', STREAM_TOKEN_SECRET)
    .update(payloadB64)
    .digest('base64url')
  return `${payloadB64}.${signature}`
}

function verifyStreamToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null
  }
  const [payloadB64, signature] = token.split('.', 2)
  if (!payloadB64 || !signature) {
    return null
  }

  const expected = crypto
    .createHmac('sha256', STREAM_TOKEN_SECRET)
    .update(payloadB64)
    .digest('base64url')

  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(signature)
  if (expectedBuffer.length !== actualBuffer.length) {
    return null
  }
  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null
  }

  try {
    const decoded = JSON.parse(fromBase64Url(payloadB64))
    if (!decoded || typeof decoded !== 'object') return null
    if (typeof decoded.ownerId !== 'string' || typeof decoded.vaultId !== 'string' || typeof decoded.exp !== 'number') {
      return null
    }
    if (decoded.exp < Date.now()) {
      return null
    }
    return decoded
  } catch {
    return null
  }
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { snapshots: {}, orgs: {} }
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { snapshots: {}, orgs: {} }
    }
    return {
      snapshots: parsed.snapshots && typeof parsed.snapshots === 'object' ? parsed.snapshots : {},
      orgs: parsed.orgs && typeof parsed.orgs === 'object' ? parsed.orgs : {},
    }
  } catch {
    return { snapshots: {}, orgs: {} }
  }
}

function writeData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8')
}

function json(res, status, payload) {
  res.writeHead(status, {
    ...corsHeaders,
    'Content-Type': 'application/json',
  })
  res.end(JSON.stringify(payload))
}

function resolveOwner(req, url) {
  const authHeader = req.headers.authorization || ''
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) {
    const token = normalizeToken(bearerMatch[1] || '')
    if (token) {
      return { ownerId: `user:${token}`, ownerSource: 'auth' }
    }
  }

  const tokenFromQuery = normalizeToken(url?.searchParams?.get('token') || '')
  if (tokenFromQuery) {
    return { ownerId: `user:${tokenFromQuery}`, ownerSource: 'auth' }
  }

  const ownerHintHeader = normalizeOwnerHint(String(req.headers['x-armadillo-owner'] || ''))
  const ownerHintQuery = normalizeOwnerHint(String(url?.searchParams?.get('ownerHint') || ''))
  const ownerHint = ownerHintHeader || ownerHintQuery
  if (ownerHint) {
    return { ownerId: `anon:${ownerHint}`, ownerSource: 'anonymous' }
  }
  return null
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function parseEncryptedFile(encryptedFile) {
  try {
    return JSON.parse(encryptedFile)
  } catch {
    return null
  }
}

function listSnapshotsForOwner(data, ownerId) {
  const ownerRows = data.snapshots[ownerId] || {}
  return Object.values(ownerRows).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
}

function getMembershipRole(data, orgId, memberId) {
  return data.orgs?.[orgId]?.members?.[memberId]?.role || null
}

function canManageVault(role) {
  return role === 'owner' || role === 'admin'
}

function publishVaultUpdate(ownerId, vaultId, revision, updatedAt) {
  const payload = JSON.stringify({
    type: 'vault-updated',
    vaultId,
    revision,
    updatedAt,
  })
  for (const client of eventClients) {
    if (client.ownerId !== ownerId || client.vaultId !== vaultId) continue
    try {
      client.res.write(`event: vault-updated\n`)
      client.res.write(`data: ${payload}\n\n`)
    } catch {
      eventClients.delete(client)
    }
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders)
    res.end()
    return
  }

  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
    json(res, 405, { error: 'Method not allowed' })
    return
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const owner = resolveOwner(req, url)

    if (url.pathname === '/v1/auth/status') {
      if (!owner) {
        json(res, 200, { authenticated: false })
        return
      }

      const isAuth = owner.ownerSource === 'auth'
      json(res, 200, {
        authenticated: isAuth,
        subject: isAuth ? owner.ownerId : null,
        email: null,
        name: null,
        tokenIdentifier: null,
      })
      return
    }

    if (url.pathname === '/v1/events/stream' && req.method === 'GET') {
      const streamToken = (url.searchParams.get('streamToken') || '').trim()
      const verified = verifyStreamToken(streamToken)
      if (!verified) {
        json(res, 401, { error: 'Invalid or expired stream token' })
        return
      }

      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write(`event: ready\n`)
      res.write(`data: ${JSON.stringify({ ok: true, vaultId: verified.vaultId })}\n\n`)

      const client = {
        res,
        ownerId: verified.ownerId,
        vaultId: verified.vaultId,
      }
      eventClients.add(client)

      const heartbeat = setInterval(() => {
        try {
          res.write(`event: ping\n`)
          res.write(`data: ${Date.now()}\n\n`)
        } catch {
          // Cleanup is handled on close below.
        }
      }, SSE_HEARTBEAT_MS)

      const close = () => {
        clearInterval(heartbeat)
        eventClients.delete(client)
      }
      req.on('close', close)
      req.on('error', close)
      res.on('close', close)
      return
    }

    if (!owner) {
      json(res, 401, { error: 'Owner could not be resolved.' })
      return
    }

    if (url.pathname === '/v1/events/token' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const vaultId = typeof body.vaultId === 'string' ? body.vaultId.trim() : ''
      if (!vaultId) {
        json(res, 400, { error: 'vaultId is required' })
        return
      }
      const expiresAtMs = Date.now() + STREAM_TOKEN_TTL_MS
      const streamToken = createStreamToken({
        ownerId: owner.ownerId,
        vaultId,
        exp: expiresAtMs,
      })
      json(res, 200, {
        streamToken,
        expiresAt: new Date(expiresAtMs).toISOString(),
      })
      return
    }

    const data = readData()

    if (url.pathname === '/v1/orgs' && req.method === 'GET') {
      const orgs = Object.values(data.orgs || {})
        .filter((org) => org?.members?.[owner.ownerId])
        .map((org) => ({
          id: org.id,
          name: org.name,
          role: org.members[owner.ownerId].role,
          createdAt: org.createdAt,
        }))
      json(res, 200, { orgs })
      return
    }

    if (url.pathname === '/v1/orgs' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const providedId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
      const orgId = (providedId || `org_${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)

      if (!name) {
        json(res, 400, { error: 'name is required' })
        return
      }
      if (!orgId) {
        json(res, 400, { error: 'orgId could not be derived' })
        return
      }
      if (data.orgs[orgId]) {
        json(res, 409, { error: 'org already exists' })
        return
      }

      data.orgs[orgId] = {
        id: orgId,
        name,
        createdAt: new Date().toISOString(),
        members: {
          [owner.ownerId]: {
            role: 'owner',
            addedAt: new Date().toISOString(),
          },
        },
        vaultMembers: {},
        vaultRecovery: {},
      }
      writeData(data)
      json(res, 200, {
        org: {
          id: data.orgs[orgId].id,
          name: data.orgs[orgId].name,
          role: 'owner',
          createdAt: data.orgs[orgId].createdAt,
        },
      })
      return
    }

    if (url.pathname === '/v1/vaults/pull-by-owner') {
      const snapshots = listSnapshotsForOwner(data, owner.ownerId)
      const latest = snapshots[0]
      json(res, 200, {
        snapshot: latest ? parseEncryptedFile(latest.encryptedFile) : null,
        ownerSource: owner.ownerSource,
      })
      return
    }

    if (url.pathname === '/v1/vaults/list-by-owner') {
      const snapshots = listSnapshotsForOwner(data, owner.ownerId)
        .map((row) => parseEncryptedFile(row.encryptedFile))
        .filter(Boolean)
      json(res, 200, {
        snapshots,
        ownerSource: owner.ownerSource,
      })
      return
    }

    const pullMatch = url.pathname.match(/^\/v1\/vaults\/([^/]+)\/pull$/)
    if (pullMatch) {
      const vaultId = decodeURIComponent(pullMatch[1])
      const ownerRows = data.snapshots[owner.ownerId] || {}
      const entry = ownerRows[vaultId]
      json(res, 200, {
        snapshot: entry ? parseEncryptedFile(entry.encryptedFile) : null,
        ownerSource: owner.ownerSource,
      })
      return
    }

    const pushMatch = url.pathname.match(/^\/v1\/vaults\/([^/]+)\/push$/)
    if (pushMatch) {
      const vaultId = decodeURIComponent(pushMatch[1])
      const body = await readJsonBody(req)
      const revision = Number(body.revision)
      const encryptedFile = typeof body.encryptedFile === 'string' ? body.encryptedFile : ''
      const updatedAt = typeof body.updatedAt === 'string' ? body.updatedAt : ''

      if (!Number.isFinite(revision) || !encryptedFile || !updatedAt) {
        json(res, 400, { error: 'revision, encryptedFile, and updatedAt are required' })
        return
      }

      const ownerRows = data.snapshots[owner.ownerId] || {}
      const existing = ownerRows[vaultId]
      if (existing && revision <= Number(existing.revision || 0)) {
        json(res, 200, { ok: true, accepted: false, ownerSource: owner.ownerSource })
        return
      }

      data.snapshots[owner.ownerId] = {
        ...ownerRows,
        [vaultId]: {
          vaultId,
          revision,
          encryptedFile,
          updatedAt,
        },
      }
      writeData(data)
      publishVaultUpdate(owner.ownerId, vaultId, revision, updatedAt)

      json(res, 200, { ok: true, accepted: true, ownerSource: owner.ownerSource })
      return
    }

    const addMemberMatch = url.pathname.match(/^\/v1\/vaults\/([^/]+)\/members$/)
    if (addMemberMatch && req.method === 'POST') {
      const vaultId = decodeURIComponent(addMemberMatch[1])
      const body = await readJsonBody(req)
      const orgId = typeof body.orgId === 'string' ? body.orgId : ''
      const memberId = typeof body.memberId === 'string' ? body.memberId : ''
      const role = body.role === 'owner' || body.role === 'admin' || body.role === 'editor' || body.role === 'viewer'
        ? body.role
        : ''
      const wrappedKey = typeof body.wrappedKey === 'string' ? body.wrappedKey : ''

      if (!orgId || !memberId || !role || !wrappedKey) {
        json(res, 400, { error: 'orgId, memberId, role, and wrappedKey are required' })
        return
      }
      if (!data.orgs[orgId]) {
        json(res, 404, { error: 'org not found' })
        return
      }

      const requesterRole = getMembershipRole(data, orgId, owner.ownerId)
      if (!canManageVault(requesterRole)) {
        json(res, 403, { error: 'forbidden' })
        return
      }

      data.orgs[orgId].vaultMembers = data.orgs[orgId].vaultMembers || {}
      data.orgs[orgId].vaultMembers[vaultId] = data.orgs[orgId].vaultMembers[vaultId] || {}
      data.orgs[orgId].vaultMembers[vaultId][memberId] = {
        memberId,
        role,
        wrappedKey,
        createdAt: new Date().toISOString(),
      }
      writeData(data)

      json(res, 200, { ok: true })
      return
    }

    const deleteMemberMatch = url.pathname.match(/^\/v1\/vaults\/([^/]+)\/members\/([^/]+)$/)
    if (deleteMemberMatch && req.method === 'DELETE') {
      const vaultId = decodeURIComponent(deleteMemberMatch[1])
      const memberId = decodeURIComponent(deleteMemberMatch[2])
      const orgId = url.searchParams.get('orgId') || ''
      if (!orgId || !data.orgs[orgId]) {
        json(res, 404, { error: 'org not found' })
        return
      }
      const requesterRole = getMembershipRole(data, orgId, owner.ownerId)
      if (!canManageVault(requesterRole)) {
        json(res, 403, { error: 'forbidden' })
        return
      }

      if (data.orgs[orgId].vaultMembers?.[vaultId]?.[memberId]) {
        delete data.orgs[orgId].vaultMembers[vaultId][memberId]
        writeData(data)
      }
      json(res, 200, { ok: true })
      return
    }

    const rekeyMatch = url.pathname.match(/^\/v1\/vaults\/([^/]+)\/rekey$/)
    if (rekeyMatch && req.method === 'POST') {
      const vaultId = decodeURIComponent(rekeyMatch[1])
      const body = await readJsonBody(req)
      const orgId = typeof body.orgId === 'string' ? body.orgId : ''
      const wrappedKeys = Array.isArray(body.wrappedKeys) ? body.wrappedKeys : []
      const recovery = body.recovery && typeof body.recovery === 'object' ? body.recovery : {}
      if (!orgId || !data.orgs[orgId]) {
        json(res, 404, { error: 'org not found' })
        return
      }
      const requesterRole = getMembershipRole(data, orgId, owner.ownerId)
      if (!canManageVault(requesterRole)) {
        json(res, 403, { error: 'forbidden' })
        return
      }

      data.orgs[orgId].vaultMembers = data.orgs[orgId].vaultMembers || {}
      data.orgs[orgId].vaultMembers[vaultId] = {}
      for (const row of wrappedKeys) {
        const memberId = typeof row?.memberId === 'string' ? row.memberId : ''
        const role = row?.role === 'owner' || row?.role === 'admin' || row?.role === 'editor' || row?.role === 'viewer'
          ? row.role
          : 'viewer'
        const wrappedKey = typeof row?.wrappedKey === 'string' ? row.wrappedKey : ''
        if (!memberId || !wrappedKey) continue
        data.orgs[orgId].vaultMembers[vaultId][memberId] = {
          memberId,
          role,
          wrappedKey,
          createdAt: new Date().toISOString(),
        }
      }

      data.orgs[orgId].vaultRecovery = data.orgs[orgId].vaultRecovery || {}
      data.orgs[orgId].vaultRecovery[vaultId] = {
        enabled: Boolean(recovery.enabled),
        wrappedKeyForOrg: typeof recovery.wrappedKeyForOrg === 'string' ? recovery.wrappedKeyForOrg : '',
        updatedAt: new Date().toISOString(),
      }
      writeData(data)
      json(res, 200, { ok: true })
      return
    }

    json(res, 404, { error: 'Not found' })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown server error' })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[sync-gateway] listening on http://localhost:${PORT}`)
  console.log(`[sync-gateway] data file: ${DATA_FILE}`)
})
