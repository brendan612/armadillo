import type { ArmadilloVaultFile, SyncIdentitySource } from '../types/vault'
import type {
  AuthContext,
  BlobDeleteResponse,
  BlobGetResponse,
  BlobPutResponse,
  EntitlementFetchResponse,
  RemoteBlobRecord,
} from './syncTypes'
import { getOwnerHint } from './owner'

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '')
}

function resolveHttpBaseUrl() {
  const explicitHttpUrl = import.meta.env.VITE_CONVEX_HTTP_URL || ''
  if (explicitHttpUrl) {
    return normalizeBaseUrl(explicitHttpUrl)
  }

  const deploymentUrl = import.meta.env.VITE_CONVEX_URL || ''
  if (!deploymentUrl) {
    return ''
  }

  return normalizeBaseUrl(deploymentUrl.replace('.convex.cloud', '.convex.site'))
}

const baseUrl = resolveHttpBaseUrl()
let authToken: string | null = null
let authContext: AuthContext | null = null

type PullResponse = {
  snapshot: ArmadilloVaultFile | null
  ownerSource: SyncIdentitySource
}

type ListByOwnerResponse = {
  snapshots: ArmadilloVaultFile[]
  ownerSource: SyncIdentitySource
}

type PushResponse = {
  ok: boolean
  accepted: boolean
  ownerSource: SyncIdentitySource
}

export type CloudAuthStatus = {
  authenticated: boolean
  subject?: string | null
  email?: string | null
  name?: string | null
  tokenIdentifier?: string | null
  authContext?: AuthContext | null
}

function hasConvexConfig() {
  return Boolean(baseUrl)
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

export function setConvexAuthToken(token: string | null) {
  authToken = token
}

export function setConvexAuthContext(context: AuthContext | null) {
  authContext = context
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

export function convexConfigured() {
  return hasConvexConfig()
}

export async function pullRemoteVaultByOwner(): Promise<PullResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  try {
    return await postJson<PullResponse>('/api/v2/sync/pull-by-owner', {}, 'Convex pull-by-owner')
  } catch {
    return postJson<PullResponse>('/api/sync/pull-by-owner', {}, 'Convex pull-by-owner (legacy)')
  }
}

export async function listRemoteVaultsByOwner(): Promise<ListByOwnerResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  try {
    return await postJson<ListByOwnerResponse>('/api/v2/sync/list-by-owner', {}, 'Convex list-by-owner')
  } catch {
    return postJson<ListByOwnerResponse>('/api/sync/list-by-owner', {}, 'Convex list-by-owner (legacy)')
  }
}

export async function pullRemoteSnapshot(vaultId: string): Promise<PullResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  try {
    return await postJson<PullResponse>(`/api/v2/sync/vaults/${encodeURIComponent(vaultId)}/pull`, {}, 'Convex pull')
  } catch {
    return postJson<PullResponse>('/api/sync/pull', { vaultId }, 'Convex pull (legacy)')
  }
}

export async function pushRemoteSnapshot(file: ArmadilloVaultFile): Promise<PushResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }

  const payload = {
    vaultId: file.vaultId,
    revision: file.revision,
    encryptedFile: JSON.stringify(file),
    updatedAt: file.updatedAt,
  }

  try {
    return await postJson<PushResponse>(`/api/v2/sync/vaults/${encodeURIComponent(file.vaultId)}/push`, payload, 'Convex push')
  } catch {
    return postJson<PushResponse>('/api/sync/push', payload, 'Convex push (legacy)')
  }
}

export async function putRemoteBlob(vaultId: string, blob: RemoteBlobRecord): Promise<BlobPutResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<BlobPutResponse>(
    '/api/v2/sync/blobs/put',
    { ...blob, vaultId },
    'Convex blob put',
  )
}

export async function getRemoteBlob(vaultId: string, blobId: string): Promise<BlobGetResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<BlobGetResponse>(
    '/api/v2/sync/blobs/get',
    { vaultId, blobId },
    'Convex blob get',
  )
}

export async function deleteRemoteBlob(vaultId: string, blobId: string): Promise<BlobDeleteResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<BlobDeleteResponse>(
    '/api/v2/sync/blobs/delete',
    { vaultId, blobId },
    'Convex blob delete',
  )
}

export async function getCloudAuthStatus(): Promise<CloudAuthStatus | null> {
  if (!hasConvexConfig()) {
    return null
  }

  let status: CloudAuthStatus
  try {
    status = await postJson<CloudAuthStatus>('/api/v2/auth/status', {}, 'Convex auth status')
  } catch {
    status = await postJson<CloudAuthStatus>('/api/auth/status', {}, 'Convex auth status (legacy)')
  }

  if (status?.authContext) {
    authContext = status.authContext
  }
  return status
}

export async function getEntitlementStatus(): Promise<EntitlementFetchResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  try {
    return await getJson<EntitlementFetchResponse>('/api/v2/entitlements/me', 'Convex entitlement')
  } catch {
    return {
      ok: false,
      token: null,
      reason: 'Entitlement endpoint unavailable',
      fetchedAt: new Date().toISOString(),
    }
  }
}
