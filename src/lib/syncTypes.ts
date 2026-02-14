import type { ArmadilloVaultFile, SyncIdentitySource } from '../types/vault'

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

export type CloudAuthStatus = {
  authenticated: boolean
  subject?: string | null
  email?: string | null
  name?: string | null
  tokenIdentifier?: string | null
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

export type SyncProviderClient = {
  configured: () => boolean
  setAuthToken: (token: string | null) => void
  pullRemoteVaultByOwner: () => Promise<PullResponse | null>
  listRemoteVaultsByOwner: () => Promise<ListByOwnerResponse | null>
  pullRemoteSnapshot: (vaultId: string) => Promise<PullResponse | null>
  pushRemoteSnapshot: (file: ArmadilloVaultFile) => Promise<PushResponse | null>
  getCloudAuthStatus: () => Promise<CloudAuthStatus | null>
  subscribeToVaultUpdates?: (vaultId: string, options: VaultUpdateSubscriptionOptions) => (() => void)
}
