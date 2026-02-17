import type { ArmadilloVaultFile, SyncIdentitySource } from '../types/vault'

export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

export type AuthContext = {
  subject: string
  orgId: string
  roles: Role[]
  sessionId: string
}

export type PullResponse = {
  snapshot: ArmadilloVaultFile | null
  ownerSource: SyncIdentitySource
}

export type ListByOwnerResponse = {
  snapshots: ArmadilloVaultFile[]
  ownerSource: SyncIdentitySource
}

export type PushResponse = {
  ok: boolean
  accepted: boolean
  ownerSource: SyncIdentitySource
}

export type RemoteBlobRecord = {
  blobId: string
  vaultId: string
  nonce: string
  ciphertext: string
  sizeBytes: number
  sha256: string
  mimeType: string
  fileName: string
  updatedAt: string
}

export type BlobPutResponse = {
  ok: boolean
  accepted: boolean
  ownerSource: SyncIdentitySource
  usedBytes: number
}

export type BlobGetResponse = {
  blob: RemoteBlobRecord | null
  ownerSource: SyncIdentitySource
}

export type BlobDeleteResponse = {
  ok: boolean
  deleted: boolean
  ownerSource: SyncIdentitySource
  usedBytes: number
}

export type CloudAuthStatus = {
  authenticated: boolean
  subject?: string | null
  email?: string | null
  name?: string | null
  tokenIdentifier?: string | null
  authContext?: AuthContext | null
}

export type EntitlementFetchResponse = {
  ok: boolean
  token: string | null
  reason: string
  expiresAt?: string | null
  fetchedAt?: string
}

export type VaultUpdateEvent = {
  type: 'vault-updated'
  vaultId: string
  revision: number
  updatedAt: string
}

export type VaultUpdateSubscriptionOptions = {
  onEvent: (event: VaultUpdateEvent) => void
  onError?: (error: unknown) => void
}

export type AuditEvent = {
  id: string
  orgId: string
  actorSubject: string
  action: string
  target: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export type AdminMember = {
  memberId: string
  role: Role
  addedAt: string
}

export type EntitlementStatusResponse = {
  ok: boolean
  token: string | null
  reason: string
  expiresAt: string | null
  fetchedAt: string
}

export type SyncProviderClient = {
  configured: () => boolean
  setAuthToken: (token: string | null) => void
  setAuthContext?: (context: AuthContext | null) => void
  pullRemoteVaultByOwner: () => Promise<PullResponse | null>
  listRemoteVaultsByOwner: () => Promise<ListByOwnerResponse | null>
  pullRemoteSnapshot: (vaultId: string) => Promise<PullResponse | null>
  pushRemoteSnapshot: (file: ArmadilloVaultFile) => Promise<PushResponse | null>
  putRemoteBlob?: (vaultId: string, blob: RemoteBlobRecord) => Promise<BlobPutResponse | null>
  getRemoteBlob?: (vaultId: string, blobId: string) => Promise<BlobGetResponse | null>
  deleteRemoteBlob?: (vaultId: string, blobId: string) => Promise<BlobDeleteResponse | null>
  getCloudAuthStatus: () => Promise<CloudAuthStatus | null>
  fetchEntitlementToken?: () => Promise<EntitlementFetchResponse | null>
  subscribeToVaultUpdates?: (vaultId: string, options: VaultUpdateSubscriptionOptions) => (() => void)
  listOrgAuditEvents?: (orgId: string) => Promise<AuditEvent[]>
  addOrgMember?: (orgId: string, member: { memberId: string; role: Role }) => Promise<AdminMember | null>
  removeOrgMember?: (orgId: string, memberId: string) => Promise<boolean>
}
