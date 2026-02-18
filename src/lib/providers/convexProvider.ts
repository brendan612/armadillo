import type { SyncProviderClient } from '../syncTypes'
import {
  convexConfigured,
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
  putRemoteBlob,
  getRemoteBlob,
  deleteRemoteBlob,
  getCloudAuthStatus,
  fetchEntitlementToken: getEntitlementStatus,
  subscribeToVaultUpdates: () => () => {},
}
