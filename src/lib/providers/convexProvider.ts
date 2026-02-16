import type { SyncProviderClient } from '../syncTypes'
import {
  convexConfigured,
  getCloudAuthStatus,
  getEntitlementStatus,
  listRemoteVaultsByOwner,
  pullRemoteSnapshot,
  pullRemoteVaultByOwner,
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
  getCloudAuthStatus,
  fetchEntitlementToken: getEntitlementStatus,
  subscribeToVaultUpdates: () => () => {},
}
