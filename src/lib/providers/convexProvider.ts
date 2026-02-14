import type { SyncProviderClient } from '../syncTypes'
import {
  convexConfigured,
  getCloudAuthStatus,
  listRemoteVaultsByOwner,
  pullRemoteSnapshot,
  pullRemoteVaultByOwner,
  pushRemoteSnapshot,
  setConvexAuthToken,
} from '../convexApi'

export const convexProvider: SyncProviderClient = {
  configured: convexConfigured,
  setAuthToken: setConvexAuthToken,
  pullRemoteVaultByOwner,
  listRemoteVaultsByOwner,
  pullRemoteSnapshot,
  pushRemoteSnapshot,
  getCloudAuthStatus,
  subscribeToVaultUpdates: () => () => {},
}
