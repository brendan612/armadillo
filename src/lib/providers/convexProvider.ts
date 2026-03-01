import type { SyncProviderClient } from '../syncTypes'
import {
  convexConfigured,
  deleteRemoteVault,
  deleteRemoteBlob,
  getCloudAuthStatus,
  getRemoteBlob,
  getEntitlementStatus,
  listRemoteVaultsByOwner,
  pullRemoteSnapshot,
  pullRemoteVaultByOwner,
  putRemoteBlob,
  pushRemoteSnapshot,
  setConvexAuthContext,
  setConvexAuthToken,
} from '../convexApi'

export const convexProvider: SyncProviderClient = {
  configured: convexConfigured,
  setAuthToken: setConvexAuthToken,
  setAuthContext: setConvexAuthContext,
  pullRemoteVaultByOwner,
  listRemoteVaultsByOwner,
  pullRemoteSnapshot,
  pushRemoteSnapshot,
  deleteRemoteVault,
  putRemoteBlob,
  getRemoteBlob,
  deleteRemoteBlob,
  getCloudAuthStatus,
  fetchEntitlementToken: getEntitlementStatus,
  subscribeToVaultUpdates: () => () => {},
}
