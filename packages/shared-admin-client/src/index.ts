export type SyncProvider = 'convex' | 'self_hosted'

export type Role = 'owner' | 'admin' | 'editor' | 'viewer'
export type OverrideTargetType = 'userId' | 'tokenIdentifier' | 'subject' | 'email'

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
  role: Role
  addedAt: string
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
  note: string
  updatedAt: string
  updatedBy: string
}

export type PagedOverridesResponse = {
  overrides: EntitlementOverrideRow[]
  nextCursor: string | null
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

function providerBasePath(provider: SyncProvider) {
  return provider === 'convex' ? '/api/v2/admin' : '/v2/admin'
}

function parseErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const row = payload as Record<string, unknown>
  return typeof row.error === 'string' ? row.error : ''
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

  async getMe() {
    return this.request<AdminMeResponse>('Get admin identity', '/me', {
      method: 'GET',
      headers: this.buildHeaders(false),
    })
  }

  async listMembers(orgId: string) {
    return this.request<{ members: AdminOrgMember[] }>(
      'List org members',
      this.provider === 'convex'
        ? '/members'
        : `/orgs/${encodeURIComponent(orgId)}/members`,
      {
        method: 'GET',
        headers: this.buildHeaders(false),
      },
      this.provider === 'convex' ? new URLSearchParams({ orgId }) : undefined,
    )
  }

  async listOrgs() {
    return this.request<{ orgs: AdminOrg[] }>(
      'List orgs',
      '/orgs',
      {
        method: 'GET',
        headers: this.buildHeaders(false),
      },
    )
  }

  async createOrg(input: { name: string; orgId?: string }) {
    return this.request<{ org: AdminOrg; created: boolean }>(
      'Create org',
      '/orgs',
      {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: JSON.stringify(input),
      },
    )
  }

  async upsertMember(orgId: string, member: { memberId: string; role: Role }) {
    return this.request<{ member: AdminOrgMember }>(
      'Upsert org member',
      this.provider === 'convex'
        ? '/members'
        : `/orgs/${encodeURIComponent(orgId)}/members`,
      {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: JSON.stringify(this.provider === 'convex' ? { orgId, ...member } : member),
      },
    )
  }

  async removeMember(orgId: string, memberId: string) {
    return this.request<{ ok: boolean }>(
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
    if (this.provider === 'convex') {
      query.set('orgId', orgId)
    }
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
    return this.request<PagedOverridesResponse>('List entitlement overrides', '/entitlements/overrides', {
      method: 'GET',
      headers: this.buildHeaders(false),
    }, query)
  }

  async upsertOverride(input: {
    targetType: OverrideTargetType
    targetValue: string
    token: string
    note?: string
  }) {
    return this.request<{ ok: boolean; override: EntitlementOverrideRow }>('Upsert entitlement override', '/entitlements/overrides', {
      method: 'PUT',
      headers: this.buildHeaders(true),
      body: JSON.stringify(input),
    })
  }

  async clearOverride(input: { targetType: OverrideTargetType; targetValue: string }) {
    return this.request<{ ok: boolean; deleted: boolean }>('Delete entitlement override', '/entitlements/overrides', {
      method: 'DELETE',
      headers: this.buildHeaders(true),
      body: JSON.stringify(input),
    })
  }
}

export function createAdminClient(options: AdminClientOptions) {
  return new AdminClient(options)
}
