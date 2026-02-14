import type { SyncProvider } from '../types/vault'
import { convexProvider } from './providers/convexProvider'
import { selfHostedProvider } from './providers/selfHostedProvider'

const rawProvider = (import.meta.env.VITE_SYNC_PROVIDER || 'convex').toLowerCase()

export const syncProvider: SyncProvider = rawProvider === 'self_hosted' ? 'self_hosted' : 'convex'
const activeProvider = syncProvider === 'self_hosted' ? selfHostedProvider : convexProvider

export function syncConfigured() {
  return activeProvider.configured()
}

export function setSyncAuthToken(token: string | null) {
  activeProvider.setAuthToken(token)
}

export const pullRemoteVaultByOwner = activeProvider.pullRemoteVaultByOwner
export const listRemoteVaultsByOwner = activeProvider.listRemoteVaultsByOwner
export const pullRemoteSnapshot = activeProvider.pullRemoteSnapshot
export const pushRemoteSnapshot = activeProvider.pushRemoteSnapshot
export const getCloudAuthStatus = activeProvider.getCloudAuthStatus
export function subscribeToVaultUpdates(
  vaultId: string,
  options: Parameters<NonNullable<typeof activeProvider.subscribeToVaultUpdates>>[1],
) {
  if (!activeProvider.subscribeToVaultUpdates) {
    return () => {}
  }
  return activeProvider.subscribeToVaultUpdates(vaultId, options)
}
