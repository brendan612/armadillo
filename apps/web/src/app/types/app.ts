import type { VaultItem } from '../../types/vault'

export type AppPhase = 'create' | 'unlock' | 'ready'
export type Panel = 'details' | 'generator'
export type MobileStep = 'nav' | 'list' | 'detail'
export type SyncState = 'local' | 'syncing' | 'live' | 'error'
export type CloudAuthState = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'error'
export type FolderFilterMode = 'direct' | 'recursive'
export type SidebarNode = 'all' | 'unfiled' | 'trash' | `folder:${string}`

export type AppPlatform = 'web' | 'desktop' | 'mobile'

export type ItemContextMenuState = { itemId: string; x: number; y: number } | null
export type FolderContextMenuState = { folderId: string; x: number; y: number } | null

export type VaultOption = {
  id: string
  label: string
}

export type SetDraftField = <K extends keyof VaultItem>(key: K, value: VaultItem[K]) => void
