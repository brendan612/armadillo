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

export function getSyncAuthToken() {
  return activeProvider.getAuthToken?.() ?? null
}

export function setSyncAuthContext(context: AuthContext | null) {
  activeProvider.setAuthContext?.(context)
}

export const pullRemoteVaultByOwner = activeProvider.pullRemoteVaultByOwner
export const listRemoteVaultsByOwner = activeProvider.listRemoteVaultsByOwner
export const pullRemoteSnapshot = activeProvider.pullRemoteSnapshot
export const pushRemoteSnapshot = activeProvider.pushRemoteSnapshot
export const deleteRemoteVault = activeProvider.deleteRemoteVault ?? (async () => null)
export const putRemoteBlob = activeProvider.putRemoteBlob ?? (async () => null)
export const getRemoteBlob = activeProvider.getRemoteBlob ?? (async () => null)
export const deleteRemoteBlob = activeProvider.deleteRemoteBlob ?? (async () => null)
export const getCloudAuthStatus = activeProvider.getCloudAuthStatus
export const listOrgMemberships = activeProvider.listOrgMemberships ?? (async () => [])
export const listSharedVaultsByOrg = activeProvider.listSharedVaultsByOrg ?? (async () => null)
export const listAdminMembers = activeProvider.listAdminMembers ?? (async () => [])
export const listOrgMemberDevices = activeProvider.listOrgMemberDevices ?? (async () => [])
export const registerOrgDeviceKey = activeProvider.registerOrgDeviceKey ?? (async () => null)
export const shareVaultWithOrg = activeProvider.shareVaultWithOrg ?? (async () => null)
export const refreshSharedVaultAccess = activeProvider.refreshSharedVaultAccess ?? (async () => null)
export const unshareVaultFromOrg = activeProvider.unshareVaultFromOrg ?? (async () => null)
export const openSharedVault = activeProvider.openSharedVault ?? (async () => null)
export const finalizeSharedVaultMemberAccess = activeProvider.finalizeSharedVaultMemberAccess ?? (async () => null)
export const pullSharedVaultSnapshot = activeProvider.pullSharedVaultSnapshot ?? (async () => null)
export const pushSharedVaultSnapshot = activeProvider.pushSharedVaultSnapshot ?? (async () => null)
export const putSharedBlob = activeProvider.putSharedBlob ?? (async () => null)
export const getSharedBlob = activeProvider.getSharedBlob ?? (async () => null)
export const deleteSharedBlob = activeProvider.deleteSharedBlob ?? (async () => null)
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
