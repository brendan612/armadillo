import type { ArmadilloVaultFile } from '../../types/vault'
import { getOwnerHint } from '../owner'
import type {
  AdminMember,
  AuditEvent,
  AuthContext,
  CloudAuthStatus,
  EntitlementFetchResponse,
  ListByOwnerResponse,
  PullResponse,
  PushResponse,
  Role,
  SyncProviderClient,
  VaultUpdateEvent,
  VaultUpdateSubscriptionOptions,
} from '../syncTypes'

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '')
}

const baseUrl = normalizeBaseUrl(import.meta.env.VITE_SYNC_BASE_URL || '')
let authToken: string | null = import.meta.env.VITE_SYNC_AUTH_TOKEN || null
let authContext: AuthContext | null = null

type StreamTokenResponse = {
  streamToken: string
  expiresAt: string
}

type MemberResponse = {
  member: AdminMember | null
}

type AuditResponse = {
  events: AuditEvent[]
}

function buildHeaders(contentType = true) {
  const headers: Record<string, string> = {
    'x-armadillo-owner': getOwnerHint(),
  }
  if (contentType) {
    headers['Content-Type'] = 'application/json'
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }
  if (authContext?.orgId) {
    headers['x-armadillo-org'] = authContext.orgId
  }
  if (authContext?.sessionId) {
    headers['x-armadillo-session'] = authContext.sessionId
  }
  return headers
}

async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`${context} failed (${response.status}): ${errorText}`)
  }
  return (await response.json()) as T
}

async function postJson<T>(path: string, body: unknown, context: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(body),
  })
  return parseJsonResponse<T>(response, context)
}

async function getJson<T>(path: string, context: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: buildHeaders(false),
  })
  return parseJsonResponse<T>(response, context)
}

async function deleteJson<T>(path: string, context: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: buildHeaders(false),
  })
  return parseJsonResponse<T>(response, context)
}

async function pullRemoteVaultByOwner(): Promise<PullResponse | null> {
  if (!baseUrl) return null
  try {
    return await postJson<PullResponse>('/v2/vaults/pull-by-owner', {}, 'Self-hosted pull-by-owner')
  } catch {
    return postJson<PullResponse>('/v1/vaults/pull-by-owner', {}, 'Self-hosted pull-by-owner (legacy)')
  }
}

async function listRemoteVaultsByOwner(): Promise<ListByOwnerResponse | null> {
  if (!baseUrl) return null
  try {
    return await postJson<ListByOwnerResponse>('/v2/vaults/list-by-owner', {}, 'Self-hosted list-by-owner')
  } catch {
    return postJson<ListByOwnerResponse>('/v1/vaults/list-by-owner', {}, 'Self-hosted list-by-owner (legacy)')
  }
}

async function pullRemoteSnapshot(vaultId: string): Promise<PullResponse | null> {
  if (!baseUrl) return null
  try {
    return await postJson<PullResponse>(`/v2/vaults/${encodeURIComponent(vaultId)}/pull`, {}, 'Self-hosted pull')
  } catch {
    return postJson<PullResponse>(`/v1/vaults/${encodeURIComponent(vaultId)}/pull`, {}, 'Self-hosted pull (legacy)')
  }
}

async function pushRemoteSnapshot(file: ArmadilloVaultFile): Promise<PushResponse | null> {
  if (!baseUrl) return null

  const idempotencyKey = `${file.vaultId}:${file.revision}:${file.updatedAt}`
  const payload = {
    revision: file.revision,
    encryptedFile: JSON.stringify(file),
    updatedAt: file.updatedAt,
  }

  try {
    const response = await fetch(`${baseUrl}/v2/vaults/${encodeURIComponent(file.vaultId)}/push`, {
      method: 'POST',
      headers: {
        ...buildHeaders(true),
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    })
    return parseJsonResponse<PushResponse>(response, 'Self-hosted push')
  } catch {
    return postJson<PushResponse>(`/v1/vaults/${encodeURIComponent(file.vaultId)}/push`, payload, 'Self-hosted push (legacy)')
  }
}

async function getCloudAuthStatus(): Promise<CloudAuthStatus | null> {
  if (!baseUrl) return null
  const status = await postJson<CloudAuthStatus>('/v2/auth/status', {}, 'Self-hosted auth status')
  if (status?.authContext) {
    authContext = status.authContext
  }
  return status
}

async function fetchEntitlementToken(): Promise<EntitlementFetchResponse | null> {
  if (!baseUrl) return null
  const response = await getJson<EntitlementFetchResponse>('/v2/entitlements/me', 'Self-hosted entitlement')
  return response
}

async function listOrgAuditEvents(orgId: string): Promise<AuditEvent[]> {
  if (!baseUrl) return []
  const response = await getJson<AuditResponse>(`/v2/orgs/${encodeURIComponent(orgId)}/audit`, 'Self-hosted audit list')
  return Array.isArray(response.events) ? response.events : []
}

async function addOrgMember(orgId: string, member: { memberId: string; role: Role }): Promise<AdminMember | null> {
  if (!baseUrl) return null
  const response = await postJson<MemberResponse>(
    `/v2/orgs/${encodeURIComponent(orgId)}/members`,
    member,
    'Self-hosted add member',
  )
  return response.member ?? null
}

async function removeOrgMember(orgId: string, memberId: string): Promise<boolean> {
  if (!baseUrl) return false
  const response = await deleteJson<{ ok: boolean }>(
    `/v2/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
    'Self-hosted remove member',
  )
  return Boolean(response.ok)
}

function subscribeToVaultUpdates(vaultId: string, options: VaultUpdateSubscriptionOptions) {
  if (!baseUrl || typeof EventSource === 'undefined') {
    return () => {}
  }

  let eventSource: EventSource | null = null
  let stopped = false
  let reconnectTimer: number | null = null

  const cleanupEventSource = () => {
    if (!eventSource) return
    eventSource.close()
    eventSource = null
  }

  const scheduleReconnect = () => {
    if (stopped) return
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer)
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, 1500)
  }

  const connect = async () => {
    if (stopped) return
    try {
      const tokenResponse = await postJson<StreamTokenResponse>('/v2/events/token', { vaultId }, 'Self-hosted event token')
      if (stopped) return
      const streamToken = tokenResponse?.streamToken || ''
      if (!streamToken) {
        throw new Error('Missing stream token')
      }

      cleanupEventSource()
      const params = new URLSearchParams({ streamToken })
      const source = new EventSource(`${baseUrl}/v2/vaults/${encodeURIComponent(vaultId)}/events?${params.toString()}`)
      eventSource = source

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as VaultUpdateEvent
          if (payload?.type === 'vault-updated' && typeof payload.vaultId === 'string') {
            options.onEvent(payload)
          }
        } catch (error) {
          options.onError?.(error)
        }
      }

      source.onerror = (error) => {
        options.onError?.(error)
        cleanupEventSource()
        scheduleReconnect()
      }
    } catch (error) {
      options.onError?.(error)
      scheduleReconnect()
    }
  }

  void connect()

  return () => {
    stopped = true
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    cleanupEventSource()
  }
}

export const selfHostedProvider: SyncProviderClient = {
  configured: () => Boolean(baseUrl),
  setAuthToken: (token) => {
    authToken = token || import.meta.env.VITE_SYNC_AUTH_TOKEN || null
  },
  setAuthContext: (context) => {
    authContext = context
  },
  pullRemoteVaultByOwner,
  listRemoteVaultsByOwner,
  pullRemoteSnapshot,
  pushRemoteSnapshot,
  getCloudAuthStatus,
  fetchEntitlementToken,
  subscribeToVaultUpdates,
  listOrgAuditEvents,
  addOrgMember,
  removeOrgMember,
}
