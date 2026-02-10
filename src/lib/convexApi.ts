import type { ArmadilloVaultFile, SyncIdentitySource } from '../types/vault'
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
}

function hasConvexConfig() {
  return Boolean(baseUrl)
}

export function setConvexAuthToken(token: string | null) {
  authToken = token
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
    throw new Error(`Convex request failed (${response.status}): ${errorText}`)
  }

  return (await response.json()) as T
}

export function convexConfigured() {
  return hasConvexConfig()
}

export async function pullRemoteVaultByOwner(): Promise<PullResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }

  return postJson<PullResponse>('/api/sync/pull-by-owner', {})
}

export async function listRemoteVaultsByOwner(): Promise<ListByOwnerResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }

  return postJson<ListByOwnerResponse>('/api/sync/list-by-owner', {})
}

export async function pullRemoteSnapshot(vaultId: string): Promise<PullResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }

  return postJson<PullResponse>('/api/sync/pull', { vaultId })
}

export async function pushRemoteSnapshot(file: ArmadilloVaultFile): Promise<PushResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }

  return postJson<PushResponse>('/api/sync/push', {
    vaultId: file.vaultId,
    revision: file.revision,
    encryptedFile: JSON.stringify(file),
    updatedAt: file.updatedAt,
  })
}

export async function getCloudAuthStatus(): Promise<CloudAuthStatus | null> {
  if (!hasConvexConfig()) {
    return null
  }

  return postJson<CloudAuthStatus>('/api/auth/status', {})
}
