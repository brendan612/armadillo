import type { ArmadilloVaultFile, SyncIdentitySource } from '../types/vault'
import type {
  AdminMember,
  AuthContext,
  BlobDeleteResponse,
  BlobGetResponse,
  BlobPutResponse,
  EntitlementFetchResponse,
  OrgMembership,
  RemoteBlobRecord,
  RegisteredOrgDevice,
  Role,
  SharedOrgVaultSummary,
  SharedVaultOpenResponse,
  SharedVaultPullResponse,
  SharedVaultPushResponse,
  VaultDeleteResponse,
} from './syncTypes'
import { getOwnerHint } from './owner'

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '')
}

function resolveHttpBaseUrl() {
  const siteUrl = (import.meta.env.VITE_CONVEX_SITE_URL || '').trim()
  if (siteUrl) {
    return normalizeBaseUrl(siteUrl)
  }

  const deploymentUrl = (import.meta.env.VITE_CONVEX_URL || '').trim()
  if (deploymentUrl) {
    return normalizeBaseUrl(deploymentUrl.replace('.convex.cloud', '.convex.site'))
  }

  const explicitHttpUrl = (import.meta.env.VITE_CONVEX_HTTP_URL || '').trim()
  if (explicitHttpUrl) {
    return normalizeBaseUrl(explicitHttpUrl)
  }

  return ''
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

type MembershipsResponse = {
  memberships: OrgMembership[]
}

type SharedVaultListResponse = {
  role: Role
  vaults: SharedOrgVaultSummary[]
}

type OrgDevicesResponse = {
  devices: RegisteredOrgDevice[]
}

type AdminMembersResponse = {
  members: AdminMember[]
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

export function getConvexAuthToken() {
  return authToken
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
  return postJson<PullResponse>('/api/v2/sync/pull', { vaultId }, 'Convex pull')
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

  return postJson<PushResponse>('/api/v2/sync/push', payload, 'Convex push')
}

export async function deleteRemoteVault(vaultId: string): Promise<VaultDeleteResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<VaultDeleteResponse>(
    '/api/v2/sync/vaults/delete',
    { vaultId },
    'Convex vault delete',
  )
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

export async function listOrgMemberships(): Promise<OrgMembership[]> {
  if (!hasConvexConfig()) {
    return []
  }
  const response = await getJson<MembershipsResponse>('/api/v2/org-shares/memberships', 'Convex org memberships')
  return Array.isArray(response.memberships) ? response.memberships : []
}

export async function listSharedVaultsByOrg(orgId: string): Promise<SharedVaultListResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return getJson<SharedVaultListResponse>(`/api/v2/org-shares/vaults?orgId=${encodeURIComponent(orgId)}`, 'Convex shared vault list')
}

export async function listAdminMembers(orgId: string): Promise<AdminMember[]> {
  if (!hasConvexConfig()) {
    return []
  }
  const response = await getJson<AdminMembersResponse>(`/api/v2/admin/members?orgId=${encodeURIComponent(orgId)}`, 'Convex admin members')
  return Array.isArray(response.members) ? response.members : []
}

export async function listOrgMemberDevices(orgId: string): Promise<RegisteredOrgDevice[]> {
  if (!hasConvexConfig()) {
    return []
  }
  const response = await getJson<OrgDevicesResponse>(`/api/v2/org-shares/devices?orgId=${encodeURIComponent(orgId)}`, 'Convex org devices')
  return Array.isArray(response.devices) ? response.devices : []
}

export async function registerOrgDeviceKey(input: {
  orgId: string
  deviceId: string
  platform: 'web' | 'desktop' | 'android'
  publicKeyJwk: JsonWebKey
}) {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<{ ok: boolean }>('/api/v2/org-shares/device-key', input, 'Convex org device registration')
}

export async function shareVaultWithOrg(input: {
  orgId: string
  vaultId: string
  memberAccess: Array<{
    memberId: string
    bootstrapPassword: string
    bootstrapKdf: NonNullable<SharedVaultOpenResponse['memberAccess']['bootstrapKdf']>
    bootstrapWrappedVaultKey: NonNullable<SharedVaultOpenResponse['memberAccess']['bootstrapWrappedVaultKey']>
  }>
}) {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<{ ok: boolean; sharedAt?: string }>('/api/v2/org-shares/share', input, 'Convex shared vault create')
}

export async function refreshSharedVaultAccess(input: {
  orgId: string
  vaultId: string
  memberAccess: Array<{
    memberId: string
    bootstrapPassword: string
    bootstrapKdf: NonNullable<SharedVaultOpenResponse['memberAccess']['bootstrapKdf']>
    bootstrapWrappedVaultKey: NonNullable<SharedVaultOpenResponse['memberAccess']['bootstrapWrappedVaultKey']>
  }>
}) {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<{ ok: boolean }>('/api/v2/org-shares/refresh', input, 'Convex shared vault refresh')
}

export async function unshareVaultFromOrg(orgId: string, vaultId: string) {
  if (!hasConvexConfig()) {
    return null
  }
  const response = await fetch(`${baseUrl}/api/v2/org-shares/share?orgId=${encodeURIComponent(orgId)}&vaultId=${encodeURIComponent(vaultId)}`, {
    method: 'DELETE',
    headers: buildHeaders(false),
  })
  return parseJsonResponse<{ ok: boolean; revoked: boolean }>(response, 'Convex shared vault delete')
}

export async function openSharedVault(input: { orgId: string; vaultId: string }): Promise<SharedVaultOpenResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<SharedVaultOpenResponse>('/api/v2/org-shares/open', input, 'Convex shared vault open')
}

export async function finalizeSharedVaultMemberAccess(input: {
  orgId: string
  vaultId: string
  memberKdf: NonNullable<SharedVaultOpenResponse['memberAccess']['memberKdf']>
  memberWrappedVaultKey: NonNullable<SharedVaultOpenResponse['memberAccess']['memberWrappedVaultKey']>
}) {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<{ ok: boolean }>('/api/v2/org-shares/access', input, 'Convex shared vault member access')
}

export async function pullSharedVaultSnapshot(input: { orgId: string; vaultId: string }): Promise<SharedVaultPullResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<SharedVaultPullResponse>('/api/v2/org-shares/pull', input, 'Convex shared vault pull')
}

export async function pushSharedVaultSnapshot(input: { orgId: string; file: ArmadilloVaultFile }): Promise<SharedVaultPushResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<SharedVaultPushResponse>('/api/v2/org-shares/push', {
    orgId: input.orgId,
    vaultId: input.file.vaultId,
    revision: input.file.revision,
    encryptedFile: JSON.stringify(input.file),
    updatedAt: input.file.updatedAt,
  }, 'Convex shared vault push')
}

export async function putSharedBlob(input: { orgId: string; vaultId: string; blob: RemoteBlobRecord }): Promise<BlobPutResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  const { orgId, blob } = input
  return postJson<BlobPutResponse>('/api/v2/org-shares/blobs/put', {
    orgId,
    ...blob,
  }, 'Convex shared blob put')
}

export async function getSharedBlob(input: { orgId: string; vaultId: string; blobId: string }): Promise<BlobGetResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<BlobGetResponse>('/api/v2/org-shares/blobs/get', input, 'Convex shared blob get')
}

export async function deleteSharedBlob(input: { orgId: string; vaultId: string; blobId: string }): Promise<BlobDeleteResponse | null> {
  if (!hasConvexConfig()) {
    return null
  }
  return postJson<BlobDeleteResponse>('/api/v2/org-shares/blobs/delete', input, 'Convex shared blob delete')
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
