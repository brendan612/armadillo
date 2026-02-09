import type { SaveVaultItemInput, VaultItem } from '../types/vault'
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

  // Convex deployments typically use .cloud while HTTP actions use .site.
  return normalizeBaseUrl(deploymentUrl.replace('.convex.cloud', '.convex.site'))
}

const baseUrl = resolveHttpBaseUrl()

export type OwnerSource = 'auth' | 'anonymous'

type ApiListResponse = { items: VaultItem[]; ownerSource: OwnerSource }
type ApiUpsertResponse = { ok: boolean; item: VaultItem; ownerSource: OwnerSource }
type ApiDeleteResponse = { ok: boolean; deleted: boolean; ownerSource: OwnerSource }

function hasConvexConfig() {
  return Boolean(baseUrl)
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-armadillo-owner': getOwnerHint(),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Convex request failed (${response.status}): ${errorText}`)
  }

  return (await response.json()) as T
}

export async function listVaultItems(): Promise<ApiListResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }

  return postJson<ApiListResponse>('/api/items/list', {})
}

export async function upsertVaultItem(item: SaveVaultItemInput): Promise<ApiUpsertResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }

  return postJson<ApiUpsertResponse>('/api/items/upsert', { item })
}

export async function deleteVaultItem(itemId: string): Promise<ApiDeleteResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }

  return postJson<ApiDeleteResponse>('/api/items/delete', { itemId })
}

export function convexConfigured() {
  return hasConvexConfig()
}
