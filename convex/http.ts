import { httpRouter } from 'convex/server'
import { api } from './_generated/api'
import { httpAction } from './_generated/server'
import { auth } from './auth'

type OwnerSource = 'auth' | 'anonymous'

const http = httpRouter()
auth.addHttpRoutes(http)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-armadillo-owner, x-armadillo-org, x-armadillo-session',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}
const MAX_BLOB_FILE_BYTES = Number(process.env.SYNC_MAX_BLOB_FILE_BYTES || 20 * 1024 * 1024)
const MAX_BLOB_TOTAL_BYTES = Number(process.env.SYNC_MAX_BLOB_TOTAL_BYTES || 2 * 1024 * 1024 * 1024)
const SYNC_ENTITLEMENT_TOKEN = (process.env.SYNC_ENTITLEMENT_TOKEN || '').trim()
const ENTITLEMENT_VERIFY_JWKS = (process.env.ENTITLEMENT_VERIFY_JWKS || '').trim()
const ADMIN_ALLOWLIST_EMAILS = new Set(
  (process.env.ADMIN_ALLOWLIST_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
)
const ADMIN_ALLOWLIST_SUBJECTS = new Set(
  (process.env.ADMIN_ALLOWLIST_SUBJECTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)

type Role = 'owner' | 'admin' | 'editor' | 'viewer'
type AdminPermissionResult = {
  allowlisted: boolean
  capability: boolean
  superAdmin: boolean
  allowed: boolean
  reasons: string[]
}
type AdminIdentity = {
  subject: string
  email: string | null
  name: string | null
  tokenIdentifier: string | null
  orgId: string
  roles: Role[]
}
type AdminContext = {
  identity: AdminIdentity
  permissions: AdminPermissionResult
}

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function nowIso(value = Date.now()) {
  return new Date(value).toISOString()
}

async function resolveIdentity(
  ctx: { auth?: { getUserIdentity?: () => Promise<Record<string, unknown> | null> } },
) {
  try {
    const identity = await ctx.auth?.getUserIdentity?.()
    if (!identity) {
      return null
    }

    const subject = typeof identity.subject === 'string' ? identity.subject : null
    const email = typeof identity.email === 'string' ? identity.email : null
    const name = typeof identity.name === 'string' ? identity.name : null
    const tokenIdentifier = typeof identity.tokenIdentifier === 'string' ? identity.tokenIdentifier : null

    if (!subject && !tokenIdentifier) {
      return null
    }

    return { subject, email, name, tokenIdentifier }
  } catch {
    return null
  }
}

function normalizeOverrideTargetValue(targetType: 'userId' | 'tokenIdentifier' | 'subject' | 'email', value: string) {
  const trimmed = value.trim()
  return targetType === 'email' ? trimmed.toLowerCase() : trimmed
}

type EntitlementOverrideTargetType = 'userId' | 'tokenIdentifier' | 'subject' | 'email'

async function findEntitlementOverrideToken(
  ctx: { runQuery: (...args: unknown[]) => Promise<unknown> },
  args: {
    targetType: EntitlementOverrideTargetType
    targetValue: string
  },
) {
  const normalized = normalizeOverrideTargetValue(args.targetType, args.targetValue)
  if (!normalized) return null

  const tokenRaw = await ctx.runQuery(api.sync.getEntitlementOverrideToken, {
    targetType: args.targetType,
    targetValue: normalized,
  })
  const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : ''
  return token || null
}

async function resolveEntitlementTokenForIdentity(
  ctx: { runQuery: (...args: unknown[]) => Promise<unknown> },
  identity: { subject: string | null; email: string | null; name: string | null; tokenIdentifier: string | null } | null,
) {
  if (!identity) return null

  const userIdFromSubject = identity.subject ? identity.subject.split('|')[0] : ''
  const candidates: Array<{ targetType: EntitlementOverrideTargetType; targetValue: string }> = [
    { targetType: 'userId', targetValue: userIdFromSubject || '' },
    { targetType: 'tokenIdentifier', targetValue: identity.tokenIdentifier || '' },
    { targetType: 'subject', targetValue: identity.subject || '' },
    { targetType: 'email', targetValue: identity.email || '' },
  ]

  for (const candidate of candidates) {
    if (!candidate.targetValue) continue
    const token = await findEntitlementOverrideToken(ctx, candidate)
    if (token) {
      return { token, source: `${candidate.targetType}:${normalizeOverrideTargetValue(candidate.targetType, candidate.targetValue)}` }
    }
  }
  return null
}

function hasRole(role: Role, required: Role) {
  return ROLE_RANK[role] >= ROLE_RANK[required]
}

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

function parseJwksKeys() {
  if (!ENTITLEMENT_VERIFY_JWKS) return []
  try {
    const parsed = JSON.parse(ENTITLEMENT_VERIFY_JWKS) as { keys?: JsonWebKey[] } | JsonWebKey[]
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.keys)) return parsed.keys
  } catch {
    return []
  }
  return []
}

function normalizeOrgId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
}

function defaultOrgIdForSubject(subject: string) {
  const userId = subject.split('|')[0] || subject
  const normalizedUser = normalizeOrgId(userId).toLowerCase() || 'unknown'
  return `org_${normalizedUser}`
}

function parseCursor(cursorRaw: string | null) {
  if (!cursorRaw) return null
  const [createdAt, id] = cursorRaw.split('|')
  if (!createdAt || !id) return null
  const parsed = Date.parse(createdAt)
  if (!Number.isFinite(parsed)) return null
  return { createdAt: new Date(parsed).toISOString(), id }
}

function encodeCursor(createdAt: string, id: string) {
  return `${createdAt}|${id}`
}

function isTargetType(value: unknown): value is EntitlementOverrideTargetType {
  return value === 'userId' || value === 'tokenIdentifier' || value === 'subject' || value === 'email'
}

function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer'
}

async function verifyEntitlementCapability(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { ok: false, reason: 'Token format is invalid' as const }
  }

  const [encodedHeader, encodedPayload, encodedSig] = parts
  const header = decodeJsonPart<{ kid?: unknown; alg?: unknown }>(encodedHeader)
  if (!header || typeof header.kid !== 'string' || !header.kid) {
    return { ok: false, reason: 'Token kid is missing' as const }
  }
  if (header.alg !== 'EdDSA') {
    return { ok: false, reason: 'Token alg must be EdDSA' as const }
  }

  const payload = decodeJsonPart<Record<string, unknown>>(encodedPayload)
  if (!payload) {
    return { ok: false, reason: 'Token payload is invalid' as const }
  }

  const exp = Number(payload.exp)
  const iat = Number(payload.iat)
  const nbf = payload.nbf === undefined ? undefined : Number(payload.nbf)
  const aud = payload.aud
  const capabilities = Array.isArray(payload.capabilities)
    ? payload.capabilities.filter((value): value is string => typeof value === 'string')
    : []

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(exp) || !Number.isFinite(iat)) {
    return { ok: false, reason: 'Token timing claims are invalid' as const }
  }
  if (exp <= nowSeconds - 300) {
    return { ok: false, reason: 'Token is expired' as const }
  }
  if (Number.isFinite(nbf) && Number(nbf) > nowSeconds + 300) {
    return { ok: false, reason: 'Token is not active yet' as const }
  }
  if (iat > nowSeconds + 300) {
    return { ok: false, reason: 'Token issued-at is invalid' as const }
  }

  const audienceMatches = typeof aud === 'string'
    ? aud === 'armadillo'
    : Array.isArray(aud) && aud.includes('armadillo')
  if (!audienceMatches) {
    return { ok: false, reason: 'Token audience is invalid' as const }
  }

  if (!capabilities.includes('enterprise.org_admin')) {
    return { ok: false, reason: 'Token is missing enterprise.org_admin capability' as const }
  }

  const keys = parseJwksKeys()
  if (keys.length === 0) {
    return { ok: false, reason: 'ENTITLEMENT_VERIFY_JWKS is missing' as const }
  }
  const jwk = keys.find((key) => key.kid === header.kid)
  if (!jwk) {
    return { ok: false, reason: 'Token key id is unknown' as const }
  }

  try {
    const verifierKey = await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['verify'])
    const payloadBytes = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    const sigBytes = decodeBase64Url(encodedSig)
    const verified = await crypto.subtle.verify('Ed25519', verifierKey, sigBytes, payloadBytes)
    if (!verified) {
      return { ok: false, reason: 'Token signature verification failed' as const }
    }
  } catch {
    return { ok: false, reason: 'Token signature verification failed' as const }
  }

  return { ok: true, reason: '' as const }
}

type IdentityLookupCtx = {
  auth?: { getUserIdentity?: () => Promise<Record<string, unknown> | null> }
  runQuery: (...args: unknown[]) => Promise<unknown>
}
type AdminContextDeps = IdentityLookupCtx & { runMutation: (...args: unknown[]) => Promise<unknown> }

async function resolveIdentityWithProfile(ctx: IdentityLookupCtx) {
  const identity = await resolveIdentity(ctx)
  if (!identity) return null

  let email = identity.email
  let name = identity.name

  if ((!email || !name) && identity.tokenIdentifier) {
    try {
      const profile = await ctx.runQuery(api.sync.getUserProfile, {
        tokenIdentifier: identity.tokenIdentifier,
      }) as { email?: string | null; name?: string | null } | null
      if (profile) {
        email = email || profile.email || null
        name = name || profile.name || null
      }
    } catch {
      // continue
    }
  }

  return {
    subject: identity.subject || '',
    email: email || null,
    name: name || null,
    tokenIdentifier: identity.tokenIdentifier || null,
  }
}

async function ensureMemberRole(
  ctx: { runMutation: (...args: unknown[]) => Promise<unknown> },
  orgId: string,
  memberId: string,
) {
  const role = await ctx.runMutation(api.sync.ensureOrgMemberRole, {
    orgId,
    memberId,
    now: nowIso(),
  })
  return isRole(role) ? role : 'owner'
}

async function getMemberRole(
  ctx: { runQuery: (...args: unknown[]) => Promise<unknown> },
  orgId: string,
  memberId: string,
) {
  const role = await ctx.runQuery(api.sync.getOrgMemberRole, {
    orgId,
    memberId,
  })
  return isRole(role) ? role : null
}

async function appendAdminAudit(
  ctx: { runMutation: (...args: unknown[]) => Promise<unknown> },
  input: {
    orgId: string
    actorSubject: string
    action: string
    target: string
    metadata?: Record<string, unknown>
  },
) {
  await ctx.runMutation(api.sync.appendOrgAuditEvent, {
    orgId: input.orgId,
    actorSubject: input.actorSubject,
    action: input.action,
    target: input.target,
    createdAt: nowIso(),
    metadata: input.metadata,
  })
}

async function resolveAdminContext(ctx: AdminContextDeps, request: Request) {
  try {
    const identity = await resolveIdentityWithProfile(ctx)
    if (!identity?.subject) {
      return { error: 'Authentication required' as const, status: 401 }
    }

    const requestedOrgId = normalizeOrgId(request.headers.get('x-armadillo-org') || '')
    const defaultOrgId = defaultOrgIdForSubject(identity.subject)
    const orgId = requestedOrgId || defaultOrgId

    const allowlisted = ADMIN_ALLOWLIST_SUBJECTS.has(identity.subject)
      || Boolean(identity.email && ADMIN_ALLOWLIST_EMAILS.has(identity.email.toLowerCase()))

    const resolvedEntitlement = await resolveEntitlementTokenForIdentity(ctx, identity)
    const entitlementToken = resolvedEntitlement?.token || SYNC_ENTITLEMENT_TOKEN
    const capabilityResult = entitlementToken
      ? await verifyEntitlementCapability(entitlementToken)
      : { ok: false, reason: 'No signed entitlement token available' }
    const superAdmin = allowlisted && capabilityResult.ok
    const memberRole = superAdmin
      ? ((await getMemberRole(ctx, orgId, identity.subject)) ?? 'owner')
      : await ensureMemberRole(ctx, orgId, identity.subject)

    const reasons: string[] = []
    if (!allowlisted) reasons.push('Identity is not in admin allowlist')
    if (!capabilityResult.ok) reasons.push(capabilityResult.reason)
    if (!superAdmin && !hasRole(memberRole, 'admin')) reasons.push('Org role is not admin or owner')

    const permissions: AdminPermissionResult = {
      allowlisted,
      capability: capabilityResult.ok,
      superAdmin,
      allowed: reasons.length === 0,
      reasons,
    }
    const adminIdentity: AdminIdentity = {
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      tokenIdentifier: identity.tokenIdentifier,
      orgId,
      roles: [memberRole],
    }

    return { context: { identity: adminIdentity, permissions } satisfies AdminContext, status: 200 as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Admin context resolution failed'
    return { error: message, status: 500 as const }
  }
}

function normalizeOwnerHint(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64)
}

async function resolveOwner(
  ctx: { auth?: { getUserIdentity?: () => Promise<{ subject?: string } | null> } },
  request: Request,
) {
  try {
    const identity = await ctx.auth?.getUserIdentity?.()
    if (identity?.subject) {
      const userId = identity.subject.split('|')[0]
      return { ownerId: `user:${userId}`, ownerSource: 'auth' as OwnerSource }
    }
  } catch {
    // Fall through to anonymous owner hint for offline/unauthenticated mode.
  }

  const ownerHintRaw = request.headers.get('x-armadillo-owner') || ''
  const ownerHint = normalizeOwnerHint(ownerHintRaw)
  if (!ownerHint) {
    return null
  }

  return { ownerId: `anon:${ownerHint}`, ownerSource: 'anonymous' as OwnerSource }
}

http.route({
  path: '/api/auth/status',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/auth/status',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/entitlements/me',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/auth/status',
  method: 'POST',
  handler: httpAction(async (ctx) => {
    const identity = await resolveIdentityWithProfile(ctx)
    if (!identity) {
      return json({ authenticated: false })
    }
    const response = {
      authenticated: true,
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      tokenIdentifier: identity.tokenIdentifier,
    }
    return json(response)
  }),
})

http.route({
  path: '/api/v2/auth/status',
  method: 'POST',
  handler: httpAction(async (ctx) => {
    const identity = await resolveIdentityWithProfile(ctx)
    if (!identity) {
      return json({ authenticated: false })
    }
    const response = {
      authenticated: true,
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      tokenIdentifier: identity.tokenIdentifier,
    }
    return json(response)
  }),
})

http.route({
  path: '/api/v2/entitlements/me',
  method: 'GET',
  handler: httpAction(async (ctx) => {
    try {
      const identity = await resolveIdentity(ctx)
      const override = await resolveEntitlementTokenForIdentity(ctx, identity)
      const token = override?.token || SYNC_ENTITLEMENT_TOKEN
      const source = override ? `User override (${override.source})` : 'Server-issued entitlement token'
      return json(
        token
          ? {
            ok: true,
            token,
            reason: source,
            expiresAt: null,
            fetchedAt: nowIso(),
          }
          : {
            ok: false,
            token: null,
            reason: 'No signed entitlement token configured',
            expiresAt: null,
            fetchedAt: nowIso(),
          },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Entitlement lookup failed'
      return json(
        {
          ok: false,
          token: null,
          reason: message,
          expiresAt: null,
          fetchedAt: nowIso(),
        },
        500,
      )
    }
  }),
})

http.route({
  path: '/api/v2/admin/me',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/members',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/audit',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/entitlements/overrides',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/orgs',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/me',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    return json({
      authenticated: true,
      identity: resolved.context.identity,
      permissions: resolved.context.permissions,
    })
  }),
})

http.route({
  path: '/api/v2/admin/members',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const orgId = normalizeOrgId(new URL(request.url).searchParams.get('orgId') || '')
    if (!orgId || orgId !== resolved.context.identity.orgId) {
      return json({ error: 'orgId is required and must match your admin org' }, 400)
    }

    const rows = await ctx.runQuery(api.sync.listOrgMembers, { orgId }) as Array<{
      memberId: string
      role: Role
      addedAt: string
    }>
    const members = rows
      .slice()
      .sort((a, b) => (a.memberId > b.memberId ? 1 : -1))
      .map((row) => ({
        memberId: row.memberId,
        role: row.role,
        addedAt: row.addedAt,
      }))
    return json({ members })
  }),
})

http.route({
  path: '/api/v2/admin/members',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const body = await request.json() as { orgId?: unknown; memberId?: unknown; role?: unknown }
    const orgId = normalizeOrgId(typeof body.orgId === 'string' ? body.orgId : '')
    const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
    const role = body.role
    if (!orgId || orgId !== resolved.context.identity.orgId) {
      return json({ error: 'orgId is required and must match your admin org' }, 400)
    }
    if (!memberId) {
      return json({ error: 'memberId is required' }, 400)
    }
    if (!isRole(role)) {
      return json({ error: 'role is invalid' }, 400)
    }

    const now = nowIso()
    const upserted = await ctx.runMutation(api.sync.upsertOrgMember, {
      orgId,
      memberId,
      role,
      now,
      actorSubject: resolved.context.identity.subject,
    }) as { addedAt?: string } | null

    await appendAdminAudit(ctx, {
      orgId,
      actorSubject: resolved.context.identity.subject,
      action: 'org.member.upsert',
      target: memberId,
      metadata: { role },
    })

    return json({
      member: {
        memberId,
        role,
        addedAt: upserted?.addedAt || now,
      },
    })
  }),
})

http.route({
  path: '/api/v2/admin/orgs',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const rows = await ctx.runQuery(api.sync.listAdminOrgs, {
      subject: resolved.context.identity.subject,
      includeAll: resolved.context.permissions.superAdmin,
      fallbackOrgId: resolved.context.identity.orgId,
    }) as { orgs?: Array<{
      id: string
      name: string
      createdAt: string
      createdBy?: string
      myRole?: Role | null
      memberCount?: number
    }> } | null
    return json({
      orgs: (rows?.orgs || []).map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        createdBy: row.createdBy ?? null,
        myRole: row.myRole ?? null,
        memberCount: row.memberCount ?? 0,
      })),
    })
  }),
})

http.route({
  path: '/api/v2/admin/orgs',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const body = await request.json() as { orgId?: unknown; name?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
    const orgId = normalizeOrgId(requestedOrgId || `org_${Date.now().toString(36)}`)
    if (!name) {
      return json({ error: 'name is required' }, 400)
    }
    if (!orgId) {
      return json({ error: 'orgId is invalid' }, 400)
    }

    const now = nowIso()
    const result = await ctx.runMutation(api.sync.createAdminOrg, {
      orgId,
      name,
      actorSubject: resolved.context.identity.subject,
      now,
    }) as {
      org?: { id?: string; name?: string; createdAt?: string; createdBy?: string | null; myRole?: Role | null }
      created?: boolean
    } | null

    await appendAdminAudit(ctx, {
      orgId,
      actorSubject: resolved.context.identity.subject,
      action: 'org.create',
      target: orgId,
      metadata: { name },
    })

    return json({
      created: Boolean(result?.created),
      org: {
        id: result?.org?.id || orgId,
        name: result?.org?.name || name,
        createdAt: result?.org?.createdAt || now,
        createdBy: result?.org?.createdBy || resolved.context.identity.subject,
        myRole: result?.org?.myRole || 'owner',
      },
    })
  }),
})

http.route({
  path: '/api/v2/admin/members',
  method: 'DELETE',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const url = new URL(request.url)
    const orgId = normalizeOrgId(url.searchParams.get('orgId') || '')
    const memberId = (url.searchParams.get('memberId') || '').trim()
    if (!orgId || orgId !== resolved.context.identity.orgId) {
      return json({ error: 'orgId is required and must match your admin org' }, 400)
    }
    if (!memberId) {
      return json({ error: 'memberId is required' }, 400)
    }

    const deletion = await ctx.runMutation(api.sync.deleteOrgMember, {
      orgId,
      memberId,
    }) as { deleted?: boolean } | null
    await appendAdminAudit(ctx, {
      orgId,
      actorSubject: resolved.context.identity.subject,
      action: 'org.member.remove',
      target: memberId,
    })

    return json({ ok: true, deleted: Boolean(deletion?.deleted) })
  }),
})

http.route({
  path: '/api/v2/admin/audit',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const url = new URL(request.url)
    const orgId = normalizeOrgId(url.searchParams.get('orgId') || '')
    if (!orgId || orgId !== resolved.context.identity.orgId) {
      return json({ error: 'orgId is required and must match your admin org' }, 400)
    }

    const limitRaw = Number(url.searchParams.get('limit') || 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.round(limitRaw))) : 50
    const cursor = parseCursor(url.searchParams.get('cursor'))

    const rows = await ctx.runQuery(api.sync.listOrgAuditEvents, { orgId }) as Array<{
      _id: string
      orgId: string
      actorSubject: string
      action: string
      target: string
      createdAt: string
      metadata?: Record<string, unknown>
    }>

    const sorted = rows.slice().sort((a, b) => {
      if (a.createdAt === b.createdAt) return String(b._id).localeCompare(String(a._id))
      return b.createdAt > a.createdAt ? 1 : -1
    })

    const filtered = cursor
      ? sorted.filter((row) => (
        row.createdAt < cursor.createdAt
        || (row.createdAt === cursor.createdAt && String(row._id) < cursor.id)
      ))
      : sorted

    const page = filtered.slice(0, limit)
    const next = filtered.length > limit ? filtered[limit - 1] : null

    return json({
      events: page.map((row) => ({
        id: String(row._id),
        orgId: row.orgId,
        actorSubject: row.actorSubject,
        action: row.action,
        target: row.target,
        createdAt: row.createdAt,
        metadata: row.metadata || undefined,
      })),
      nextCursor: next ? encodeCursor(next.createdAt, String(next._id)) : null,
    })
  }),
})

http.route({
  path: '/api/v2/admin/entitlements/overrides',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const url = new URL(request.url)
    const limitRaw = Number(url.searchParams.get('limit') || 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.round(limitRaw))) : 50
    const cursor = parseCursor(url.searchParams.get('cursor'))

    const rows = await ctx.runQuery(api.sync.listEntitlementOverrides, {}) as Array<{
      _id: string
      targetType: EntitlementOverrideTargetType
      targetValue: string
      note?: string
      updatedAt: string
      updatedBy: string
    }>
    const sorted = rows.slice().sort((a, b) => {
      if (a.updatedAt === b.updatedAt) return String(b._id).localeCompare(String(a._id))
      return b.updatedAt > a.updatedAt ? 1 : -1
    })
    const filtered = cursor
      ? sorted.filter((row) => (
        row.updatedAt < cursor.createdAt
        || (row.updatedAt === cursor.createdAt && String(row._id) < cursor.id)
      ))
      : sorted
    const page = filtered.slice(0, limit)
    const next = filtered.length > limit ? filtered[limit - 1] : null

    return json({
      overrides: page.map((row) => ({
        id: String(row._id),
        targetType: row.targetType,
        targetValue: row.targetValue,
        note: row.note ?? '',
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      })),
      nextCursor: next ? encodeCursor(next.updatedAt, String(next._id)) : null,
    })
  }),
})

http.route({
  path: '/api/v2/admin/entitlements/overrides',
  method: 'PUT',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const body = await request.json() as {
      targetType?: unknown
      targetValue?: unknown
      token?: unknown
      note?: unknown
    }
    if (!isTargetType(body.targetType)) {
      return json({ error: 'targetType is invalid' }, 400)
    }
    const targetValue = normalizeOverrideTargetValue(body.targetType, typeof body.targetValue === 'string' ? body.targetValue : '')
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (!targetValue) {
      return json({ error: 'targetValue is required' }, 400)
    }
    if (token.split('.').length !== 3) {
      return json({ error: 'token must be a signed JWT' }, 400)
    }

    const now = nowIso()
    const updatedBy = resolved.context.identity.subject
    const upserted = await ctx.runMutation(api.sync.upsertEntitlementOverride, {
      targetType: body.targetType,
      targetValue,
      token,
      note,
      updatedAt: now,
      updatedBy,
    }) as { id?: string } | null

    await appendAdminAudit(ctx, {
      orgId: resolved.context.identity.orgId,
      actorSubject: updatedBy,
      action: 'entitlement.override.upsert',
      target: `${body.targetType}:${targetValue}`,
    })

    return json({
      ok: true,
      override: {
        id: upserted?.id || '',
        targetType: body.targetType,
        targetValue,
        note,
        updatedAt: now,
        updatedBy,
      },
    })
  }),
})

http.route({
  path: '/api/v2/admin/entitlements/overrides',
  method: 'DELETE',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const body = await request.json() as { targetType?: unknown; targetValue?: unknown }
    if (!isTargetType(body.targetType)) {
      return json({ error: 'targetType is invalid' }, 400)
    }
    const targetValue = normalizeOverrideTargetValue(body.targetType, typeof body.targetValue === 'string' ? body.targetValue : '')
    if (!targetValue) {
      return json({ error: 'targetValue is required' }, 400)
    }

    const deletion = await ctx.runMutation(api.sync.deleteEntitlementOverride, {
      targetType: body.targetType,
      targetValue,
    }) as { deleted?: boolean } | null

    await appendAdminAudit(ctx, {
      orgId: resolved.context.identity.orgId,
      actorSubject: resolved.context.identity.subject,
      action: 'entitlement.override.delete',
      target: `${body.targetType}:${targetValue}`,
    })

    return json({ ok: true, deleted: Boolean(deletion?.deleted) })
  }),
})

http.route({
  path: '/api/sync/pull',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/pull',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/sync/push',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/push',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/sync/pull-by-owner',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/pull-by-owner',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/sync/list-by-owner',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/list-by-owner',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/blobs/put',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/blobs/get',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/blobs/delete',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/vaults/delete',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/sync/pull-by-owner',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    let snapshot = await ctx.runQuery(api.sync.pullByOwner, {
      ownerId: owner.ownerId,
    })

    if (!snapshot && owner.ownerSource === 'auth' && owner.ownerId.startsWith('user:')) {
      const userId = owner.ownerId.slice('user:'.length)
      snapshot = await ctx.runQuery(api.sync.pullByLegacyUserPrefix, { userId })
    }

    return json({ snapshot: snapshot ? JSON.parse(snapshot.encryptedFile) : null, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/pull-by-owner',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    let snapshot = await ctx.runQuery(api.sync.pullByOwner, {
      ownerId: owner.ownerId,
    })

    if (!snapshot && owner.ownerSource === 'auth' && owner.ownerId.startsWith('user:')) {
      const userId = owner.ownerId.slice('user:'.length)
      snapshot = await ctx.runQuery(api.sync.pullByLegacyUserPrefix, { userId })
    }

    return json({ snapshot: snapshot ? JSON.parse(snapshot.encryptedFile) : null, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/sync/list-by-owner',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const seen = new Set<string>()
    const entries: Array<{ vaultId: string; revision: number; encryptedFile: string; updatedAt: string }> = []

    const primary = await ctx.runQuery(api.sync.listByOwner, {
      ownerId: owner.ownerId,
    })

    for (const entry of primary) {
      const key = `${entry.ownerId}|${entry.vaultId}|${entry.revision}|${entry.updatedAt}`
      if (!seen.has(key)) {
        seen.add(key)
        entries.push({
          vaultId: entry.vaultId,
          revision: entry.revision,
          encryptedFile: entry.encryptedFile,
          updatedAt: entry.updatedAt,
        })
      }
    }

    if (owner.ownerSource === 'auth' && owner.ownerId.startsWith('user:')) {
      const userId = owner.ownerId.slice('user:'.length)
      const legacy = await ctx.runQuery(api.sync.listByLegacyUserPrefix, { userId })
      for (const entry of legacy) {
        const key = `${entry.ownerId}|${entry.vaultId}|${entry.revision}|${entry.updatedAt}`
        if (!seen.has(key)) {
          seen.add(key)
          entries.push({
            vaultId: entry.vaultId,
            revision: entry.revision,
            encryptedFile: entry.encryptedFile,
            updatedAt: entry.updatedAt,
          })
        }
      }
    }

    const snapshots = entries
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      .map((entry) => JSON.parse(entry.encryptedFile))

    return json({ snapshots, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/list-by-owner',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const seen = new Set<string>()
    const entries: Array<{ vaultId: string; revision: number; encryptedFile: string; updatedAt: string }> = []

    const primary = await ctx.runQuery(api.sync.listByOwner, {
      ownerId: owner.ownerId,
    })

    for (const entry of primary) {
      const key = `${entry.ownerId}|${entry.vaultId}|${entry.revision}|${entry.updatedAt}`
      if (!seen.has(key)) {
        seen.add(key)
        entries.push({
          vaultId: entry.vaultId,
          revision: entry.revision,
          encryptedFile: entry.encryptedFile,
          updatedAt: entry.updatedAt,
        })
      }
    }

    if (owner.ownerSource === 'auth' && owner.ownerId.startsWith('user:')) {
      const userId = owner.ownerId.slice('user:'.length)
      const legacy = await ctx.runQuery(api.sync.listByLegacyUserPrefix, { userId })
      for (const entry of legacy) {
        const key = `${entry.ownerId}|${entry.vaultId}|${entry.revision}|${entry.updatedAt}`
        if (!seen.has(key)) {
          seen.add(key)
          entries.push({
            vaultId: entry.vaultId,
            revision: entry.revision,
            encryptedFile: entry.encryptedFile,
            updatedAt: entry.updatedAt,
          })
        }
      }
    }

    const snapshots = entries
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      .map((entry) => JSON.parse(entry.encryptedFile))

    return json({ snapshots, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/sync/pull',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const payload = (await request.json()) as { vaultId?: string }
    if (!payload.vaultId) {
      return json({ error: 'vaultId is required' }, 400)
    }

    const snapshot = await ctx.runQuery(api.sync.pullByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
    })

    return json({ snapshot: snapshot ? JSON.parse(snapshot.encryptedFile) : null, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/pull',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const payload = (await request.json()) as { vaultId?: string }
    if (!payload.vaultId) {
      return json({ error: 'vaultId is required' }, 400)
    }

    const snapshot = await ctx.runQuery(api.sync.pullByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
    })

    return json({ snapshot: snapshot ? JSON.parse(snapshot.encryptedFile) : null, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/sync/push',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const payload = (await request.json()) as {
      vaultId?: string
      revision?: number
      encryptedFile?: string
      updatedAt?: string
    }

    if (!payload.vaultId || typeof payload.revision !== 'number' || !payload.encryptedFile || !payload.updatedAt) {
      return json({ error: 'vaultId, revision, encryptedFile, and updatedAt are required' }, 400)
    }

    const result = await ctx.runMutation(api.sync.pushByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
      revision: payload.revision,
      encryptedFile: payload.encryptedFile,
      updatedAt: payload.updatedAt,
    })

    return json({ ok: true, accepted: result.accepted, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/push',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const payload = (await request.json()) as {
      vaultId?: string
      revision?: number
      encryptedFile?: string
      updatedAt?: string
    }

    if (!payload.vaultId || typeof payload.revision !== 'number' || !payload.encryptedFile || !payload.updatedAt) {
      return json({ error: 'vaultId, revision, encryptedFile, and updatedAt are required' }, 400)
    }

    const result = await ctx.runMutation(api.sync.pushByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
      revision: payload.revision,
      encryptedFile: payload.encryptedFile,
      updatedAt: payload.updatedAt,
    })

    return json({ ok: true, accepted: result.accepted, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/blobs/put',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }
    const payload = (await request.json()) as {
      vaultId?: string
      blobId?: string
      nonce?: string
      ciphertext?: string
      sizeBytes?: number
      sha256?: string
      mimeType?: string
      fileName?: string
      updatedAt?: string
    }
    if (
      !payload.vaultId
      || !payload.blobId
      || !payload.nonce
      || !payload.ciphertext
      || typeof payload.sizeBytes !== 'number'
      || !payload.sha256
      || !payload.updatedAt
    ) {
      return json({ error: 'vaultId, blobId, nonce, ciphertext, sizeBytes, sha256, and updatedAt are required' }, 400)
    }
    try {
      const result = await ctx.runMutation(api.sync.putBlobByOwnerVault, {
        ownerId: owner.ownerId,
        vaultId: payload.vaultId,
        blobId: payload.blobId,
        nonce: payload.nonce,
        ciphertext: payload.ciphertext,
        sizeBytes: payload.sizeBytes,
        sha256: payload.sha256,
        mimeType: payload.mimeType || 'application/octet-stream',
        fileName: payload.fileName || 'file.bin',
        updatedAt: payload.updatedAt,
        maxFileBytes: MAX_BLOB_FILE_BYTES,
        maxVaultBytes: MAX_BLOB_TOTAL_BYTES,
      })
      return json({
        ok: true,
        accepted: result.accepted,
        ownerSource: owner.ownerSource,
        usedBytes: result.usedBytes,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'blob upload failed'
      if (message.includes('quota') || message.includes('limit')) {
        return json({ error: message }, 413)
      }
      return json({ error: message }, 400)
    }
  }),
})

http.route({
  path: '/api/v2/sync/blobs/get',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }
    const payload = (await request.json()) as { vaultId?: string; blobId?: string }
    if (!payload.vaultId || !payload.blobId) {
      return json({ error: 'vaultId and blobId are required' }, 400)
    }
    const blob = await ctx.runQuery(api.sync.getBlobByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
      blobId: payload.blobId,
    })
    return json({ blob, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/blobs/delete',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }
    const payload = (await request.json()) as { vaultId?: string; blobId?: string }
    if (!payload.vaultId || !payload.blobId) {
      return json({ error: 'vaultId and blobId are required' }, 400)
    }
    const result = await ctx.runMutation(api.sync.deleteBlobByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
      blobId: payload.blobId,
    })
    return json({
      ok: true,
      deleted: result.deleted,
      ownerSource: owner.ownerSource,
      usedBytes: result.usedBytes,
    })
  }),
})

http.route({
  path: '/api/v2/sync/vaults/delete',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }
    const payload = (await request.json()) as { vaultId?: string }
    const vaultId = payload.vaultId?.trim() || ''
    if (!vaultId) {
      return json({ error: 'vaultId is required' }, 400)
    }
    const result = await ctx.runMutation(api.sync.deleteByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId,
    })
    return json({
      ok: true,
      deleted: result.deleted,
      ownerSource: owner.ownerSource,
    })
  }),
})

export default http
