import { httpRouter } from 'convex/server'
import { api } from './_generated/api'
import { httpAction } from './_generated/server'
import { auth } from './auth'
import {
  buildInviteEmailContent,
  buildPendingInviteMemberId,
  isValidInviteEmail,
  normalizeInviteEmail,
} from './invites'

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
const SITE_URL = (process.env.SITE_URL || '').trim().replace(/\/$/, '')
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim()
const INVITE_FROM_EMAIL = (process.env.INVITE_FROM_EMAIL || '').trim()
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
const DEFAULT_FLAGS = {
  'billing.plans_section': true,
  'billing.manual_token_entry': true,
  'experiments.enterprise_team_ui': false,
  'experiments.storage_tab': true,
}

type Role = 'owner' | 'admin' | 'editor' | 'viewer'
type PlanTier = 'free' | 'premium' | 'enterprise'
type SubscriptionScopeType = 'org' | 'user'
type SubscriptionStatus = 'active' | 'trialing' | 'canceled' | 'past_due' | 'paused'
type BillingMode = 'manual' | 'external'
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
type EntitlementSummary = {
  source: 'subscription' | 'server_default' | 'free' | 'override'
  tier: PlanTier
  capabilities: string[]
  flags: Record<string, boolean>
  reason: string
  storageLimitBytes: number | null
  seatLimit: number | null
}
type SubscriptionRecord = {
  id: string
  scopeType: SubscriptionScopeType
  scopeId: string
  tier: PlanTier
  status: SubscriptionStatus
  billingMode: BillingMode
  seatLimit: number | null
  storageLimitBytes: number | null
  renewalAt: string | null
  endAt: string | null
  note: string
  updatedAt: string
  updatedBy: string
}
type EntitlementOverrideMode = 'token' | 'derived'
type EntitlementOverrideRecord = {
  id: string
  targetType: EntitlementOverrideTargetType
  targetValue: string
  mode: EntitlementOverrideMode
  token: string | null
  tier: PlanTier | null
  capabilities: string[]
  note: string
  updatedAt: string
  updatedBy: string
}
type InviteDeliveryResult = {
  emailSent: boolean
  deliveryError: string | null
  providerMessageId: string | null
}

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
}
const PLAN_CAPABILITIES: Record<PlanTier, string[]> = {
  free: [],
  premium: ['cloud.sync', 'cloud.cloud_only', 'vault.storage', 'vault.storage.blobs', 'security.breach_scan'],
  enterprise: ['cloud.sync', 'cloud.cloud_only', 'vault.storage', 'vault.storage.blobs', 'security.breach_scan', 'enterprise.self_hosted', 'enterprise.org_admin'],
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

function mapEntitlementOverride(row: unknown): EntitlementOverrideRecord | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const targetType = isTargetType(record.targetType) ? record.targetType : null
  const targetValue = typeof record.targetValue === 'string' ? record.targetValue : ''
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : ''
  const updatedBy = typeof record.updatedBy === 'string' ? record.updatedBy : ''
  const tier = isPlanTier(record.tier) ? record.tier : null
  if (!targetType || !targetValue || !updatedAt || !updatedBy) return null
  return {
    id: typeof record._id === 'string' ? record._id : typeof record.id === 'string' ? record.id : `${targetType}:${targetValue}`,
    targetType,
    targetValue,
    mode: record.mode === 'derived' ? 'derived' : 'token',
    token: typeof record.token === 'string' ? record.token : null,
    tier,
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities.filter((value): value is string => typeof value === 'string')
      : [],
    note: typeof record.note === 'string' ? record.note : '',
    updatedAt,
    updatedBy,
  }
}

function buildEntitlementSummaryFromOverride(override: EntitlementOverrideRecord): EntitlementSummary {
  const tier = override.tier ?? 'free'
  return {
    source: 'override',
    tier,
    capabilities: override.capabilities,
    flags: DEFAULT_FLAGS,
    reason: override.note || `${tier} entitlement override`,
    storageLimitBytes: null,
    seatLimit: null,
  }
}

async function findEntitlementOverride(
  ctx: { runQuery: (...args: unknown[]) => Promise<unknown> },
  args: {
    targetType: EntitlementOverrideTargetType
    targetValue: string
  },
) {
  const normalized = normalizeOverrideTargetValue(args.targetType, args.targetValue)
  if (!normalized) return null

  const row = await ctx.runQuery(api.sync.getEntitlementOverride, {
    targetType: args.targetType,
    targetValue: normalized,
  })
  return mapEntitlementOverride(row)
}

async function resolveEntitlementOverrideForIdentity(
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
    const override = await findEntitlementOverride(ctx, candidate)
    if (override) {
      return { override, source: `${candidate.targetType}:${normalizeOverrideTargetValue(candidate.targetType, candidate.targetValue)}` }
    }
  }
  return null
}

async function findSubscriptionRecord(
  ctx: { runQuery: (...args: unknown[]) => Promise<unknown> },
  scopeType: SubscriptionScopeType,
  scopeId: string,
) {
  const normalizedScopeId = normalizeScopeId(scopeType, scopeId)
  if (!normalizedScopeId) return null
  const row = await ctx.runQuery(api.sync.getSubscriptionRecord, {
    scopeType,
    scopeId: normalizedScopeId,
  })
  return mapSubscriptionRecord(row)
}

async function resolveSubscriptionForIdentity(
  ctx: { runQuery: (...args: unknown[]) => Promise<unknown> },
  identity: { subject: string | null; email: string | null; tokenIdentifier: string | null } | null,
  orgId: string,
) {
  if (identity) {
    const userIdFromSubject = identity.subject ? identity.subject.split('|')[0] : ''
    const candidates = [
      userIdFromSubject,
      identity.tokenIdentifier || '',
      identity.subject || '',
      identity.email || '',
    ]
    for (const candidate of candidates) {
      if (!candidate) continue
      const record = await findSubscriptionRecord(ctx, 'user', candidate)
      if (record && isSubscriptionEffective(record.status)) {
        return record
      }
    }
  }
  const orgRecord = await findSubscriptionRecord(ctx, 'org', orgId)
  if (orgRecord && isSubscriptionEffective(orgRecord.status)) {
    return orgRecord
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

function normalizeScopeId(scopeType: SubscriptionScopeType, scopeId: string) {
  const trimmed = scopeId.trim()
  return scopeType === 'user' && trimmed.includes('@') ? trimmed.toLowerCase() : trimmed
}

function isPlanTier(value: unknown): value is PlanTier {
  return value === 'free' || value === 'premium' || value === 'enterprise'
}

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return value === 'active' || value === 'trialing' || value === 'canceled' || value === 'past_due' || value === 'paused'
}

function isBillingMode(value: unknown): value is BillingMode {
  return value === 'manual' || value === 'external'
}

function isSubscriptionEffective(status: SubscriptionStatus) {
  return status === 'active' || status === 'trialing'
}

function parseEntitlementClaimsFromToken(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const payload = decodeJsonPart<Record<string, unknown>>(parts[1])
  if (!payload || !isPlanTier(payload.tier)) return null
  return {
    tier: payload.tier,
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.filter((value): value is string => typeof value === 'string') : [],
    flags: payload.flags && typeof payload.flags === 'object' ? payload.flags as Record<string, boolean> : {},
    iss: typeof payload.iss === 'string' ? payload.iss : null,
    sub: typeof payload.sub === 'string' ? payload.sub : null,
    exp: Number(payload.exp),
  }
}

function mapSubscriptionRecord(row: unknown): SubscriptionRecord | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  if (
    !isPlanTier(record.tier)
    || !isSubscriptionStatus(record.status)
    || !isBillingMode(record.billingMode)
    || (record.scopeType !== 'org' && record.scopeType !== 'user')
    || typeof record.scopeId !== 'string'
    || typeof record.updatedAt !== 'string'
    || typeof record.updatedBy !== 'string'
  ) {
    return null
  }
  return {
    id: String(record._id ?? record.id ?? ''),
    scopeType: record.scopeType,
    scopeId: record.scopeId,
    tier: record.tier,
    status: record.status,
    billingMode: record.billingMode,
    seatLimit: typeof record.seatLimit === 'number' ? record.seatLimit : null,
    storageLimitBytes: typeof record.storageLimitBytes === 'number' ? record.storageLimitBytes : null,
    renewalAt: typeof record.renewalAt === 'string' ? record.renewalAt : null,
    endAt: typeof record.endAt === 'string' ? record.endAt : null,
    note: typeof record.note === 'string' ? record.note : '',
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  }
}

function buildEntitlementSummaryFromSubscription(record: SubscriptionRecord | null): EntitlementSummary {
  if (record && isSubscriptionEffective(record.status)) {
    return {
      source: 'subscription',
      tier: record.tier,
      capabilities: [...PLAN_CAPABILITIES[record.tier]],
      flags: DEFAULT_FLAGS,
      reason: `${record.tier} subscription`,
      storageLimitBytes: typeof record.storageLimitBytes === 'number' ? record.storageLimitBytes : null,
      seatLimit: typeof record.seatLimit === 'number' ? record.seatLimit : null,
    }
  }
  return {
    source: 'free',
    tier: 'free',
    capabilities: [],
    flags: DEFAULT_FLAGS,
    reason: 'Free plan active',
    storageLimitBytes: 0,
    seatLimit: null,
  }
}

function buildDefaultEntitlementSummary(): EntitlementSummary {
  const parsed = parseEntitlementClaimsFromToken(SYNC_ENTITLEMENT_TOKEN)
  if (parsed && isPlanTier(parsed.tier)) {
    return {
      source: 'server_default',
      tier: parsed.tier,
      capabilities: parsed.capabilities,
      flags: parsed.flags,
      reason: 'Server-issued entitlement token',
      storageLimitBytes: null,
      seatLimit: null,
    }
  }
  return buildEntitlementSummaryFromSubscription(null)
}

function normalizeOrgId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
}

function parseResendError(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const row = payload as Record<string, unknown>
  if (typeof row.message === 'string' && row.message.trim()) return row.message.trim()
  const errorRow = row.error
  if (errorRow && typeof errorRow === 'object' && typeof (errorRow as Record<string, unknown>).message === 'string') {
    return ((errorRow as Record<string, unknown>).message as string).trim()
  }
  return ''
}

async function sendInviteEmail(input: {
  orgName: string
  inviteeEmail: string
  inviterLabel: string
  role: Role
}): Promise<InviteDeliveryResult> {
  if (!SITE_URL) {
    return {
      emailSent: false,
      deliveryError: 'Invite email delivery is not configured: SITE_URL is missing.',
      providerMessageId: null,
    }
  }
  if (!RESEND_API_KEY) {
    return {
      emailSent: false,
      deliveryError: 'Invite email delivery is not configured: RESEND_API_KEY is missing.',
      providerMessageId: null,
    }
  }
  if (!INVITE_FROM_EMAIL) {
    return {
      emailSent: false,
      deliveryError: 'Invite email delivery is not configured: INVITE_FROM_EMAIL is missing.',
      providerMessageId: null,
    }
  }

  const content = buildInviteEmailContent({
    appUrl: SITE_URL,
    orgName: input.orgName,
    inviterLabel: input.inviterLabel,
    inviteeEmail: input.inviteeEmail,
    role: input.role,
  })

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: INVITE_FROM_EMAIL,
        to: [input.inviteeEmail],
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = parseResendError(payload) || `Resend request failed (${response.status})`
      return { emailSent: false, deliveryError: detail, providerMessageId: null }
    }
    const providerMessageId = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).id === 'string'
      ? (payload as Record<string, unknown>).id as string
      : null
    return {
      emailSent: true,
      deliveryError: null,
      providerMessageId,
    }
  } catch (error) {
    return {
      emailSent: false,
      deliveryError: error instanceof Error ? error.message : 'Invite email delivery failed.',
      providerMessageId: null,
    }
  }
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
  email?: string | null,
) {
  const role = await ctx.runMutation(api.sync.ensureOrgMemberRole, {
    orgId,
    memberId,
    now: nowIso(),
    ...(email ? { email } : {}),
  })
  return isRole(role) ? role : 'owner'
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

    const resolvedEntitlement = await resolveEntitlementOverrideForIdentity(ctx, identity)
    const entitlementToken = resolvedEntitlement?.override.mode === 'token' ? (resolvedEntitlement.override.token || '') : SYNC_ENTITLEMENT_TOKEN
    const capabilityResult = entitlementToken
      ? await verifyEntitlementCapability(entitlementToken)
      : { ok: false, reason: 'No signed entitlement token available' }
    const superAdmin = allowlisted && capabilityResult.ok
    const memberRole = await ensureMemberRole(ctx, orgId, identity.subject, identity.email)

    const orgAdminAllowed = hasRole(memberRole, 'admin')
    const reasons: string[] = []
    if (!superAdmin && !orgAdminAllowed) {
      reasons.push('Org role is not admin or owner')
      if (!allowlisted) reasons.push('Identity is not in admin allowlist')
      if (!capabilityResult.ok) reasons.push(capabilityResult.reason)
    }

    const permissions: AdminPermissionResult = {
      allowlisted,
      capability: capabilityResult.ok,
      superAdmin,
      allowed: superAdmin || orgAdminAllowed,
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
      const requestedOrgId = normalizeOrgId(request.headers.get('x-armadillo-org') || '')
      return {
        ownerId: `user:${userId}`,
        ownerSource: 'auth' as OwnerSource,
        orgId: requestedOrgId || defaultOrgIdForSubject(identity.subject),
      }
    }
  } catch {
    // Fall through to anonymous owner hint for offline/unauthenticated mode.
  }

  const ownerHintRaw = request.headers.get('x-armadillo-owner') || ''
  const ownerHint = normalizeOwnerHint(ownerHintRaw)
  if (!ownerHint) {
    return null
  }

  return { ownerId: `anon:${ownerHint}`, ownerSource: 'anonymous' as OwnerSource, orgId: null }
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
    let claimedInvites: Array<{ orgId: string; role: Role; email: string | null; previousMemberId: string }> = []
    if (identity.email) {
      const claimed = await ctx.runMutation(api.sync.claimPendingInvites, {
        memberId: identity.subject,
        email: identity.email,
        now: nowIso(),
      }) as { claimedInvites?: Array<{ orgId: string; role: Role; email: string | null; previousMemberId: string }> } | null
      claimedInvites = Array.isArray(claimed?.claimedInvites) ? claimed.claimedInvites : []
      for (const invite of claimedInvites) {
        await appendAdminAudit(ctx, {
          orgId: invite.orgId,
          actorSubject: identity.subject,
          action: 'org.member.invite.claim',
          target: identity.subject,
          metadata: {
            email: invite.email ?? identity.email,
            previousMemberId: invite.previousMemberId,
            role: invite.role,
          },
        })
      }
    }
    const orgId = defaultOrgIdForSubject(identity.subject)
    const role = await ensureMemberRole(ctx, orgId, identity.subject, identity.email)
    const response = {
      authenticated: true,
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      tokenIdentifier: identity.tokenIdentifier,
      authContext: {
        subject: identity.subject,
        orgId,
        roles: [role],
        sessionId: identity.tokenIdentifier || identity.subject,
      },
    }
    return json(response)
  }),
})

http.route({
  path: '/api/v2/entitlements/me',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await resolveIdentityWithProfile(ctx)
      const requestedOrgId = normalizeOrgId(request.headers.get('x-armadillo-org') || '')
      const orgId = identity?.subject ? (requestedOrgId || defaultOrgIdForSubject(identity.subject)) : requestedOrgId
      const override = await resolveEntitlementOverrideForIdentity(ctx, identity)
      if (override?.override.mode === 'token' && override.override.token) {
        return json({
          ok: true,
          token: override.override.token,
          reason: `User override (${override.source})`,
          expiresAt: null,
          fetchedAt: nowIso(),
        })
      }
      if (override?.override.mode === 'derived') {
        const effective = buildEntitlementSummaryFromOverride(override.override)
        return json({
          ok: true,
          token: null,
          reason: effective.reason,
          fetchedAt: nowIso(),
          derived: {
            source: effective.source,
            tier: effective.tier,
            capabilities: effective.capabilities,
            flags: effective.flags,
            expiresAt: null,
            subject: identity?.subject || null,
          },
        })
      }

      if (orgId) {
        const subscription = await resolveSubscriptionForIdentity(ctx, identity, orgId)
        if (subscription) {
          const effective = buildEntitlementSummaryFromSubscription(subscription)
          return json({
            ok: true,
            token: null,
            reason: effective.reason,
            fetchedAt: nowIso(),
            derived: {
              source: effective.source,
              tier: effective.tier,
              capabilities: effective.capabilities,
              flags: effective.flags,
              expiresAt: subscription.endAt,
              subject: identity?.subject || null,
            },
          })
        }
      }

      if (SYNC_ENTITLEMENT_TOKEN) {
        const parsed = parseEntitlementClaimsFromToken(SYNC_ENTITLEMENT_TOKEN)
        return json({
          ok: true,
          token: SYNC_ENTITLEMENT_TOKEN,
          reason: 'Server-issued entitlement token',
          expiresAt: parsed && Number.isFinite(parsed.exp) ? new Date(parsed.exp * 1000).toISOString() : null,
          fetchedAt: nowIso(),
        })
      }

      return json({
        ok: false,
        token: null,
        reason: 'No signed entitlement token configured',
        expiresAt: null,
        fetchedAt: nowIso(),
      })
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
  path: '/api/v2/admin/invites',
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
  path: '/api/v2/admin/vaults',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/usage',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/subscriptions',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/overview',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/customers/search',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/admin/system',
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
    if (!orgId || (!resolved.context.permissions.superAdmin && orgId !== resolved.context.identity.orgId)) {
      return json({ error: 'orgId is required and must match your admin org' }, 400)
    }

    const rows = await ctx.runQuery(api.sync.listOrgMembers, { orgId }) as Array<{
      memberId: string
      email?: string
      role: Role
      addedAt: string
    }>
    const members = rows
      .slice()
      .sort((a, b) => (a.memberId > b.memberId ? 1 : -1))
      .map((row) => ({
        memberId: row.memberId,
        email: row.email ?? null,
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

    const body = await request.json() as { orgId?: unknown; memberId?: unknown; email?: unknown; role?: unknown }
    const orgId = normalizeOrgId(typeof body.orgId === 'string' ? body.orgId : '')
    const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined
    const role = body.role
    if (!orgId || (!resolved.context.permissions.superAdmin && orgId !== resolved.context.identity.orgId)) {
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
      ...(email !== undefined ? { email } : {}),
      role,
      now,
      actorSubject: resolved.context.identity.subject,
    }) as { addedAt?: string } | null

    await appendAdminAudit(ctx, {
      orgId,
      actorSubject: resolved.context.identity.subject,
      action: 'org.member.upsert',
      target: memberId,
      metadata: { role, ...(email !== undefined ? { email: email || null } : {}) },
    })

    return json({
      member: {
        memberId,
        email: email ?? null,
        role,
        addedAt: upserted?.addedAt || now,
      },
    })
  }),
})

http.route({
  path: '/api/v2/admin/invites',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.allowed) {
      return json({ error: resolved.context.permissions.reasons[0] || 'forbidden' }, 403)
    }

    const body = await request.json() as { orgId?: unknown; email?: unknown; role?: unknown }
    const orgId = normalizeOrgId(typeof body.orgId === 'string' ? body.orgId : '')
    const email = normalizeInviteEmail(typeof body.email === 'string' ? body.email : '')
    const role = body.role
    if (!orgId || (!resolved.context.permissions.superAdmin && orgId !== resolved.context.identity.orgId)) {
      return json({ error: 'orgId is required and must match your admin org' }, 400)
    }
    if (!email || !isValidInviteEmail(email)) {
      return json({ error: 'email is invalid' }, 400)
    }
    if (!isRole(role)) {
      return json({ error: 'role is invalid' }, 400)
    }

    const now = nowIso()
    const memberId = buildPendingInviteMemberId(email)
    const upserted = await ctx.runMutation(api.sync.upsertOrgMember, {
      orgId,
      memberId,
      email,
      role,
      now,
      actorSubject: resolved.context.identity.subject,
    }) as { addedAt?: string } | null
    const orgLookup = await ctx.runQuery(api.sync.listAdminOrgs, {
      subject: resolved.context.identity.subject,
      includeAll: resolved.context.permissions.superAdmin,
      fallbackOrgId: resolved.context.identity.orgId,
    }) as { orgs?: Array<{ id?: string; name?: string }> } | null
    const org = (orgLookup?.orgs || []).find((row) => row.id === orgId)
    const delivery = await sendInviteEmail({
      orgName: org?.name || `Organization ${orgId}`,
      inviteeEmail: email,
      inviterLabel: resolved.context.identity.name || resolved.context.identity.email || resolved.context.identity.subject,
      role,
    })

    await appendAdminAudit(ctx, {
      orgId,
      actorSubject: resolved.context.identity.subject,
      action: 'org.member.invite',
      target: memberId,
      metadata: {
        email,
        role,
        emailSent: delivery.emailSent,
        deliveryError: delivery.deliveryError,
        providerMessageId: delivery.providerMessageId,
      },
    })

    return json({
      member: {
        memberId,
        email,
        role,
        addedAt: upserted?.addedAt || now,
      },
      emailSent: delivery.emailSent,
      deliveryError: delivery.deliveryError,
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
    if (!resolved.context.permissions.superAdmin) {
      return json({ error: 'superadmin required' }, 403)
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
    if (!resolved.context.permissions.superAdmin) {
      return json({ error: 'superadmin required' }, 403)
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
  path: '/api/v2/admin/orgs',
  method: 'PUT',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.superAdmin) {
      return json({ error: 'superadmin required' }, 403)
    }

    const body = await request.json() as { orgId?: unknown; name?: unknown }
    const orgId = normalizeOrgId(typeof body.orgId === 'string' ? body.orgId : '')
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!orgId) {
      return json({ error: 'orgId is invalid' }, 400)
    }
    if (!name) {
      return json({ error: 'name is required' }, 400)
    }

    const updated = await ctx.runMutation(api.sync.updateAdminOrg, {
      orgId,
      name,
    }) as { id?: string; name?: string; createdAt?: string; createdBy?: string } | null

    if (!updated) {
      return json({ error: 'org not found' }, 404)
    }

    await appendAdminAudit(ctx, {
      orgId,
      actorSubject: resolved.context.identity.subject,
      action: 'org.rename',
      target: orgId,
      metadata: { name },
    })

    return json({
      org: {
        id: updated.id || orgId,
        name: updated.name || name,
        createdAt: updated.createdAt || nowIso(),
        createdBy: updated.createdBy ?? null,
        myRole: null,
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
    if (!orgId || (!resolved.context.permissions.superAdmin && orgId !== resolved.context.identity.orgId)) {
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
    if (!resolved.context.permissions.superAdmin) {
      return json({ error: 'superadmin required' }, 403)
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
  path: '/api/v2/admin/vaults',
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
    if (!orgId || (!resolved.context.permissions.superAdmin && orgId !== resolved.context.identity.orgId)) {
      return json({ error: 'orgId is required and must match your admin org' }, 400)
    }

    const vaults = await ctx.runQuery(api.sync.listVaultSummariesByOrg, { orgId }) as Array<{
      vaultId: string
      ownerId?: string | null
      revision: number
      updatedAt: string
      updatedBy?: string | null
      blobCount?: number
      storageBytes?: number
    }>
    return json({
      vaults: vaults.map((row) => ({
        vaultId: row.vaultId,
        ownerId: row.ownerId ?? null,
        revision: row.revision,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy ?? null,
        blobCount: row.blobCount ?? 0,
        storageBytes: row.storageBytes ?? 0,
      })),
    })
  }),
})

http.route({
  path: '/api/v2/admin/vaults',
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
    const vaultId = (url.searchParams.get('vaultId') || '').trim()
    if (!orgId || (!resolved.context.permissions.superAdmin && orgId !== resolved.context.identity.orgId)) {
      return json({ error: 'orgId is required and must match your admin org' }, 400)
    }
    if (!vaultId) {
      return json({ error: 'vaultId is required' }, 400)
    }

    const deletion = await ctx.runMutation(api.sync.deleteVaultsByOrg, { orgId, vaultId }) as { deleted?: boolean } | null
    await appendAdminAudit(ctx, {
      orgId,
      actorSubject: resolved.context.identity.subject,
      action: 'org.vault.delete',
      target: vaultId,
    })
    return json({ ok: true, deleted: Boolean(deletion?.deleted) })
  }),
})

http.route({
  path: '/api/v2/admin/usage',
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
    if (!orgId || (!resolved.context.permissions.superAdmin && orgId !== resolved.context.identity.orgId)) {
      return json({ error: 'orgId is required and must match your admin org' }, 400)
    }

    const usage = await ctx.runQuery(api.sync.getOrgUsageSummary, { orgId }) as {
      orgId: string
      memberCount: number
      vaultCount: number
      storageBytes: number
      lastVaultActivityAt: string | null
    }
    return json(usage)
  }),
})

http.route({
  path: '/api/v2/admin/subscriptions',
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
    const scopeType = url.searchParams.get('scopeType')
    const scopeIdRaw = url.searchParams.get('scopeId') || ''
    if ((scopeType !== 'org' && scopeType !== 'user') || !scopeIdRaw.trim()) {
      return json({ error: 'scopeType and scopeId are required' }, 400)
    }
    const scopeId = normalizeScopeId(scopeType, scopeIdRaw)
    if (!resolved.context.permissions.superAdmin && (scopeType !== 'org' || scopeId !== resolved.context.identity.orgId)) {
      return json({ error: 'forbidden' }, 403)
    }

    const record = mapSubscriptionRecord(await ctx.runQuery(api.sync.getSubscriptionRecord, { scopeType, scopeId }))
    const effective = record ? buildEntitlementSummaryFromSubscription(record) : buildDefaultEntitlementSummary()
    return json({ subscription: record, effective })
  }),
})

http.route({
  path: '/api/v2/admin/subscriptions',
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
      scopeType?: unknown
      scopeId?: unknown
      tier?: unknown
      status?: unknown
      billingMode?: unknown
      seatLimit?: unknown
      storageLimitBytes?: unknown
      renewalAt?: unknown
      endAt?: unknown
      note?: unknown
    }
    if ((body.scopeType !== 'org' && body.scopeType !== 'user') || typeof body.scopeId !== 'string') {
      return json({ error: 'scopeType and scopeId are required' }, 400)
    }
    const scopeType = body.scopeType
    const scopeId = normalizeScopeId(scopeType, body.scopeId)
    const tier = body.tier
    const status = body.status
    const billingMode = body.billingMode
    if (!isPlanTier(tier) || !isSubscriptionStatus(status) || !isBillingMode(billingMode)) {
      return json({ error: 'tier, status, and billingMode are required' }, 400)
    }
    if (!scopeId) {
      return json({ error: 'scopeId is required' }, 400)
    }

    if (!resolved.context.permissions.superAdmin) {
      if (scopeType !== 'org' || scopeId !== resolved.context.identity.orgId) {
        return json({ error: 'forbidden' }, 403)
      }
      if (tier === 'enterprise') {
        return json({ error: 'Enterprise plans are operator-managed' }, 403)
      }
    }

    const now = nowIso()
    const seatLimit = typeof body.seatLimit === 'number' && Number.isFinite(body.seatLimit) ? Math.max(0, Math.round(body.seatLimit)) : undefined
    const storageLimitBytes = typeof body.storageLimitBytes === 'number' && Number.isFinite(body.storageLimitBytes) ? Math.max(0, Math.round(body.storageLimitBytes)) : undefined
    const renewalAt = typeof body.renewalAt === 'string' && body.renewalAt.trim() ? body.renewalAt : undefined
    const endAt = typeof body.endAt === 'string' && body.endAt.trim() ? body.endAt : undefined
    const note = typeof body.note === 'string' ? body.note.trim() : ''

    const result = await ctx.runMutation(api.sync.upsertSubscriptionRecord, {
      scopeType,
      scopeId,
      tier,
      status,
      billingMode,
      ...(seatLimit === undefined ? {} : { seatLimit }),
      ...(storageLimitBytes === undefined ? {} : { storageLimitBytes }),
      ...(renewalAt === undefined ? {} : { renewalAt }),
      ...(endAt === undefined ? {} : { endAt }),
      note,
      updatedAt: now,
      updatedBy: resolved.context.identity.subject,
    }) as { id?: string } | null
    const record = mapSubscriptionRecord(await ctx.runQuery(api.sync.getSubscriptionRecord, { scopeType, scopeId }))
    const effective = record ? buildEntitlementSummaryFromSubscription(record) : buildDefaultEntitlementSummary()
    await appendAdminAudit(ctx, {
      orgId: scopeType === 'org' ? scopeId : resolved.context.identity.orgId,
      actorSubject: resolved.context.identity.subject,
      action: 'subscription.upsert',
      target: `${scopeType}:${scopeId}`,
      metadata: { tier, status, billingMode, id: result?.id || null },
    })
    return json({ subscription: record, effective })
  }),
})

http.route({
  path: '/api/v2/admin/overview',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.superAdmin) {
      return json({ error: 'superadmin required' }, 403)
    }
    const overview = await ctx.runQuery(api.sync.getOperatorOverview, {}) as Record<string, unknown>
    return json(overview)
  }),
})

http.route({
  path: '/api/v2/admin/customers/search',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.superAdmin) {
      return json({ error: 'superadmin required' }, 403)
    }
    const queryText = (new URL(request.url).searchParams.get('q') || '').trim()
    if (!queryText) {
      return json({ results: [] })
    }
    const results = await ctx.runQuery(api.sync.searchCustomers, { query: queryText }) as unknown[]
    return json({ results })
  }),
})

http.route({
  path: '/api/v2/admin/system',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const resolved = await resolveAdminContext(ctx, request)
    if ('error' in resolved) {
      return json({ error: resolved.error }, resolved.status)
    }
    if (!resolved.context.permissions.superAdmin) {
      return json({ error: 'superadmin required' }, 403)
    }
    return json({
      provider: 'convex',
      health: { ok: true, now: nowIso() },
      readiness: { ok: true },
      metrics: null,
      note: 'Convex does not expose sync-gateway style health and metrics counters.',
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
      mode?: EntitlementOverrideMode
      token?: string
      tier?: PlanTier
      capabilities?: string[]
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
        mode: row.mode === 'derived' ? 'derived' : 'token',
        tier: isPlanTier(row.tier) ? row.tier : null,
        capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter((value): value is string => typeof value === 'string') : [],
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
      tier?: unknown
      capabilities?: unknown
      note?: unknown
    }
    if (!isTargetType(body.targetType)) {
      return json({ error: 'targetType is invalid' }, 400)
    }
    const targetValue = normalizeOverrideTargetValue(body.targetType, typeof body.targetValue === 'string' ? body.targetValue : '')
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const tier = isPlanTier(body.tier) ? body.tier : 'free'
    const capabilities = Array.isArray(body.capabilities)
      ? Array.from(new Set(body.capabilities.filter((value): value is string => typeof value === 'string')))
      : PLAN_CAPABILITIES[tier]
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (!targetValue) {
      return json({ error: 'targetValue is required' }, 400)
    }
    const mode: EntitlementOverrideMode = token ? 'token' : 'derived'
    if (mode === 'token' && token.split('.').length !== 3) {
      return json({ error: 'token must be a signed JWT' }, 400)
    }
    if (mode === 'derived' && capabilities.length === 0 && tier === 'free') {
      return json({ error: 'Select at least one capability or a non-free tier' }, 400)
    }

    const now = nowIso()
    const updatedBy = resolved.context.identity.subject
    const upserted = await ctx.runMutation(api.sync.upsertEntitlementOverride, {
      targetType: body.targetType,
      targetValue,
      mode,
      ...(token ? { token } : {}),
      ...(mode === 'derived' ? { tier, capabilities } : {}),
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
        mode,
        tier: mode === 'derived' ? tier : null,
        capabilities: mode === 'derived' ? capabilities : [],
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
      ...(owner.orgId ? { orgId: owner.orgId } : {}),
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
      ...(owner.orgId ? { orgId: owner.orgId } : {}),
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
        ...(owner.orgId ? { orgId: owner.orgId } : {}),
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
