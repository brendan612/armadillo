import type { SyncProvider } from '../types/vault'
import type { AuthContext } from './syncTypes'
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

export function setSyncAuthContext(context: AuthContext | null) {
  activeProvider.setAuthContext?.(context)
}

export const pullRemoteVaultByOwner = activeProvider.pullRemoteVaultByOwner
export const listRemoteVaultsByOwner = activeProvider.listRemoteVaultsByOwner
export const pullRemoteSnapshot = activeProvider.pullRemoteSnapshot
export const pushRemoteSnapshot = activeProvider.pushRemoteSnapshot
export const getCloudAuthStatus = activeProvider.getCloudAuthStatus
export const fetchEntitlementToken = activeProvider.fetchEntitlementToken ?? (async () => null)
export const listOrgAuditEvents = activeProvider.listOrgAuditEvents ?? (async () => [])
export const addOrgMember = activeProvider.addOrgMember ?? (async () => null)
export const removeOrgMember = activeProvider.removeOrgMember ?? (async () => false)
export function subscribeToVaultUpdates(
  vaultId: string,
  options: Parameters<NonNullable<typeof activeProvider.subscribeToVaultUpdates>>[1],
) {
  if (!activeProvider.subscribeToVaultUpdates) {
    return () => {}
  }
  return activeProvider.subscribeToVaultUpdates(vaultId, options)
}
