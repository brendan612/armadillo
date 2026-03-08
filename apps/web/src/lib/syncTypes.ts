import type { ArmadilloVaultFile, SyncIdentitySource } from '../types/vault'
import type { CapabilityKey, PlanTier, RolloutFlagMap } from '../types/entitlements'

export type Role = 'owner' | 'admin' | 'editor' | 'viewer'
export type OverrideTargetType = 'userId' | 'tokenIdentifier' | 'subject' | 'email'

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

export type VaultDeleteResponse = {
  ok: boolean
  deleted: boolean
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
  derived?: {
    source: 'subscription' | 'server_default' | 'free' | 'override'
    tier: PlanTier
    capabilities: CapabilityKey[]
    flags: RolloutFlagMap
    expiresAt?: string | null
    subject?: string | null
  } | null
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
  allowed: boolean
  reasons: string[]
}

export type AdminMeResponse = {
  authenticated: boolean
  identity: AdminIdentity | null
  permissions: AdminPermissions
}

export type AdminAuditPage = {
  events: AuditEvent[]
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

export type EntitlementOverridePage = {
  overrides: EntitlementOverrideRow[]
  nextCursor: string | null
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
  getAuthToken?: () => string | null
  setAuthContext?: (context: AuthContext | null) => void
  pullRemoteVaultByOwner: () => Promise<PullResponse | null>
  listRemoteVaultsByOwner: () => Promise<ListByOwnerResponse | null>
  pullRemoteSnapshot: (vaultId: string) => Promise<PullResponse | null>
  pushRemoteSnapshot: (file: ArmadilloVaultFile) => Promise<PushResponse | null>
  deleteRemoteVault?: (vaultId: string) => Promise<VaultDeleteResponse | null>
  putRemoteBlob?: (vaultId: string, blob: RemoteBlobRecord) => Promise<BlobPutResponse | null>
  getRemoteBlob?: (vaultId: string, blobId: string) => Promise<BlobGetResponse | null>
  deleteRemoteBlob?: (vaultId: string, blobId: string) => Promise<BlobDeleteResponse | null>
  getCloudAuthStatus: () => Promise<CloudAuthStatus | null>
  fetchEntitlementToken?: () => Promise<EntitlementFetchResponse | null>
  subscribeToVaultUpdates?: (vaultId: string, options: VaultUpdateSubscriptionOptions) => (() => void)
  listOrgAuditEvents?: (orgId: string) => Promise<AuditEvent[]>
  addOrgMember?: (orgId: string, member: { memberId: string; role: Role }) => Promise<AdminMember | null>
  removeOrgMember?: (orgId: string, memberId: string) => Promise<boolean>
  getAdminMe?: () => Promise<AdminMeResponse | null>
  listAdminMembers?: (orgId: string) => Promise<AdminMember[]>
  upsertAdminMember?: (orgId: string, member: { memberId: string; role: Role }) => Promise<AdminMember | null>
  removeAdminMember?: (orgId: string, memberId: string) => Promise<boolean>
  listAdminAudit?: (orgId: string, options?: { limit?: number; cursor?: string }) => Promise<AdminAuditPage>
  listEntitlementOverrides?: (options?: { limit?: number; cursor?: string }) => Promise<EntitlementOverridePage>
  upsertEntitlementOverride?: (input: {
    targetType: OverrideTargetType
    targetValue: string
    token: string
    note?: string
  }) => Promise<EntitlementOverrideRow | null>
  deleteEntitlementOverride?: (input: { targetType: OverrideTargetType; targetValue: string }) => Promise<boolean>
}
