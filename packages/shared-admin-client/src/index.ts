export type SyncProvider = 'convex' | 'self_hosted'

export type Role = 'owner' | 'admin' | 'editor' | 'viewer'
export type PlanTier = 'free' | 'premium' | 'enterprise'
export type OverrideTargetType = 'userId' | 'tokenIdentifier' | 'subject' | 'email'
export type OverrideMode = 'token' | 'derived'
export type SubscriptionScopeType = 'org' | 'user'
export type SubscriptionStatus = 'active' | 'trialing' | 'canceled' | 'past_due' | 'paused'
export type BillingMode = 'manual' | 'external'

export type AdminIdentity = {
  subject: string
  email: string | null
  name: string | null
  tokenIdentifier: string | null
  orgId: string
  roles: Role[]
}

export type AdminPermissions = {
  allowlisted: boolean
  capability: boolean
  superAdmin: boolean
  allowed: boolean
  reasons: string[]
}

export type AdminMeResponse = {
  authenticated: boolean
  identity: AdminIdentity | null
  permissions: AdminPermissions
}

export type AdminOrgMember = {
  memberId: string
  email?: string | null
  role: Role
  addedAt: string
}

export type InviteMemberResponse = {
  member: AdminOrgMember
  emailSent: boolean
  deliveryError?: string | null
}

export type AdminOrg = {
  id: string
  name: string
  createdAt: string
  createdBy?: string | null
  myRole?: Role | null
  memberCount?: number
}

export type AdminAuditEvent = {
  id: string
  orgId: string
  actorSubject: string
  action: string
  target: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export type PagedAuditResponse = {
  events: AdminAuditEvent[]
  nextCursor: string | null
}

export type EntitlementOverrideRow = {
  id: string
  targetType: OverrideTargetType
  targetValue: string
  mode: OverrideMode
  tier: PlanTier | null
  capabilities: string[]
  note: string
  updatedAt: string
  updatedBy: string
}

export type PagedOverridesResponse = {
  overrides: EntitlementOverrideRow[]
  nextCursor: string | null
}

export type UpsertEntitlementOverrideInput = {
  targetType: OverrideTargetType
  targetValue: string
  note?: string
  token?: string
  tier?: PlanTier
  capabilities?: string[]
}

export type EntitlementSummary = {
  source: 'subscription' | 'server_default' | 'free'
  tier: PlanTier
  capabilities: string[]
  flags: Record<string, boolean>
  reason: string
  storageLimitBytes: number | null
  seatLimit: number | null
}

export type SubscriptionRecord = {
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

export type SubscriptionResponse = {
  subscription: SubscriptionRecord | null
  effective: EntitlementSummary
}

export type VaultSummary = {
  vaultId: string
  ownerId: string | null
  revision: number
  updatedAt: string
  updatedBy: string | null
  blobCount: number
  storageBytes: number
}

export type OrgUsageSummary = {
  orgId: string
  memberCount: number
  vaultCount: number
  storageBytes: number
  lastVaultActivityAt: string | null
}

export type OperatorOverview = {
  totalOrgs: number
  totalMembers: number
  totalVaults: number
  totalStorageBytes: number
  subscriptionsByTier: Record<PlanTier, number>
  subscriptionsByStatus: Record<SubscriptionStatus, number>
  provider: SyncProvider | 'convex'
}

export type CustomerSearchResult = {
  orgId: string
  orgName: string
  memberCount: number
  matchedMembers: string[]
  subscriptionTier: PlanTier | null
  lastActivityAt: string | null
}

export type SystemStatus = {
  provider: SyncProvider
  health: { ok: boolean; now?: string | null } | null
  readiness: { ok: boolean } | null
  metrics: Record<string, number> | null
  note?: string
}

export type AdminClientOptions = {
  provider: SyncProvider
  baseUrl: string
  getAuthToken: () => string | null
  getOrgId?: () => string | null
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, '')
}

export function providerBasePath(provider: SyncProvider) {
  return provider === 'convex' ? '/api/v2/admin' : '/v2/admin'
}

function parseErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const row = payload as Record<string, unknown>
  return typeof row.error === 'string' ? row.error : ''
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeSubscription(row: unknown): SubscriptionRecord | null {
  if (!row || typeof row !== 'object') return null
  const data = row as Record<string, unknown>
  const scopeType = data.scopeType === 'org' || data.scopeType === 'user' ? data.scopeType : null
  const tier = data.tier === 'premium' || data.tier === 'enterprise' || data.tier === 'free' ? data.tier : null
  const status = data.status === 'active' || data.status === 'trialing' || data.status === 'canceled' || data.status === 'past_due' || data.status === 'paused'
    ? data.status
    : null
  const billingMode = data.billingMode === 'external' || data.billingMode === 'manual' ? data.billingMode : null
  const id = normalizeString(data.id)
  const scopeId = normalizeString(data.scopeId)
  const updatedAt = normalizeString(data.updatedAt)
  const updatedBy = normalizeString(data.updatedBy)
  if (!scopeType || !tier || !status || !billingMode || !id || !scopeId || !updatedAt || !updatedBy) return null
  return {
    id,
    scopeType,
    scopeId,
    tier,
    status,
    billingMode,
    seatLimit: normalizeNumber(data.seatLimit),
    storageLimitBytes: normalizeNumber(data.storageLimitBytes),
    renewalAt: normalizeString(data.renewalAt),
    endAt: normalizeString(data.endAt),
    note: typeof data.note === 'string' ? data.note : '',
    updatedAt,
    updatedBy,
  }
}

function normalizeEntitlementSummary(row: unknown): EntitlementSummary {
  const data = row && typeof row === 'object' ? row as Record<string, unknown> : {}
  const tier = data.tier === 'premium' || data.tier === 'enterprise' ? data.tier : 'free'
  return {
    source: data.source === 'subscription' || data.source === 'server_default' ? data.source : 'free',
    tier,
    capabilities: Array.isArray(data.capabilities) ? data.capabilities.filter((value): value is string => typeof value === 'string') : [],
    flags: data.flags && typeof data.flags === 'object' ? data.flags as Record<string, boolean> : {},
    reason: typeof data.reason === 'string' ? data.reason : 'Free plan active',
    storageLimitBytes: normalizeNumber(data.storageLimitBytes),
    seatLimit: normalizeNumber(data.seatLimit),
  }
}

function normalizeOverrideRow(row: unknown): EntitlementOverrideRow | null {
  if (!row || typeof row !== 'object') return null
  const data = row as Record<string, unknown>
  const id = normalizeString(data.id)
  const targetValue = normalizeString(data.targetValue)
  const updatedAt = normalizeString(data.updatedAt)
  const updatedBy = normalizeString(data.updatedBy)
  const targetType = data.targetType === 'userId' || data.targetType === 'tokenIdentifier' || data.targetType === 'subject' || data.targetType === 'email'
    ? data.targetType
    : null
  const mode = data.mode === 'derived' ? 'derived' : 'token'
  const tier = data.tier === 'free' || data.tier === 'premium' || data.tier === 'enterprise' ? data.tier : null
  if (!id || !targetValue || !updatedAt || !updatedBy || !targetType) return null
  return {
    id,
    targetType,
    targetValue,
    mode,
    tier,
    capabilities: Array.isArray(data.capabilities) ? data.capabilities.filter((value): value is string => typeof value === 'string') : [],
    note: typeof data.note === 'string' ? data.note : '',
    updatedAt,
    updatedBy,
  }
}

export class AdminClient {
  private readonly provider: SyncProvider
  private readonly baseUrl: string
  private readonly getAuthToken: () => string | null
  private readonly getOrgId: (() => string | null) | null

  constructor(options: AdminClientOptions) {
    this.provider = options.provider
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.getAuthToken = options.getAuthToken
    this.getOrgId = options.getOrgId ?? null
  }

  private buildUrl(pathname: string, params?: URLSearchParams) {
    const query = params && Array.from(params).length > 0 ? `?${params.toString()}` : ''
    return `${this.baseUrl}${providerBasePath(this.provider)}${pathname}${query}`
  }

  private buildHeaders(contentType = true) {
    const headers: Record<string, string> = {}
    if (contentType) headers['Content-Type'] = 'application/json'
    const token = this.getAuthToken()
    if (token) headers.Authorization = `Bearer ${token}`
    const orgId = this.getOrgId?.()
    if (orgId) headers['x-armadillo-org'] = orgId
    return headers
  }

  private async parseJson<T>(response: Response, context: string): Promise<T> {
    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text) as unknown
      } catch {
        if (!response.ok) {
          throw new Error(`${context}: request failed (${response.status})`)
        }
        throw new Error(`${context}: response was not valid JSON`)
      }
    }
    if (!response.ok) {
      const detail = parseErrorPayload(payload)
      throw new Error(detail ? `${context}: ${detail}` : `${context}: request failed (${response.status})`)
    }
    return payload as T
  }

  private async request<T>(context: string, pathname: string, init: RequestInit, params?: URLSearchParams) {
    const url = this.buildUrl(pathname, params)
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'network error'
      throw new Error(`${context}: failed to reach ${url} (${detail})`)
    }
    return this.parseJson<T>(response, context)
  }

  private async requestSystem<T>(context: string, pathname: string, init: RequestInit) {
    const url = `${this.baseUrl}${pathname}`
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'network error'
      throw new Error(`${context}: failed to reach ${url} (${detail})`)
    }
    return this.parseJson<T>(response, context)
  }

  async getMe() {
    return this.request<AdminMeResponse>('Get admin identity', '/me', {
      method: 'GET',
      headers: this.buildHeaders(false),
    })
  }

  async listMembers(orgId: string) {
    return this.request<{ members: AdminOrgMember[] }>(
      'List org members',
      this.provider === 'convex' ? '/members' : `/orgs/${encodeURIComponent(orgId)}/members`,
      {
        method: 'GET',
        headers: this.buildHeaders(false),
      },
      this.provider === 'convex' ? new URLSearchParams({ orgId }) : undefined,
    )
  }

  async listOrgs() {
    return this.request<{ orgs: AdminOrg[] }>('List orgs', '/orgs', {
      method: 'GET',
      headers: this.buildHeaders(false),
    })
  }

  async createOrg(input: { name: string; orgId?: string }) {
    return this.request<{ org: AdminOrg; created: boolean }>('Create org', '/orgs', {
      method: 'POST',
      headers: this.buildHeaders(true),
      body: JSON.stringify(input),
    })
  }

  async updateOrg(orgId: string, input: { name: string }) {
    return this.request<{ org: AdminOrg }>('Update org', this.provider === 'convex' ? '/orgs' : `/orgs/${encodeURIComponent(orgId)}`, {
      method: 'PUT',
      headers: this.buildHeaders(true),
      body: JSON.stringify(this.provider === 'convex' ? { orgId, ...input } : input),
    })
  }

  async upsertMember(orgId: string, member: { memberId: string; role: Role; email?: string | null }) {
    return this.request<{ member: AdminOrgMember }>(
      'Upsert org member',
      this.provider === 'convex' ? '/members' : `/orgs/${encodeURIComponent(orgId)}/members`,
      {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: JSON.stringify(this.provider === 'convex' ? { orgId, ...member } : member),
      },
    )
  }

  async inviteMember(orgId: string, input: { email: string; role: Role }) {
    if (this.provider !== 'convex') {
      throw new Error('Invite email delivery is not supported on the self-hosted provider')
    }
    return this.request<InviteMemberResponse>(
      'Invite org member',
      '/invites',
      {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: JSON.stringify({ orgId, ...input }),
      },
    )
  }

  async removeMember(orgId: string, memberId: string) {
    return this.request<{ ok: boolean; deleted?: boolean }>(
      'Remove org member',
      this.provider === 'convex'
        ? '/members'
        : `/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
      {
        method: 'DELETE',
        headers: this.buildHeaders(false),
      },
      this.provider === 'convex' ? new URLSearchParams({ orgId, memberId }) : undefined,
    )
  }

  async listAudit(orgId: string, params: { limit?: number; cursor?: string } = {}) {
    const query = new URLSearchParams()
    if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
      query.set('limit', String(Math.max(1, Math.min(200, Math.round(params.limit)))))
    }
    if (params.cursor) query.set('cursor', params.cursor)
    if (this.provider === 'convex') query.set('orgId', orgId)
    return this.request<PagedAuditResponse>(
      'List audit events',
      this.provider === 'convex' ? '/audit' : `/orgs/${encodeURIComponent(orgId)}/audit`,
      {
        method: 'GET',
        headers: this.buildHeaders(false),
      },
      query,
    )
  }

  async listOverrides(params: { limit?: number; cursor?: string } = {}) {
    const query = new URLSearchParams()
    if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
      query.set('limit', String(Math.max(1, Math.min(200, Math.round(params.limit)))))
    }
    if (params.cursor) query.set('cursor', params.cursor)
    const payload = await this.request<{ overrides: unknown[]; nextCursor: string | null }>('List entitlement overrides', '/entitlements/overrides', {
      method: 'GET',
      headers: this.buildHeaders(false),
    }, query)
    return {
      overrides: Array.isArray(payload.overrides)
        ? payload.overrides.map((row) => normalizeOverrideRow(row)).filter((row): row is EntitlementOverrideRow => Boolean(row))
        : [],
      nextCursor: typeof payload.nextCursor === 'string' && payload.nextCursor ? payload.nextCursor : null,
    } satisfies PagedOverridesResponse
  }

  async upsertOverride(input: UpsertEntitlementOverrideInput) {
    const payload = await this.request<{ ok: boolean; override: unknown }>('Upsert entitlement override', '/entitlements/overrides', {
      method: 'PUT',
      headers: this.buildHeaders(true),
      body: JSON.stringify(input),
    })
    return {
      ok: payload.ok,
      override: normalizeOverrideRow(payload.override),
    }
  }

  async clearOverride(input: { targetType: OverrideTargetType; targetValue: string }) {
    return this.request<{ ok: boolean; deleted: boolean }>('Delete entitlement override', '/entitlements/overrides', {
      method: 'DELETE',
      headers: this.buildHeaders(true),
      body: JSON.stringify(input),
    })
  }

  async listVaults(orgId: string) {
    return this.request<{ vaults: VaultSummary[] }>(
      'List org vaults',
      this.provider === 'convex' ? '/vaults' : `/orgs/${encodeURIComponent(orgId)}/vaults`,
      {
        method: 'GET',
        headers: this.buildHeaders(false),
      },
      this.provider === 'convex' ? new URLSearchParams({ orgId }) : undefined,
    )
  }

  async deleteVault(orgId: string, vaultId: string) {
    return this.request<{ ok: boolean; deleted: boolean }>(
      'Delete org vault',
      this.provider === 'convex' ? '/vaults' : `/orgs/${encodeURIComponent(orgId)}/vaults/${encodeURIComponent(vaultId)}`,
      {
        method: 'DELETE',
        headers: this.buildHeaders(false),
      },
      this.provider === 'convex' ? new URLSearchParams({ orgId, vaultId }) : undefined,
    )
  }

  async getOrgUsage(orgId: string) {
    return this.request<OrgUsageSummary>(
      'Get org usage summary',
      this.provider === 'convex' ? '/usage' : `/orgs/${encodeURIComponent(orgId)}/usage`,
      {
        method: 'GET',
        headers: this.buildHeaders(false),
      },
      this.provider === 'convex' ? new URLSearchParams({ orgId }) : undefined,
    )
  }

  async getSubscription(scopeType: SubscriptionScopeType, scopeId: string) {
    const query = new URLSearchParams({ scopeType, scopeId })
    const payload = await this.request<{ subscription: unknown; effective: unknown }>('Get subscription record', '/subscriptions', {
      method: 'GET',
      headers: this.buildHeaders(false),
    }, query)
    return {
      subscription: normalizeSubscription(payload.subscription),
      effective: normalizeEntitlementSummary(payload.effective),
    } satisfies SubscriptionResponse
  }

  async upsertSubscription(input: {
    scopeType: SubscriptionScopeType
    scopeId: string
    tier: PlanTier
    status: SubscriptionStatus
    billingMode: BillingMode
    seatLimit?: number | null
    storageLimitBytes?: number | null
    renewalAt?: string | null
    endAt?: string | null
    note?: string
  }) {
    const payload = await this.request<{ subscription: unknown; effective: unknown }>('Upsert subscription record', '/subscriptions', {
      method: 'PUT',
      headers: this.buildHeaders(true),
      body: JSON.stringify(input),
    })
    return {
      subscription: normalizeSubscription(payload.subscription),
      effective: normalizeEntitlementSummary(payload.effective),
    } satisfies SubscriptionResponse
  }

  async getOverview() {
    return this.request<OperatorOverview>('Get operator overview', '/overview', {
      method: 'GET',
      headers: this.buildHeaders(false),
    })
  }

  async searchCustomers(queryText: string) {
    const query = new URLSearchParams({ q: queryText })
    return this.request<{ results: CustomerSearchResult[] }>('Search customers', '/customers/search', {
      method: 'GET',
      headers: this.buildHeaders(false),
    }, query)
  }

  async getSystemStatus() {
    if (this.provider === 'convex') {
      return this.request<SystemStatus>('Get system status', '/system', {
        method: 'GET',
        headers: this.buildHeaders(false),
      })
    }
    return this.request<SystemStatus>('Get system status', '/system', {
      method: 'GET',
      headers: this.buildHeaders(false),
    })
  }

  async getSelfHostedHealth() {
    return this.requestSystem<{ ok: boolean; now?: string | null }>('Get health', '/healthz', {
      method: 'GET',
      headers: this.buildHeaders(false),
    })
  }
}

export function createAdminClient(options: AdminClientOptions) {
  return new AdminClient(options)
}
