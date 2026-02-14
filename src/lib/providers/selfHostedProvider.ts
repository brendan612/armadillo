import type { ArmadilloVaultFile } from '../../types/vault'
import { getOwnerHint } from '../owner'
import type {
  CloudAuthStatus,
  ListByOwnerResponse,
  PullResponse,
  PushResponse,
  SyncProviderClient,
  VaultUpdateEvent,
  VaultUpdateSubscriptionOptions,
} from '../syncTypes'

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '')
}

const baseUrl = normalizeBaseUrl(import.meta.env.VITE_SYNC_BASE_URL || '')
let authToken: string | null = import.meta.env.VITE_SYNC_AUTH_TOKEN || null

type StreamTokenResponse = {
  streamToken: string
  expiresAt: string
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-armadillo-owner': getOwnerHint(),
  }

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Self-hosted sync request failed (${response.status}): ${errorText}`)
  }

  return (await response.json()) as T
}

async function pullRemoteVaultByOwner(): Promise<PullResponse | null> {
  if (!baseUrl) return null
  return postJson<PullResponse>('/v1/vaults/pull-by-owner', {})
}

async function listRemoteVaultsByOwner(): Promise<ListByOwnerResponse | null> {
  if (!baseUrl) return null
  return postJson<ListByOwnerResponse>('/v1/vaults/list-by-owner', {})
}

async function pullRemoteSnapshot(vaultId: string): Promise<PullResponse | null> {
  if (!baseUrl) return null
  return postJson<PullResponse>(`/v1/vaults/${encodeURIComponent(vaultId)}/pull`, {})
}

async function pushRemoteSnapshot(file: ArmadilloVaultFile): Promise<PushResponse | null> {
  if (!baseUrl) return null
  return postJson<PushResponse>(`/v1/vaults/${encodeURIComponent(file.vaultId)}/push`, {
    revision: file.revision,
    encryptedFile: JSON.stringify(file),
    updatedAt: file.updatedAt,
  })
}

async function getCloudAuthStatus(): Promise<CloudAuthStatus | null> {
  if (!baseUrl) return null
  return postJson<CloudAuthStatus>('/v1/auth/status', {})
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
      const tokenResponse = await postJson<StreamTokenResponse>('/v1/events/token', { vaultId })
      if (stopped) return
      const streamToken = tokenResponse?.streamToken || ''
      if (!streamToken) {
        throw new Error('Missing stream token')
      }

      cleanupEventSource()
      const params = new URLSearchParams({ streamToken })
      const source = new EventSource(`${baseUrl}/v1/events/stream?${params.toString()}`)
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
  pullRemoteVaultByOwner,
  listRemoteVaultsByOwner,
  pullRemoteSnapshot,
  pushRemoteSnapshot,
  getCloudAuthStatus,
  subscribeToVaultUpdates,
}
