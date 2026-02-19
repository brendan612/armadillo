import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ConvexHttpClient } from 'convex/browser'
import { useConvexAuth } from 'convex/react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  deleteRemoteBlob,
  fetchEntitlementToken,
  getCloudAuthStatus,
  getRemoteBlob,
  listRemoteVaultsByOwner,
  putRemoteBlob,
  pullRemoteSnapshot,
  pushRemoteSnapshot,
  setSyncAuthToken,
  setSyncAuthContext,
  subscribeToVaultUpdates,
  syncConfigured,
  syncProvider,
} from '../../lib/syncClient'
import { convexAuthStorageNamespace, convexUrl } from '../../lib/convexClient'
import { bindPasskeyOwner } from '../../lib/owner'
import { biometricEnrollmentExists, enrollBiometricQuickUnlock, unlockWithBiometric } from '../../lib/biometric'
import { getAutoPlatform, isNativeAndroid } from '../../shared/utils/platform'
import { parseGooglePasswordCsv } from '../../shared/utils/googlePasswordCsv'
import { parseKeePassCsv } from '../../shared/utils/keePassCsv'
import { parseKeePassXml } from '../../shared/utils/keePassXml'
import { getPasswordExpiryStatus } from '../../shared/utils/passwordExpiry'
import {
  decryptBytesWithVaultKey,
  encryptBytesWithVaultKey,
  encryptJsonWithKey,
  sha256Base64,
} from '../../lib/crypto'
import { blobStore } from '../../lib/blobStore'
import {
  buildAutoFolderPlan,
  normalizeAutoFolderPath,
  summarizeAutoFolderPlanDraft,
  type AutoFolderAssignment,
  type AutoFolderPlan,
} from '../../shared/utils/autoFoldering'
import {
  analyzePassword,
  buildPasswordStrengthContextFromItem,
  computePasswordReuseCounts,
  mapAnalysisToRisk,
  recomputeItemRisks,
} from '../../shared/utils/passwordStrength'
import { LocalNotifications } from '@capacitor/local-notifications'
import AutofillBridge, { type CapturedCredentialDTO } from '../../plugins/autofillBridge'
import {
  clearCachedVaultSnapshot,
  clearLocalVaultFile,
  createVaultFile,
  getCachedVaultExpiresAt,
  getCachedVaultStatus,
  getCloudCacheTtlHours,
  getLocalVaultPath,
  getVaultStorageMode,
  loadCachedVaultSnapshot,
  loadLocalVaultFile,
  parseVaultFileFromText,
  readPayloadWithSessionKey,
  rewriteVaultFile,
  saveCachedVaultSnapshot,
  saveLocalVaultFile,
  setCloudCacheTtlHours as setStoredCloudCacheTtlHours,
  setLocalVaultPath as setStoredLocalVaultPath,
  setVaultStorageMode as setStoredVaultStorageMode,
  serializeVaultFile,
  unlockVaultFile,
} from '../../lib/vaultFile'
import {
  BUILT_IN_THEME_PRESETS,
  applyPresetSelection,
  areThemeSettingsEqual,
  defaultThemeSettings,
  deleteCustomThemePreset,
  loadThemeSettingsFromMirror,
  normalizeThemeSettings,
  normalizeThemeTokenOverrides,
  resolveThemeTokens,
  saveThemeSettingsToMirror,
  upsertCustomThemePreset,
} from '../../shared/utils/theme'
import {
  clearDevFlagOverride,
  getCachedEntitlementToken,
  getDevFlagOverride,
  getEntitlementLastRefreshAt,
  getEntitlementStaleAt,
  getManualEntitlementToken,
  isEntitlementStale,
  setCachedEntitlementToken,
  setDevFlagOverride,
  setEntitlementLastRefreshAt,
  setManualEntitlementToken,
} from '../../features/flags/entitlementCache'
import { resolveFlags } from '../../features/flags/resolveFlags'
import { verifyEntitlementJwt } from '../../features/flags/verifyEntitlementJwt'
import {
  defaultUpdateCheckResult,
  evaluateUpdateStatus,
  fetchUpdateManifest,
  getAppBuildInfo,
  type UpdateCheckResult,
} from '../../lib/updateManifest'
import type {
  ArmadilloVaultFile,
  StorageKind,
  SecurityQuestion,
  ThemeEditableTokenKey,
  ThemeMotionLevel,
  VaultFolder,
  VaultItem,
  VaultPayload,
  VaultStorageItem,
  VaultSession,
  VaultSettings,
  VaultStorageMode,
  VaultThemeSettings,
  VaultTrashEntry,
} from '../../types/vault'
import type {
  CapabilityKey,
  DevFlagOverride,
  EntitlementState,
} from '../../types/entitlements'

type AppPhase = 'create' | 'unlock' | 'ready'
type Panel = 'details'
type MobileStep = 'home' | 'nav' | 'list' | 'detail'
type SyncState = 'local' | 'syncing' | 'live' | 'error'
type CloudAuthState = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'error'
type FolderFilterMode = 'direct' | 'recursive'
type SettingsCategoryId = 'general' | 'cloud' | 'security' | 'vault' | 'billing' | 'danger'
type SidebarNode = 'home' | 'all' | 'expiring' | 'expired' | 'unfiled' | 'trash' | `folder:${string}`
type WorkspaceSection = 'passwords' | 'storage'
type ItemContextMenuState = { itemId: string; x: number; y: number } | null
type StorageContextMenuState = { itemId: string; x: number; y: number } | null
type FolderContextMenuState = { folderId: string; x: number; y: number } | null
type FolderInlineEditorState =
  | { mode: 'create'; parentId: string | null; value: string }
  | { mode: 'rename'; folderId: string; parentId: string | null; value: string }
type ApplySessionOptions = {
  resetNavigation?: boolean
}

const CLOUD_SYNC_PREF_KEY = 'armadillo.cloud_sync_enabled'
const CLOUD_LIVE_REFRESH_INTERVAL_MS_MOBILE = 4000
const CLOUD_LIVE_REFRESH_INTERVAL_MS_WEB = 10000
const CLOUD_LIVE_REFRESH_INTERVAL_MS_DESKTOP = 15000
const CLOUD_LIVE_REFRESH_INTERVAL_MS_SELF_HOSTED_FALLBACK = 60000
const UNLOCK_SPINNER_MIN_VISIBLE_MS = 240
const DEFAULT_FOLDER_COLOR = '#7f9cff'
const DEFAULT_FOLDER_ICON = 'folder'
const OAUTH_VERIFIER_STORAGE_KEY = '__convexAuthOAuthVerifier'
const ANDROID_OAUTH_REDIRECT_URL = 'armadillo://oauth-callback'
const PASSWORD_EXPIRING_SOON_DAYS = 7
const HOME_SEARCH_RESULTS_LIMIT = 8
const HOME_RECENT_ITEMS_LIMIT = 8
const BILLING_URL = (import.meta.env.VITE_BILLING_URL || '').trim()
const APP_BUILD_INFO = getAppBuildInfo()
const STORAGE_FILE_LIMIT_BYTES = 20 * 1024 * 1024
const STORAGE_TOTAL_LIMIT_BYTES = 2 * 1024 * 1024 * 1024

type BackupManifestBlob = {
  blobId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  updatedAt: string
  path: string
}

type BackupManifest = {
  version: 1
  vaultId: string
  createdAt: string
  blobCount: number
  blobs: BackupManifestBlob[]
}

function defaultEntitlementState(reason = 'Free plan active'): EntitlementState {
  return {
    source: 'free',
    status: 'free',
    tier: 'free',
    capabilities: [],
    flags: {},
    expiresAt: null,
    lastRefreshAt: null,
    staleAt: null,
    reason,
  }
}

function toIsoOrNull(value: unknown) {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

/* shell sections moved inline into sidebar nav */

function buildEmptyItem(folderName = '', folderId: string | null = null): VaultItem {
  return {
    id: crypto.randomUUID(),
    title: 'New Credential',
    username: '',
    passwordMasked: '',
    urls: [],
    linkedAndroidPackages: [],
    folder: folderName,
    folderId,
    tags: [],
    risk: 'safe',
    updatedAt: new Date().toLocaleString(),
    note: '',
    securityQuestions: [],
    passwordExpiryDate: null,
    excludeFromCloudSync: false,
  }
}

function buildEmptyStorageItem(folderName = '', folderId: string | null = null): VaultStorageItem {
  return {
    id: crypto.randomUUID(),
    title: 'New Storage Item',
    kind: 'document',
    folder: folderName,
    folderId,
    tags: [],
    note: '',
    updatedAt: new Date().toLocaleString(),
    excludeFromCloudSync: false,
    textValue: '',
    blobRef: null,
  }
}

function applyComputedItemRisks(items: VaultItem[]) {
  return recomputeItemRisks(items).nextItems
}

function inferStorageKindFromMime(mimeType: string, fallbackName = ''): StorageKind {
  const mime = mimeType.trim().toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.includes('json') || mime.includes('pem') || mime.includes('pkcs')) return 'key'
  if (mime.startsWith('text/')) return 'document'
  const fileName = fallbackName.trim().toLowerCase()
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(fileName)) return 'image'
  if (/\.(pem|key|p12|pfx|asc)$/.test(fileName)) return 'key'
  if (/\.(txt|md|pdf|doc|docx|rtf)$/.test(fileName)) return 'document'
  return 'other'
}

function formatFolderPath(folderId: string | null, folderMap: Map<string, VaultFolder>): string {
  if (!folderId) return 'Unfiled'
  const chain: string[] = []
  let current = folderMap.get(folderId) ?? null
  let guard = 0
  while (current && guard < 32) {
    chain.unshift(current.name)
    current = current.parentId ? folderMap.get(current.parentId) ?? null : null
    guard += 1
  }
  return chain.join(' / ') || 'Unfiled'
}

function collectDescendantIds(folderId: string, folders: VaultFolder[]): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const folder of folders) {
    if (!folder.parentId) continue
    const rows = childrenByParent.get(folder.parentId) ?? []
    rows.push(folder.id)
    childrenByParent.set(folder.parentId, rows)
  }
  const collected: string[] = []
  const queue = [folderId]
  while (queue.length) {
    const current = queue.shift() as string
    collected.push(current)
    for (const childId of childrenByParent.get(current) ?? []) {
      queue.push(childId)
    }
  }
  return collected
}

function collectCloudExcludedFolderIds(folders: VaultFolder[]) {
  const childrenByParent = new Map<string, string[]>()
  for (const folder of folders) {
    if (!folder.parentId) continue
    const rows = childrenByParent.get(folder.parentId) ?? []
    rows.push(folder.id)
    childrenByParent.set(folder.parentId, rows)
  }

  const excluded = new Set<string>()
  const queue = folders.filter((folder) => folder.excludeFromCloudSync).map((folder) => folder.id)
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (excluded.has(current)) continue
    excluded.add(current)
    for (const childId of childrenByParent.get(current) ?? []) {
      queue.push(childId)
    }
  }
  return excluded
}

function isTrashEntryCloudSyncable(
  entry: VaultTrashEntry,
  excludedItemIds: Set<string>,
  excludedStorageItemIds: Set<string>,
  excludedFolderIds: Set<string>,
) {
  if (entry.kind === 'itemSnapshot') {
    const payload = (entry.payload && typeof entry.payload === 'object' ? entry.payload : null) as Record<string, unknown> | null
    if (!payload) return false
    const itemId = typeof payload.id === 'string' ? payload.id : ''
    const folderId = typeof payload.folderId === 'string' ? payload.folderId : ''
    if (itemId && excludedItemIds.has(itemId)) return false
    if (folderId && excludedFolderIds.has(folderId)) return false
    return payload.excludeFromCloudSync !== true
  }

  if (entry.kind === 'folderTreeSnapshot') {
    const payload = (entry.payload && typeof entry.payload === 'object' ? entry.payload : null) as Record<string, unknown> | null
    if (!payload) return false
    const entryFolders = Array.isArray(payload.folders) ? payload.folders : []
    const entryItems = Array.isArray(payload.items) ? payload.items : []
    const entryStorageItems = Array.isArray(payload.storageItems) ? payload.storageItems : []

    for (const folder of entryFolders) {
      const source = (folder && typeof folder === 'object' ? folder : null) as Record<string, unknown> | null
      if (!source) return false
      const folderId = typeof source.id === 'string' ? source.id : ''
      if (source.excludeFromCloudSync === true) return false
      if (folderId && excludedFolderIds.has(folderId)) return false
    }

    for (const item of entryItems) {
      const source = (item && typeof item === 'object' ? item : null) as Record<string, unknown> | null
      if (!source) return false
      const itemId = typeof source.id === 'string' ? source.id : ''
      const folderId = typeof source.folderId === 'string' ? source.folderId : ''
      if (source.excludeFromCloudSync === true) return false
      if (itemId && excludedItemIds.has(itemId)) return false
      if (folderId && excludedFolderIds.has(folderId)) return false
    }
    for (const item of entryStorageItems) {
      const source = (item && typeof item === 'object' ? item : null) as Record<string, unknown> | null
      if (!source) return false
      const itemId = typeof source.id === 'string' ? source.id : ''
      const folderId = typeof source.folderId === 'string' ? source.folderId : ''
      if (source.excludeFromCloudSync === true) return false
      if (itemId && excludedStorageItemIds.has(itemId)) return false
      if (folderId && excludedFolderIds.has(folderId)) return false
    }
    return true
  }

  if (entry.kind === 'storageItemSnapshot') {
    const payload = (entry.payload && typeof entry.payload === 'object' ? entry.payload : null) as Record<string, unknown> | null
    if (!payload) return false
    const itemId = typeof payload.id === 'string' ? payload.id : ''
    const folderId = typeof payload.folderId === 'string' ? payload.folderId : ''
    if (itemId && excludedStorageItemIds.has(itemId)) return false
    if (folderId && excludedFolderIds.has(folderId)) return false
    return payload.excludeFromCloudSync !== true
  }

  return false
}

type CloudPayloadProjection = {
  payload: VaultPayload
  excludedItemIds: Set<string>
  excludedStorageItemIds: Set<string>
  excludedFolderIds: Set<string>
  hasLocalOnlyContent: boolean
}

function projectPayloadForCloudSync(payload: VaultPayload): CloudPayloadProjection {
  const excludedFolderIds = collectCloudExcludedFolderIds(payload.folders)
  const cloudFolders = payload.folders.filter((folder) => !excludedFolderIds.has(folder.id))

  const excludedItemIds = new Set<string>()
  const excludedStorageItemIds = new Set<string>()
  const cloudItems: VaultItem[] = []
  for (const item of payload.items) {
    const excludedByFolder = Boolean(item.folderId && excludedFolderIds.has(item.folderId))
    const excluded = item.excludeFromCloudSync === true || excludedByFolder
    if (excluded) {
      excludedItemIds.add(item.id)
      continue
    }
    cloudItems.push(item)
  }

  const cloudStorageItems: VaultStorageItem[] = []
  for (const item of payload.storageItems) {
    const excludedByFolder = Boolean(item.folderId && excludedFolderIds.has(item.folderId))
    const excluded = item.excludeFromCloudSync === true || excludedByFolder
    if (excluded) {
      excludedStorageItemIds.add(item.id)
      continue
    }
    cloudStorageItems.push(item)
  }

  const cloudTrash = payload.trash.filter((entry) => isTrashEntryCloudSyncable(
    entry,
    excludedItemIds,
    excludedStorageItemIds,
    excludedFolderIds,
  ))
  const hasLocalOnlyContent = excludedFolderIds.size > 0
    || excludedItemIds.size > 0
    || excludedStorageItemIds.size > 0
    || cloudTrash.length !== payload.trash.length

  return {
    payload: {
      schemaVersion: payload.schemaVersion,
      items: cloudItems,
      storageItems: cloudStorageItems,
      folders: cloudFolders,
      trash: cloudTrash,
      settings: payload.settings,
    },
    excludedItemIds,
    excludedStorageItemIds,
    excludedFolderIds,
    hasLocalOnlyContent,
  }
}

function mergeById<T extends { id: string }>(primary: T[], secondary: T[]) {
  const merged = new Map<string, T>()
  for (const row of primary) {
    merged.set(row.id, row)
  }
  for (const row of secondary) {
    merged.set(row.id, row)
  }
  return Array.from(merged.values())
}

function mergeRemotePayloadWithLocalOnly(remotePayload: VaultPayload, localPayload: VaultPayload): VaultPayload {
  const remoteProjection = projectPayloadForCloudSync(remotePayload)
  const localProjection = projectPayloadForCloudSync(localPayload)

  const localOnlyFolders = localPayload.folders.filter((folder) => localProjection.excludedFolderIds.has(folder.id))
  const localOnlyItems = localPayload.items.filter((item) => localProjection.excludedItemIds.has(item.id))
  const localOnlyStorageItems = localPayload.storageItems.filter((item) => localProjection.excludedStorageItemIds.has(item.id))
  const localOnlyTrash = localPayload.trash.filter((entry) => !isTrashEntryCloudSyncable(
    entry,
    localProjection.excludedItemIds,
    localProjection.excludedStorageItemIds,
    localProjection.excludedFolderIds,
  ))

  const remoteFolders = remoteProjection.payload.folders.filter((folder) => !localProjection.excludedFolderIds.has(folder.id))
  const remoteItems = remoteProjection.payload.items.filter((item) => (
    !localProjection.excludedItemIds.has(item.id)
    && !(item.folderId && localProjection.excludedFolderIds.has(item.folderId))
  ))
  const remoteStorageItems = remoteProjection.payload.storageItems.filter((item) => (
    !localProjection.excludedStorageItemIds.has(item.id)
    && !(item.folderId && localProjection.excludedFolderIds.has(item.folderId))
  ))
  const remoteTrash = remoteProjection.payload.trash.filter((entry) => isTrashEntryCloudSyncable(
    entry,
    localProjection.excludedItemIds,
    localProjection.excludedStorageItemIds,
    localProjection.excludedFolderIds,
  ))

  return {
    schemaVersion: remoteProjection.payload.schemaVersion,
    items: mergeById(remoteItems, localOnlyItems),
    storageItems: mergeById(remoteStorageItems, localOnlyStorageItems),
    folders: mergeById(remoteFolders, localOnlyFolders),
    trash: mergeById(remoteTrash, localOnlyTrash),
    settings: remoteProjection.payload.settings,
  }
}

async function buildSessionFileWithPayload(session: VaultSession, payload: VaultPayload): Promise<ArmadilloVaultFile> {
  const vaultData = await encryptJsonWithKey(session.vaultKey, payload)
  return {
    ...session.file,
    vaultData,
  }
}

async function buildCloudPushFile(session: VaultSession): Promise<ArmadilloVaultFile> {
  const projection = projectPayloadForCloudSync(session.payload)
  if (!projection.hasLocalOnlyContent) {
    return session.file
  }
  return buildSessionFileWithPayload(session, projection.payload)
}

function purgeExpiredTrash(entries: VaultTrashEntry[]) {
  const now = Date.now()
  return entries.filter((entry) => {
    const parsed = Date.parse(entry.purgeAt)
    if (!Number.isFinite(parsed)) return true
    return parsed > now
  })
}

function getSafeRetentionDays(value: number) {
  if (!Number.isFinite(value)) return 30
  return Math.min(3650, Math.max(1, Math.round(value)))
}

type ExpiryAlert = {
  itemId: string
  title: string
  status: 'expired' | 'expiring'
}

type TreeContextMenuState = { x: number; y: number } | null

function computeExpiryAlerts(items: VaultItem[]): ExpiryAlert[] {
  const now = new Date()
  const alerts: ExpiryAlert[] = []
  for (const item of items) {
    const status = getPasswordExpiryStatus(item.passwordExpiryDate, { now, expiringWithinDays: PASSWORD_EXPIRING_SOON_DAYS })
    if (status === 'expired') {
      alerts.push({ itemId: item.id, title: item.title, status: 'expired' })
    } else if (status === 'expiring') {
      alerts.push({ itemId: item.id, title: item.title, status: 'expiring' })
    }
  }
  return alerts
}

function itemMatchesQuery(item: VaultItem, queryLower: string) {
  return (
    item.title.toLowerCase().includes(queryLower) ||
    item.username.toLowerCase().includes(queryLower) ||
    item.urls.some((url) => url.toLowerCase().includes(queryLower)) ||
    item.folder.toLowerCase().includes(queryLower) ||
    item.tags.some((tag) => tag.toLowerCase().includes(queryLower))
  )
}

function storageItemMatchesQuery(item: VaultStorageItem, queryLower: string) {
  return (
    item.title.toLowerCase().includes(queryLower)
    || item.folder.toLowerCase().includes(queryLower)
    || item.tags.some((tag) => tag.toLowerCase().includes(queryLower))
    || item.note.toLowerCase().includes(queryLower)
    || (item.textValue || '').toLowerCase().includes(queryLower)
    || item.kind.toLowerCase().includes(queryLower)
    || (item.blobRef?.fileName || '').toLowerCase().includes(queryLower)
  )
}

function inferImportedItemTitle(values: { title?: string; url?: string; username?: string }, rowNumber: number) {
  const title = values.title?.trim() ?? ''
  if (title) return title
  const url = values.url?.trim() ?? ''
  if (url) {
    try {
      const host = new URL(url).hostname.trim().replace(/^www\./i, '')
      if (host) return host
    } catch {
      // Keep fallback order if URL is not valid.
    }
  }
  const username = values.username?.trim() ?? ''
  if (username) return username
  return `Imported Credential ${rowNumber}`
}

function normalizeLinkedAndroidPackages(values: string[] | undefined) {
  if (!Array.isArray(values)) return []
  const deduped = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed || deduped.has(trimmed)) continue
    deduped.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

function normalizeHost(value: string | undefined | null) {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const host = new URL(withScheme).hostname.trim().toLowerCase()
    return host.replace(/^www\./, '')
  } catch {
    return trimmed.toLowerCase().replace(/^www\./, '')
  }
}

function hostMatches(candidateHost: string, targetHost: string) {
  if (!candidateHost || !targetHost) return false
  if (candidateHost === targetHost) return true
  return candidateHost.endsWith(`.${targetHost}`) || targetHost.endsWith(`.${candidateHost}`)
}

function buildCapturedCredentialTitle(capture: CapturedCredentialDTO, fallbackIndex: number) {
  const title = capture.title?.trim()
  if (title) return title
  const fromDomain = normalizeHost(capture.webDomain || capture.urls[0] || '')
  if (fromDomain) return fromDomain
  const username = capture.username.trim()
  if (username) return username
  return `Captured Credential ${fallbackIndex}`
}

function uniqueNonEmptyStrings(values: string[] | undefined) {
  if (!Array.isArray(values)) return []
  const deduped = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    deduped.add(trimmed)
  }
  return Array.from(deduped)
}

function normalizeAutoFolderMappings(mappings: VaultSettings['autoFolderCustomMappings']) {
  if (!Array.isArray(mappings)) return []
  const rows: Exclude<VaultSettings['autoFolderCustomMappings'], undefined> = []
  const deduped = new Set<string>()
  for (const mapping of mappings) {
    if (!mapping) continue
    if (mapping.matchType !== 'domain' && mapping.matchType !== 'titleToken' && mapping.matchType !== 'tag') continue
    const matchValue = mapping.matchValue.trim()
    const targetPath = normalizeAutoFolderPath(mapping.targetPath)
    if (!matchValue || !targetPath) continue
    const key = `${mapping.matchType}:${matchValue.toLowerCase()}=>${targetPath.toLowerCase()}`
    if (deduped.has(key)) continue
    deduped.add(key)
    rows.push({
      id: mapping.id || crypto.randomUUID(),
      matchType: mapping.matchType,
      matchValue,
      targetPath,
    })
  }
  return rows
}

function normalizeAutoFolderSettings(settings: VaultSettings): VaultSettings {
  const normalizedTheme = normalizeThemeSettings(settings.theme)
  return {
    ...settings,
    autoFolderExcludedItemIds: uniqueNonEmptyStrings(settings.autoFolderExcludedItemIds),
    autoFolderLockedFolderPaths: uniqueNonEmptyStrings(settings.autoFolderLockedFolderPaths).map((path) => normalizeAutoFolderPath(path)).filter(Boolean),
    autoFolderCustomMappings: normalizeAutoFolderMappings(settings.autoFolderCustomMappings),
    theme: normalizedTheme,
  }
}

function hasUnlockableVault(mode: VaultStorageMode) {
  if (mode === 'cloud_only') {
    return Boolean(loadCachedVaultSnapshot())
  }
  return Boolean(loadLocalVaultFile() || loadCachedVaultSnapshot())
}

function useSafeConvexAuth() {
  try {
    return useConvexAuth()
  } catch {
    return { isAuthenticated: false } as ReturnType<typeof useConvexAuth>
  }
}

function useSafeAuthActions() {
  try {
    return useAuthActions()
  } catch {
    return {
      signIn: async () => {
        throw new Error('Convex auth provider is not configured')
      },
      signOut: async () => {},
    } as unknown as ReturnType<typeof useAuthActions>
  }
}

function useSafeAuthToken() {
  try {
    return useAuthToken()
  } catch {
    return null
  }
}

export function useVaultApp() {
  const initialStorageMode = getVaultStorageMode()
  const hasExistingVault = hasUnlockableVault(initialStorageMode)
  const [phase, setPhase] = useState<AppPhase>(hasExistingVault ? 'unlock' : 'create')
  const [vaultSession, setVaultSession] = useState<VaultSession | null>(null)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [vaultError, setVaultError] = useState('')
  const [pendingVaultExists] = useState(hasExistingVault)

  const [items, setItems] = useState<VaultItem[]>([])
  const [storageItems, setStorageItems] = useState<VaultStorageItem[]>([])
  const [folders, setFolders] = useState<VaultFolder[]>([])
  const [trash, setTrash] = useState<VaultTrashEntry[]>([])
  const [themeSettings, setThemeSettings] = useState<VaultThemeSettings>(() => loadThemeSettingsFromMirror())
  const [themeSettingsDirty, setThemeSettingsDirty] = useState(false)
  const [vaultSettings, setVaultSettings] = useState<VaultSettings>({
    trashRetentionDays: 30,
    generatorPresets: [],
    autoFolderExcludedItemIds: [],
    autoFolderLockedFolderPaths: [],
    autoFolderCustomMappings: [],
    theme: defaultThemeSettings(),
  })
  const [query, setQuery] = useState('')
  const [homeSearchQuery, setHomeSearchQuery] = useState('')
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>('passwords')
  const [selectedId, setSelectedId] = useState('')
  const [selectedStorageId, setSelectedStorageId] = useState('')
  const [activePanel, setActivePanel] = useState<Panel>('details')
  const [mobileStep, setMobileStep] = useState<MobileStep>('home')
  const [syncState, setSyncState] = useState<SyncState>('local')
  const [syncMessage, setSyncMessage] = useState('Offline mode')
  const [isSaving, setIsSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategoryId>('general')
  const [selectedNode, setSelectedNode] = useState<SidebarNode>('home')
  const [folderFilterMode, setFolderFilterMode] = useState<FolderFilterMode>('direct')
  const [storageMode, setStorageMode] = useState<VaultStorageMode>(initialStorageMode)
  const [cloudCacheTtlHours, setCloudCacheTtlHours] = useState(() => getCloudCacheTtlHours())
  const [cloudCacheExpiresAt, setCloudCacheExpiresAt] = useState(() => getCachedVaultExpiresAt())
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(localStorage.getItem(CLOUD_SYNC_PREF_KEY) === 'true')
  const [entitlementState, setEntitlementState] = useState<EntitlementState>(() => defaultEntitlementState())
  const [devFlagOverrideState, setDevFlagOverrideState] = useState<DevFlagOverride | null>(() => getDevFlagOverride())
  const [entitlementStatusMessage, setEntitlementStatusMessage] = useState('Free plan active')
  const [biometricEnabled, setBiometricEnabled] = useState(() => biometricEnrollmentExists())
  const [authMessage, setAuthMessage] = useState('')
  const [cloudAuthState, setCloudAuthState] = useState<CloudAuthState>('unknown')
  const [cloudIdentity, setCloudIdentity] = useState('')
  const [isOrgMember, setIsOrgMember] = useState(false)
  const [localVaultPath, setLocalVaultPath] = useState(() => (initialStorageMode === 'cloud_only' ? '' : getLocalVaultPath()))
  const [cloudVaultSnapshot, setCloudVaultSnapshot] = useState<ArmadilloVaultFile | null>(null)
  const [cloudVaultCandidates, setCloudVaultCandidates] = useState<ArmadilloVaultFile[]>([])
  const [showAllCloudSnapshots, setShowAllCloudSnapshots] = useState(false)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [contextMenu, setContextMenu] = useState<FolderContextMenuState>(null)
  const [itemContextMenu, setItemContextMenu] = useState<ItemContextMenuState>(null)
  const [storageContextMenu, setStorageContextMenu] = useState<StorageContextMenuState>(null)
  const [folderEditor, setFolderEditor] = useState<VaultFolder | null>(null)
  const [folderEditorOpen, setFolderEditorOpen] = useState(false)
  const [folderInlineEditor, setFolderInlineEditor] = useState<FolderInlineEditorState | null>(null)
  const [newFolderValue, setNewFolderValue] = useState('')
  const [newStorageFolderValue, setNewStorageFolderValue] = useState('')

  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState>(null)
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([])
  const [expiryAlertsDismissed, setExpiryAlertsDismissed] = useState(false)
  const [autoFolderPreview, setAutoFolderPreview] = useState<AutoFolderPlan | null>(null)
  const [autoFolderPreviewDraft, setAutoFolderPreviewDraft] = useState<AutoFolderPlan | null>(null)
  const [showAutoFolderPreview, setShowAutoFolderPreview] = useState(false)
  const [autoFolderBusy, setAutoFolderBusy] = useState(false)
  const [autoFolderError, setAutoFolderError] = useState('')
  const [autoFolderPreferencesDirty, setAutoFolderPreferencesDirty] = useState(false)
  const [autoFolderWarnings, setAutoFolderWarnings] = useState<string[]>([])
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult>(() => defaultUpdateCheckResult(APP_BUILD_INFO))
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  const [draft, setDraft] = useState<VaultItem | null>(null)
  const [storageDraft, setStorageDraft] = useState<VaultStorageItem | null>(null)
  const [storageFileBusy, setStorageFileBusy] = useState(false)
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
  const backupImportInputRef = useRef<HTMLInputElement | null>(null)
  const googlePasswordImportInputRef = useRef<HTMLInputElement | null>(null)
  const keepassImportInputRef = useRef<HTMLInputElement | null>(null)
  const folderLongPressTimerRef = useRef<number | null>(null)
  const previousCloudAuthStateRef = useRef<CloudAuthState>('unknown')
  const cloudRefreshInFlightRef = useRef(false)
  const autofillCaptureImportInFlightRef = useRef(false)
  const nativeAutofillSyncRetryTimerRef = useRef<number | null>(null)
  const consumeCapturedAutofillCredentialsRef = useRef<() => Promise<void>>(async () => {})
  const appliedThemeOverrideKeysRef = useRef<string[]>([])
  const riskBackfillRunIdRef = useRef(0)
  const { isAuthenticated } = useSafeConvexAuth()
  const { signIn, signOut } = useSafeAuthActions()
  const authToken = useSafeAuthToken()
  const resolvedFlags = useMemo(
    () => resolveFlags({
      entitlement: entitlementState,
      devOverride: devFlagOverrideState,
      allowDevOverride: import.meta.env.DEV,
    }),
    [entitlementState, devFlagOverrideState],
  )
  const effectiveTier = resolvedFlags.effectiveTier
  const effectiveCapabilities = resolvedFlags.effectiveCapabilities
  const effectiveFlags = resolvedFlags.effectiveFlags
  const capabilityLockReasons = resolvedFlags.lockReasons
  const hasCapability = useCallback((capability: CapabilityKey) => effectiveCapabilities.includes(capability), [effectiveCapabilities])
  const isFlagEnabled = useCallback((flag: string) => Boolean(effectiveFlags[flag]), [effectiveFlags])
  const cloudConnected = cloudAuthState === 'connected'
  const authStatus = useMemo(() => {
    if (!syncConfigured()) {
      return syncProvider === 'self_hosted' ? 'Self-hosted sync URL not configured' : 'Convex URL not configured'
    }
    if (cloudConnected) return cloudIdentity ? `Connected as ${cloudIdentity}` : 'Google account connected'
    if (cloudAuthState === 'checking') {
      return syncProvider === 'self_hosted'
        ? 'Checking self-hosted sync authentication...'
        : 'Google sign-in detected. Verifying cloud session...'
    }
    if (isAuthenticated && !authToken) return 'Google authenticated, token pending'
    if (cloudAuthState === 'error') return 'Cloud auth check failed. Local vault is still available.'
    return syncProvider === 'self_hosted' ? 'Self-hosted sync is not authenticated' : 'Google account not connected'
  }, [cloudConnected, cloudIdentity, cloudAuthState, isAuthenticated, authToken])
  const vaultTitle = useMemo(() => {
    if (storageMode === 'cloud_only') {
      return 'cloud-vault'
    }
    const rawPath = localVaultPath?.trim()
    if (!rawPath) {
      return 'vault.armadillo'
    }
    const parts = rawPath.split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] || 'vault.armadillo'
  }, [localVaultPath, storageMode])

  const completeGoogleSignInFromCallback = useCallback(async (callbackUrl: string, source: 'desktop' | 'android') => {
    try {
      const url = new URL(callbackUrl)
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      if (error) {
        setAuthMessage(`Google callback error: ${errorDescription || error}`)
        return
      }

      if (!code) {
        setAuthMessage('Google callback missing code')
        return
      }

      setAuthMessage(`OAuth callback received from ${source}. Finalizing session...`)
      await (signIn as unknown as (provider: string | undefined, params: { code: string; state?: string }) => Promise<unknown>)(undefined, {
        code,
        ...(state ? { state } : {}),
      })
      setAuthMessage('Google sign-in complete. Verifying session...')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setAuthMessage(`${source === 'android' ? 'Android' : 'Desktop'} browser callback failed: ${detail}`)
    }
  }, [signIn])

  const startAndroidGoogleSignIn = useCallback(async () => {
    if (!convexUrl) {
      setAuthMessage('Convex URL is not configured for mobile sign-in')
      return
    }

    const verifierKey = `${OAUTH_VERIFIER_STORAGE_KEY}_${convexAuthStorageNamespace()}`
    const previousVerifier = localStorage.getItem(verifierKey) ?? undefined
    localStorage.removeItem(verifierKey)

    try {
      const authClient = new ConvexHttpClient(convexUrl)
      const result = await authClient.action(
        'auth:signIn' as never,
        {
          provider: 'google',
          params: { redirectTo: ANDROID_OAUTH_REDIRECT_URL },
          verifier: previousVerifier,
        } as never,
      ) as { redirect?: string; verifier?: string }

      if (!result.redirect || !result.verifier) {
        setAuthMessage('Google sign-in failed to produce a redirect URL')
        return
      }

      localStorage.setItem(verifierKey, result.verifier)
      await Browser.open({ url: result.redirect })
      setAuthMessage('Google sign-in opened in browser. Return to Armadillo after approval.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setAuthMessage(`Android Google sign-in failed: ${detail}`)
    }
  }, [])

  function applySession(session: VaultSession, options: ApplySessionOptions = {}) {
    const { resetNavigation = false } = options
    setVaultSession(session)
    setItems(session.payload.items)
    setStorageItems(session.payload.storageItems)
    setFolders(session.payload.folders)
    setTrash(purgeExpiredTrash(session.payload.trash))
    const settings = normalizeAutoFolderSettings({
      ...session.payload.settings,
      trashRetentionDays: getSafeRetentionDays(session.payload.settings.trashRetentionDays),
      generatorPresets: session.payload.settings.generatorPresets ?? [],
    })
    setVaultSettings(settings)
    const nextThemeSettings = normalizeThemeSettings(settings.theme)
    setThemeSettings(nextThemeSettings)
    setThemeSettingsDirty(false)
    saveThemeSettingsToMirror(nextThemeSettings)
    setAutoFolderPreview(null)
    setAutoFolderPreviewDraft(null)
    setShowAutoFolderPreview(false)
    setAutoFolderPreferencesDirty(false)
    setAutoFolderWarnings([])
    const alerts = computeExpiryAlerts(session.payload.items)
    setExpiryAlerts(alerts)
    setExpiryAlertsDismissed(false)
    scheduleExpiryNotifications(alerts)
    const firstId = session.payload.items[0]?.id || ''
    const firstStorageId = session.payload.storageItems[0]?.id || ''
    const currentSelectedIdStillExists = session.payload.items.some((item) => item.id === selectedId)
    const currentSelectedStorageStillExists = session.payload.storageItems.some((item) => item.id === selectedStorageId)
    const nextSelectedId = resetNavigation
      ? firstId
      : (currentSelectedIdStillExists ? selectedId : firstId)
    const nextSelectedStorageId = resetNavigation
      ? firstStorageId
      : (currentSelectedStorageStillExists ? selectedStorageId : firstStorageId)
    setSelectedId(nextSelectedId)
    setDraft(session.payload.items.find((item) => item.id === nextSelectedId) ?? null)
    setSelectedStorageId(nextSelectedStorageId)
    setStorageDraft(session.payload.storageItems.find((item) => item.id === nextSelectedStorageId) ?? null)
    if (resetNavigation) {
      setWorkspaceSection('passwords')
      setSelectedNode('home')
      setFolderFilterMode('direct')
      setMobileStep('home')
      setHomeSearchQuery('')
    }
    syncCredentialsToNative(session.payload.items)
  }

  function syncCredentialsToNative(vaultItems: VaultItem[], attempt = 0) {
    if (!isNativeAndroid()) return
    if (nativeAutofillSyncRetryTimerRef.current !== null) {
      window.clearTimeout(nativeAutofillSyncRetryTimerRef.current)
      nativeAutofillSyncRetryTimerRef.current = null
    }
    const credentials = vaultItems.map((item) => ({
      id: item.id,
      title: item.title,
      username: item.username || '',
      password: item.passwordMasked || '',
      urls: item.urls,
      linkedAndroidPackages: normalizeLinkedAndroidPackages(item.linkedAndroidPackages),
    }))
    AutofillBridge.syncCredentials({ credentials })
      .then(() => {
        nativeAutofillSyncRetryTimerRef.current = null
      })
      .catch(() => {
        if (attempt >= 4) {
          nativeAutofillSyncRetryTimerRef.current = null
          return
        }
        const nextAttempt = attempt + 1
        nativeAutofillSyncRetryTimerRef.current = window.setTimeout(() => {
          syncCredentialsToNative(vaultItems, nextAttempt)
        }, 400 * nextAttempt)
      })
  }

  function clearNativeCredentials() {
    if (!isNativeAndroid()) return
    if (nativeAutofillSyncRetryTimerRef.current !== null) {
      window.clearTimeout(nativeAutofillSyncRetryTimerRef.current)
      nativeAutofillSyncRetryTimerRef.current = null
    }
    AutofillBridge.clearCredentials().catch(() => {
      /* non-blocking */
    })
  }

  const consumeCapturedAutofillCredentials = useCallback(async () => {
    if (!isNativeAndroid() || phase !== 'ready' || !vaultSession) {
      return
    }
    if (autofillCaptureImportInFlightRef.current) {
      return
    }

    autofillCaptureImportInFlightRef.current = true
    try {
      const result = await AutofillBridge.consumeCapturedCredentials()
      const captures = Array.isArray(result?.captures) ? result.captures : []
      if (captures.length === 0) {
        return
      }

      const now = new Date().toLocaleString()
      let createdCount = 0
      let updatedCount = 0
      let fallbackIndex = 1
      const nextItems = [...items]

      for (const capture of captures) {
        const username = capture.username?.trim() || ''
        const password = capture.password?.trim() || ''
        if (!username || !password) continue

        const packageName = (capture.packageName || '').trim().toLowerCase()
        const packageSet = new Set(normalizeLinkedAndroidPackages(capture.linkedAndroidPackages))
        if (packageName) packageSet.add(packageName)
        const capturePackages = Array.from(packageSet)
        const captureHosts = new Set<string>()
        for (const url of capture.urls ?? []) {
          const host = normalizeHost(url)
          if (host) captureHosts.add(host)
        }
        const webDomainHost = normalizeHost(capture.webDomain)
        if (webDomainHost) captureHosts.add(webDomainHost)

        const matchedIndex = nextItems.findIndex((item) => {
          const itemUsername = (item.username || '').trim().toLowerCase()
          if (itemUsername !== username.toLowerCase()) return false

          const itemPackages = normalizeLinkedAndroidPackages(item.linkedAndroidPackages)
          if (packageName && itemPackages.includes(packageName)) return true

          const itemHosts = item.urls.map((url) => normalizeHost(url)).filter(Boolean)
          for (const captureHost of captureHosts) {
            if (itemHosts.some((itemHost) => hostMatches(itemHost, captureHost))) {
              return true
            }
          }
          return false
        })

        if (matchedIndex >= 0) {
          const current = nextItems[matchedIndex]
          const mergedUrls = Array.from(new Set([
            ...current.urls.map((url) => url.trim()).filter(Boolean),
            ...(capture.urls ?? []).map((url) => url.trim()).filter(Boolean),
            ...(webDomainHost ? [`https://${webDomainHost}`] : []),
          ]))
          const mergedPackages = Array.from(new Set([
            ...normalizeLinkedAndroidPackages(current.linkedAndroidPackages),
            ...capturePackages,
          ]))

          nextItems[matchedIndex] = {
            ...current,
            username,
            passwordMasked: password,
            urls: mergedUrls,
            linkedAndroidPackages: mergedPackages,
            updatedAt: now,
          }
          updatedCount += 1
          continue
        }

        const fallbackTitle = buildCapturedCredentialTitle(capture, fallbackIndex)
        fallbackIndex += 1
        const created: VaultItem = {
          id: crypto.randomUUID(),
          title: fallbackTitle,
          username,
          passwordMasked: password,
          urls: Array.from(new Set([
            ...(capture.urls ?? []).map((url) => url.trim()).filter(Boolean),
            ...(webDomainHost ? [`https://${webDomainHost}`] : []),
          ])),
          linkedAndroidPackages: capturePackages,
          folder: '',
          folderId: null,
          tags: ['captured', 'android-autofill'],
          risk: 'safe',
          updatedAt: now,
          note: '',
          securityQuestions: [],
          passwordExpiryDate: null,
          excludeFromCloudSync: false,
        }
        nextItems.unshift(created)
        createdCount += 1
      }

      if (createdCount === 0 && updatedCount === 0) {
        return
      }

      const scoredItems = applyComputedItemRisks(nextItems)
      await persistPayload({ items: scoredItems })
      if (createdCount > 0 && updatedCount > 0) {
        setSyncMessage(`Imported ${createdCount} new and updated ${updatedCount} captured login(s) from Android autofill`)
      } else if (createdCount > 0) {
        setSyncMessage(`Imported ${createdCount} captured login(s) from Android autofill`)
      } else {
        setSyncMessage(`Updated ${updatedCount} login(s) from Android autofill captures`)
      }
    } catch {
      // Ignore consume/import failures; autofill fill should continue functioning.
    } finally {
      autofillCaptureImportInFlightRef.current = false
    }
  }, [items, persistPayload, phase, vaultSession])
  consumeCapturedAutofillCredentialsRef.current = consumeCapturedAutofillCredentials

  const persistVaultSnapshot = useCallback((file: ArmadilloVaultFile) => {
    saveCachedVaultSnapshot(file, cloudCacheTtlHours)
    setCloudCacheExpiresAt(getCachedVaultExpiresAt())

    if (storageMode === 'cloud_only') {
      clearLocalVaultFile()
      setLocalVaultPath('')
      return
    }

    saveLocalVaultFile(file)
    setLocalVaultPath(getLocalVaultPath())
  }, [cloudCacheTtlHours, storageMode])

  const getUnlockSourceFile = useCallback(() => {
    if (storageMode === 'cloud_only') {
      return loadCachedVaultSnapshot()
    }
    return loadLocalVaultFile() || loadCachedVaultSnapshot()
  }, [storageMode])

  const buildEntitlementStateFromToken = useCallback(async (
    token: string,
    source: EntitlementState['source'],
    lastRefreshAt: string | null,
  ): Promise<EntitlementState> => {
    const verified = await verifyEntitlementJwt(token)
    const staleAt = getEntitlementStaleAt(lastRefreshAt)
    if (!verified.ok) {
      return {
        ...defaultEntitlementState(verified.reason),
        source,
        status: verified.code === 'expired' ? 'expired' : 'invalid',
        lastRefreshAt,
        staleAt,
      }
    }

    const expiresAt = new Date(verified.claims.exp * 1000).toISOString()
    const stale = isEntitlementStale(lastRefreshAt)
    return {
      source,
      status: stale ? 'stale' : 'verified',
      tier: verified.claims.tier,
      capabilities: verified.claims.capabilities ?? [],
      flags: verified.claims.flags ?? {},
      expiresAt,
      lastRefreshAt,
      staleAt,
      reason: stale ? 'Entitlement is stale. Reconnect to refresh your plan.' : `${verified.claims.tier} entitlement verified`,
      issuer: verified.claims.iss,
      subject: verified.claims.sub,
      kid: verified.header.kid,
    }
  }, [])

  const refreshEntitlements = useCallback(async () => {
    const nowIso = new Date().toISOString()
    const manualToken = getManualEntitlementToken()
    if (manualToken) {
      const lastRefreshAt = getEntitlementLastRefreshAt() || nowIso
      if (!getEntitlementLastRefreshAt()) {
        setEntitlementLastRefreshAt(nowIso)
      }
      const manualState = await buildEntitlementStateFromToken(manualToken, 'manual', lastRefreshAt)
      setEntitlementState(manualState)
      setEntitlementStatusMessage(manualState.reason)
      return
    }

    let cacheToken = getCachedEntitlementToken()
    let cacheSource: EntitlementState['source'] = 'cache'
    let lastRefreshAt = getEntitlementLastRefreshAt()

    try {
      const remote = await fetchEntitlementToken()
      const remoteToken = typeof remote?.token === 'string' ? remote.token.trim() : ''
      if (remoteToken) {
        const fetchedAt = toIsoOrNull(remote?.fetchedAt) || nowIso
        setCachedEntitlementToken(remoteToken)
        setEntitlementLastRefreshAt(fetchedAt)
        cacheToken = remoteToken
        cacheSource = 'remote'
        lastRefreshAt = fetchedAt
      } else if (remote && !remote.ok && remote.reason) {
        setEntitlementStatusMessage(remote.reason)
      }
    } catch {
      // Keep local cache fallback when provider fetch fails.
    }

    if (!cacheToken) {
      const freeState = defaultEntitlementState('Free plan active')
      setEntitlementState(freeState)
      setEntitlementStatusMessage(freeState.reason)
      return
    }

    const cachedState = await buildEntitlementStateFromToken(cacheToken, cacheSource, lastRefreshAt)
    setEntitlementState(cachedState)
    setEntitlementStatusMessage(cachedState.reason)
  }, [buildEntitlementStateFromToken])

  const applyManualEntitlementToken = useCallback(async (tokenRaw: string) => {
    const token = tokenRaw.trim()
    if (!token) {
      setSyncMessage('Signed entitlement token is required')
      return false
    }
    const nowIso = new Date().toISOString()
    const nextState = await buildEntitlementStateFromToken(token, 'manual', nowIso)
    if (nextState.status === 'verified') {
      setManualEntitlementToken(token)
      setEntitlementLastRefreshAt(nowIso)
    } else {
      setManualEntitlementToken(null)
    }
    setEntitlementState(nextState)
    setEntitlementStatusMessage(nextState.reason)
    setSyncMessage(nextState.status === 'verified' ? 'Signed entitlement applied' : `Entitlement rejected: ${nextState.reason}`)
    return nextState.status === 'verified'
  }, [buildEntitlementStateFromToken])

  const clearManualEntitlementTokenAction = useCallback(() => {
    setManualEntitlementToken(null)
    void refreshEntitlements()
    setSyncMessage('Manual entitlement token cleared')
  }, [refreshEntitlements])

  const applyDevFlagOverrides = useCallback((override: DevFlagOverride | null) => {
    if (!import.meta.env.DEV) return
    setDevFlagOverride(override)
    setDevFlagOverrideState(getDevFlagOverride())
    setSyncMessage(override ? 'Dev flag override applied' : 'Dev flag override cleared')
  }, [])

  const clearDevFlagOverrides = useCallback(() => {
    if (!import.meta.env.DEV) return
    clearDevFlagOverride()
    setDevFlagOverrideState(null)
    setSyncMessage('Dev flag overrides cleared')
  }, [])

  function ensureCapability(capability: CapabilityKey) {
    if (hasCapability(capability)) return true
    setSyncMessage(capabilityLockReasons[capability] ?? 'Feature is locked')
    return false
  }

  function updateCloudSyncEnabled(value: boolean | ((value: boolean) => boolean)) {
    const nextValue = typeof value === 'function' ? value(cloudSyncEnabled) : value
    if (nextValue && !ensureCapability('cloud.sync')) {
      return
    }
    if (nextValue && syncProvider === 'self_hosted' && !ensureCapability('enterprise.self_hosted')) {
      return
    }
    if (storageMode === 'cloud_only' && !nextValue) {
      setSyncMessage('Cloud-only mode requires cloud sync to stay enabled')
      return
    }
    setCloudSyncEnabled(nextValue)
  }

  function updateStorageMode(nextMode: VaultStorageMode) {
    if (nextMode === storageMode) return

    if (nextMode === 'cloud_only') {
      if (!ensureCapability('cloud.cloud_only')) {
        return
      }
      if (syncProvider === 'self_hosted' && !ensureCapability('enterprise.self_hosted')) {
        return
      }
      if (!syncConfigured()) {
        setSyncMessage('Configure cloud sync before enabling cloud-only mode')
        return
      }
      const activeFile = vaultSession?.file || loadLocalVaultFile() || loadCachedVaultSnapshot(true)
      if (activeFile) {
        saveCachedVaultSnapshot(activeFile, cloudCacheTtlHours)
        setCloudCacheExpiresAt(getCachedVaultExpiresAt())
      }
      clearLocalVaultFile()
      setLocalVaultPath('')
      setCloudSyncEnabled(true)
      setSyncMessage('Cloud-only mode enabled. Local vault file removed from this device.')
    } else {
      const activeFile = vaultSession?.file || loadCachedVaultSnapshot(true)
      if (activeFile) {
        saveLocalVaultFile(activeFile)
        setSyncMessage('Local file mode enabled. Encrypted vault file restored locally.')
      } else {
        setSyncMessage('Local file mode enabled.')
      }
      setLocalVaultPath(getLocalVaultPath())
    }

    setStorageMode(nextMode)
    setStoredVaultStorageMode(nextMode)
  }

  function scheduleExpiryNotifications(alerts: ExpiryAlert[]) {
    if (!isNativeAndroid() || alerts.length === 0) return
    LocalNotifications.requestPermissions().then((perm) => {
      if (perm.display !== 'granted') return
      const notifications = alerts.slice(0, 10).map((alert, index) => ({
        title: alert.status === 'expired' ? 'Password Expired' : 'Password Expiring Soon',
        body: `${alert.title} — ${alert.status === 'expired' ? 'password has expired' : 'password is expiring within 7 days'}`,
        id: 9000 + index,
        schedule: { at: new Date(Date.now() + 2000) },
        smallIcon: 'ic_launcher',
        autoCancel: true,
      }))
      void LocalNotifications.schedule({ notifications })
    }).catch(() => { /* non-blocking */ })
  }

  useEffect(() => {
    localStorage.setItem(CLOUD_SYNC_PREF_KEY, String(cloudSyncEnabled))
  }, [cloudSyncEnabled])

  useEffect(() => {
    const persistedTheme = normalizeThemeSettings(vaultSettings.theme)
    setThemeSettingsDirty(!areThemeSettingsEqual(themeSettings, persistedTheme))
  }, [themeSettings, vaultSettings.theme])

  useEffect(() => {
    const normalizedTheme = normalizeThemeSettings(themeSettings)
    const root = document.documentElement
    root.setAttribute('data-theme', normalizedTheme.activeBaseThemeId)
    if (normalizedTheme.motionLevel === 'reduced') {
      root.setAttribute('data-motion', 'reduced')
    } else {
      root.removeAttribute('data-motion')
    }

    const baseTokens = BUILT_IN_THEME_PRESETS.find((preset) => preset.id === normalizedTheme.activeBaseThemeId)?.tokens ?? {}
    const resolvedTokens = resolveThemeTokens(normalizedTheme)
    const nextOverrideSet = new Set<string>()

    for (const [token, value] of Object.entries(resolvedTokens)) {
      if (baseTokens[token] === value) continue
      nextOverrideSet.add(token)
      root.style.setProperty(`--${token}`, value)
    }

    for (const token of appliedThemeOverrideKeysRef.current) {
      if (nextOverrideSet.has(token)) continue
      root.style.removeProperty(`--${token}`)
    }

    appliedThemeOverrideKeysRef.current = Array.from(nextOverrideSet)
  }, [themeSettings])

  useEffect(() => {
    return () => {
      if (nativeAutofillSyncRetryTimerRef.current !== null) {
        window.clearTimeout(nativeAutofillSyncRetryTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isNativeAndroid() || phase !== 'ready' || !vaultSession) {
      return
    }
    syncCredentialsToNative(items)
  }, [phase, vaultSession, items])

  useEffect(() => {
    setStoredCloudCacheTtlHours(cloudCacheTtlHours)
    const cached = loadCachedVaultSnapshot(true)
    if (!cached) return
    saveCachedVaultSnapshot(cached, cloudCacheTtlHours)
    setCloudCacheExpiresAt(getCachedVaultExpiresAt())
  }, [cloudCacheTtlHours])

  useEffect(() => {
    if (storageMode === 'cloud_only' && !cloudSyncEnabled) {
      setCloudSyncEnabled(true)
    }
  }, [storageMode, cloudSyncEnabled])

  useEffect(() => {
    void refreshEntitlements()
  }, [refreshEntitlements])

  useEffect(() => {
    if (phase !== 'ready') return
    void refreshEntitlements()
  }, [phase, refreshEntitlements])

  useEffect(() => {
    if (storageMode !== 'cloud_only' || hasCapability('cloud.cloud_only')) {
      return
    }
    const activeFile = vaultSession?.file || loadCachedVaultSnapshot(true)
    if (activeFile) {
      saveLocalVaultFile(activeFile)
      setLocalVaultPath(getLocalVaultPath())
    }
    setStorageMode('local_file')
    setStoredVaultStorageMode('local_file')
    setSyncMessage(capabilityLockReasons['cloud.cloud_only'] ?? 'Requires Premium plan')
  }, [storageMode, vaultSession, hasCapability, capabilityLockReasons])

  useEffect(() => {
    if (!cloudSyncEnabled || storageMode === 'cloud_only' || hasCapability('cloud.sync')) {
      return
    }
    setCloudSyncEnabled(false)
    setSyncMessage(capabilityLockReasons['cloud.sync'] ?? 'Requires Premium plan')
  }, [cloudSyncEnabled, storageMode, hasCapability, capabilityLockReasons])

  useEffect(() => {
    if (!cloudSyncEnabled || syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted')) {
      return
    }
    setCloudSyncEnabled(false)
    setSyncMessage(capabilityLockReasons['enterprise.self_hosted'] ?? 'Requires Enterprise plan')
  }, [cloudSyncEnabled, syncProvider, hasCapability, capabilityLockReasons])

  useEffect(() => {
    setSyncAuthToken(authToken ?? null)
    if (!authToken) {
      setSyncAuthContext(null)
    }
  }, [authToken])

  useEffect(() => {
    let cancelled = false

    async function refreshCloudIdentity() {
      if (!syncConfigured()) {
        setCloudAuthState('unknown')
        setCloudIdentity('')
        return
      }

      if (syncProvider === 'convex') {
        if (!isAuthenticated) {
          setCloudAuthState('disconnected')
          setCloudIdentity('')
          return
        }

        if (!authToken) {
          setCloudAuthState('checking')
          return
        }
      }

      setCloudAuthState('checking')
      try {
        const status = await getCloudAuthStatus()
        if (cancelled) return
        setSyncAuthContext(status?.authContext ?? null)
        setIsOrgMember(Boolean(status?.authContext?.orgId))

        if (status?.authenticated || syncProvider === 'self_hosted') {
          const identityLabel = status?.authenticated
            ? (status.email || status.name || status.subject || (syncProvider === 'convex' ? 'Google account' : 'Authenticated account'))
            : 'Anonymous owner'
          setCloudAuthState('connected')
          setCloudIdentity(identityLabel)
        } else {
          setCloudAuthState('disconnected')
          setCloudIdentity('')
        }
      } catch {
        if (cancelled) return
        setCloudAuthState('error')
        setCloudIdentity('')
      }
    }

    void refreshCloudIdentity()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, authToken])

  useEffect(() => {
    const previous = previousCloudAuthStateRef.current
    if (previous === cloudAuthState) {
      return
    }

    if (cloudAuthState === 'connected') {
      setAuthMessage(cloudIdentity ? `Cloud connected as ${cloudIdentity}` : 'Cloud account connected')
    } else if (cloudAuthState === 'disconnected' && (previous === 'connected' || previous === 'checking')) {
      setAuthMessage(syncProvider === 'self_hosted' ? 'No active self-hosted sync session' : 'No active Google cloud session')
    } else if (cloudAuthState === 'error') {
      setAuthMessage(syncProvider === 'self_hosted' ? 'Could not verify self-hosted sync session' : 'Could not verify Google cloud session')
    }

    previousCloudAuthStateRef.current = cloudAuthState
  }, [cloudAuthState, cloudIdentity])

  useEffect(() => {
    setShowAllCloudSnapshots(false)
  }, [phase, cloudVaultCandidates.length])

  // When the user signs in while on the create or unlock screen, check
  // the cloud for an existing vault so we can offer to restore it.
  useEffect(() => {
    if (phase === 'ready' || cloudAuthState !== 'connected') {
      setCloudVaultSnapshot(null)
      setCloudVaultCandidates([])
      return
    }
    if (!hasCapability('cloud.sync') || (syncProvider === 'self_hosted' && !hasCapability('enterprise.self_hosted'))) {
      setCloudVaultSnapshot(null)
      setCloudVaultCandidates([])
      return
    }

    let cancelled = false

    async function checkCloudVault() {
      if (syncProvider === 'convex' && !authToken) {
        setCloudVaultSnapshot(null)
        setCloudVaultCandidates([])
        setAuthMessage('Google session token pending. Retrying cloud check...')
        return
      }

      setSyncAuthToken(authToken ?? null)
      setAuthMessage('Checking cloud for existing vault...')
      try {
        const remote = await listRemoteVaultsByOwner()
        if (cancelled) return

        if (syncProvider === 'convex' && remote?.ownerSource === 'anonymous') {
          setCloudVaultSnapshot(null)
          setCloudVaultCandidates([])
          setAuthMessage('Cloud request resolved as anonymous owner. Sign out and sign in with Google again.')
          return
        }

        if ((remote?.snapshots?.length || 0) > 0) {
          const snapshots = remote?.snapshots || []
          const latest = snapshots[0]
          setCloudVaultSnapshot(latest)
          setCloudVaultCandidates(snapshots)

          // On the create screen (no local vault), auto-restore immediately
          if (phase === 'create') {
            persistVaultSnapshot(latest)
            setAuthMessage('Found your cloud vault! Enter your master password to unlock it.')
            setPhase('unlock')
          } else {
            setAuthMessage('Cloud vault found! You can load it below.')
          }
        } else {
          setCloudVaultSnapshot(null)
          setCloudVaultCandidates([])
          setAuthMessage('No cloud vault found for this account')
        }
      } catch (err) {
        console.error('[armadillo] cloud vault check failed:', err)
        const detail = err instanceof Error ? err.message : String(err)
        if (!cancelled) {
          setCloudVaultSnapshot(null)
          setCloudVaultCandidates([])
          setAuthMessage(`Cloud vault check failed: ${detail}`)
        }
      }
    }

    void checkCloudVault()
    return () => {
      cancelled = true
    }
  }, [phase, cloudAuthState, authToken, persistVaultSnapshot, hasCapability, syncProvider, capabilityLockReasons])

  useEffect(() => {
    const shell = window.armadilloShell
    if (!shell?.isElectron || !shell.onOAuthCallback) {
      return
    }

    const unsubscribe = shell.onOAuthCallback((url) => {
      void completeGoogleSignInFromCallback(url, 'desktop')
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [completeGoogleSignInFromCallback])

  useEffect(() => {
    if (!isNativeAndroid()) {
      return
    }

    let ignore = false
    const handleUrl = (url: string) => {
      if (!url || !url.startsWith('armadillo://')) return
      void completeGoogleSignInFromCallback(url, 'android')
      void Browser.close().catch(() => {})
    }

    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (ignore) return
      handleUrl(url)
    })

    void CapacitorApp.getLaunchUrl().then((launchData) => {
      if (ignore || !launchData?.url) return
      handleUrl(launchData.url)
    }).catch(() => {})

    return () => {
      ignore = true
      void listener.then((handle) => handle.remove())
    }
  }, [completeGoogleSignInFromCallback])

  useEffect(() => {
    if (!isNativeAndroid() || phase !== 'ready' || !vaultSession) {
      return
    }
    void consumeCapturedAutofillCredentialsRef.current()
  }, [phase, vaultSession])

  useEffect(() => {
    if (!isNativeAndroid()) {
      return
    }

    let ignore = false
    const listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (ignore || !isActive) return
      void consumeCapturedAutofillCredentialsRef.current()
    })

    return () => {
      ignore = true
      void listener.then((handle) => handle.remove())
    }
  }, [])

  useEffect(() => {
    function handlePointerDown() {
      setContextMenu(null)
      setItemContextMenu(null)
      setTreeContextMenu(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  useEffect(() => {
    const shell = window.armadilloShell
    if (!shell?.isElectron) {
      return
    }

    let cancelled = false
    if (shell.isWindowMaximized) {
      void shell.isWindowMaximized().then((maximized) => {
        if (!cancelled) {
          setWindowMaximized(Boolean(maximized))
        }
      }).catch(() => {})
    }

    const unsubscribe = shell.onWindowMaximizedChanged?.((maximized) => {
      setWindowMaximized(Boolean(maximized))
    })

    return () => {
      cancelled = true
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  async function minimizeDesktopWindow() {
    await window.armadilloShell?.minimizeWindow?.()
  }

  async function toggleMaximizeDesktopWindow() {
    const maximized = await window.armadilloShell?.toggleMaximizeWindow?.()
    if (typeof maximized === 'boolean') {
      setWindowMaximized(maximized)
    }
  }

  async function closeDesktopWindow() {
    await window.armadilloShell?.closeWindow?.()
  }

  async function copyToClipboard(text: string, successMessage: string, failureMessage: string) {
    try {
      await navigator.clipboard.writeText(text)
      setSyncMessage(successMessage)
    } catch {
      setSyncMessage(failureMessage)
    }
  }

  const refreshVaultFromCloud = useCallback(async (opts?: {
    silent?: boolean
    pushLocalWhenCurrent?: boolean
    requireAutoSync?: boolean
  }) => {
    const silent = opts?.silent ?? false
    const pushLocalWhenCurrent = opts?.pushLocalWhenCurrent ?? false
    const requireAutoSync = opts?.requireAutoSync ?? false

    if (!vaultSession) {
      if (!silent) {
        setSyncMessage('Unlock vault before refreshing cloud data')
      }
      return false
    }
    if (requireAutoSync && !cloudSyncEnabled) {
      if (!silent) {
        setSyncState('local')
        setSyncMessage('Offline mode')
      }
      return false
    }
    if (!hasCapability('cloud.sync')) {
      if (!silent) {
        setSyncState('local')
        setSyncMessage(capabilityLockReasons['cloud.sync'] ?? 'Requires Premium plan')
      }
      return false
    }
    if (syncProvider === 'self_hosted' && !hasCapability('enterprise.self_hosted')) {
      if (!silent) {
        setSyncState('local')
        setSyncMessage(capabilityLockReasons['enterprise.self_hosted'] ?? 'Requires Enterprise plan')
      }
      return false
    }
    if (!syncConfigured()) {
      if (!silent) {
        setSyncState('error')
        setSyncMessage(syncProvider === 'self_hosted' ? 'Self-hosted sync is not configured' : 'Convex is not configured')
      }
      return false
    }
    if (cloudRefreshInFlightRef.current) {
      if (!silent) {
        setSyncMessage('Cloud refresh already in progress')
      }
      return false
    }

    const activeSession = vaultSession
    cloudRefreshInFlightRef.current = true
    if (!silent) {
      setSyncState('syncing')
      setSyncMessage('Checking cloud for encrypted updates...')
    }

    try {
      const remote = await pullRemoteSnapshot(activeSession.file.vaultId)
      if (!remote) {
        if (!silent) {
          setSyncState('error')
          setSyncMessage(storageMode === 'cloud_only'
            ? 'Cloud sync unavailable; using encrypted cache until reconnect'
            : 'Cloud sync unavailable, local encrypted file remains canonical')
        }
        return false
      }

      const remoteSnapshot = remote.snapshot
      if (remoteSnapshot && remoteSnapshot.revision > activeSession.file.revision) {
        try {
          const remotePayload = await readPayloadWithSessionKey(activeSession, remoteSnapshot)
          const mergedPayload = mergeRemotePayloadWithLocalOnly(remotePayload, activeSession.payload)
          const mergedFile = await buildSessionFileWithPayload({
            ...activeSession,
            file: remoteSnapshot,
            payload: remotePayload,
          }, mergedPayload)
          const nextSession: VaultSession = {
            file: mergedFile,
            payload: mergedPayload,
            vaultKey: activeSession.vaultKey,
          }
          persistVaultSnapshot(nextSession.file)
          applySession(nextSession)
          setSyncState('live')
          setSyncMessage(`Pulled remote encrypted update (${remote.ownerSource})`)
          return true
        } catch {
          setSyncState('error')
          setSyncMessage('Remote save cannot be decrypted with current unlocked vault')
          return false
        }
      }

      if (pushLocalWhenCurrent) {
        const pushFile = await buildCloudPushFile(activeSession)
        const pushResult = await pushRemoteSnapshot(pushFile)
        if (pushResult?.ok) {
          setSyncState('live')
          if (!silent) {
            setSyncMessage(pushResult.accepted ? `Encrypted sync active (${pushResult.ownerSource})` : 'Cloud vault already up to date')
          }
          return false
        }
      }

      if (!silent) {
        setSyncState('live')
        setSyncMessage(remoteSnapshot ? `Cloud vault already up to date (${remote.ownerSource})` : 'Cloud vault is empty for this owner')
      }
      return false
    } catch (error) {
      console.error('[armadillo] cloud refresh failed:', error)
      if (!silent) {
        setSyncState('error')
        setSyncMessage(storageMode === 'cloud_only'
          ? 'Cloud refresh failed; cached encrypted vault remains available'
          : 'Cloud refresh failed; local encrypted file remains canonical')
      }
      return false
    } finally {
      cloudRefreshInFlightRef.current = false
    }
  }, [vaultSession, cloudSyncEnabled, storageMode, applySession, persistVaultSnapshot, hasCapability, capabilityLockReasons])

  async function refreshVaultFromCloudNow() {
    await refreshVaultFromCloud({ silent: false, pushLocalWhenCurrent: false, requireAutoSync: false })
  }

  useEffect(() => {
    if (!vaultSession || !cloudSyncEnabled) {
      if (!cloudSyncEnabled) {
        setSyncState('local')
        setSyncMessage('Offline mode')
      }
      return
    }

    void refreshVaultFromCloud({
      // Keep the auto-sync bootstrap quiet so topbar status doesn't flicker.
      silent: true,
      pushLocalWhenCurrent: true,
      requireAutoSync: true,
    })
  }, [vaultSession, cloudSyncEnabled, refreshVaultFromCloud])

  useEffect(() => {
    if (syncProvider !== 'self_hosted' || !vaultSession || !cloudSyncEnabled || !syncConfigured()) {
      return
    }

    const unsubscribe = subscribeToVaultUpdates(vaultSession.file.vaultId, {
      onEvent: (event) => {
        if (event.revision <= vaultSession.file.revision) {
          return
        }
        void refreshVaultFromCloud({
          silent: true,
          pushLocalWhenCurrent: false,
          requireAutoSync: true,
        })
      },
      onError: () => {
        // Keep polling fallback active; no extra UI churn here.
      },
    })

    return () => {
      unsubscribe()
    }
  }, [vaultSession, cloudSyncEnabled, refreshVaultFromCloud])

  useEffect(() => {
    if (!vaultSession || !cloudSyncEnabled || !syncConfigured()) {
      return
    }

    const autoPlatform = getAutoPlatform()
    const intervalMs = syncProvider === 'self_hosted'
      ? CLOUD_LIVE_REFRESH_INTERVAL_MS_SELF_HOSTED_FALLBACK
      : autoPlatform === 'desktop'
        ? CLOUD_LIVE_REFRESH_INTERVAL_MS_DESKTOP
        : autoPlatform === 'web'
          ? CLOUD_LIVE_REFRESH_INTERVAL_MS_WEB
          : CLOUD_LIVE_REFRESH_INTERVAL_MS_MOBILE

    const refreshSilently = () => {
      void refreshVaultFromCloud({
        silent: true,
        pushLocalWhenCurrent: false,
        requireAutoSync: true,
      })
    }

    const intervalId = window.setInterval(refreshSilently, intervalMs)
    const handleFocus = () => {
      refreshSilently()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshSilently()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [vaultSession, cloudSyncEnabled, refreshVaultFromCloud])

  const effectivePlatform = getAutoPlatform()
  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const folderPathById = useMemo(() => {
    const map = new Map<string, string>()
    for (const folder of folders) {
      map.set(folder.id, formatFolderPath(folder.id, folderMap))
    }
    return map
  }, [folders, folderMap])
  const expiredItems = useMemo(
    () => items.filter((item) => getPasswordExpiryStatus(item.passwordExpiryDate, { expiringWithinDays: PASSWORD_EXPIRING_SOON_DAYS }) === 'expired'),
    [items],
  )
  const expiringSoonItems = useMemo(
    () => items.filter((item) => getPasswordExpiryStatus(item.passwordExpiryDate, { expiringWithinDays: PASSWORD_EXPIRING_SOON_DAYS }) === 'expiring'),
    [items],
  )
  const homeRecentItems = useMemo(() => {
    const ranked = items
      .map((item, index) => ({ item, index, parsedUpdatedAt: Date.parse(item.updatedAt) }))
      .sort((a, b) => {
        const aValid = Number.isFinite(a.parsedUpdatedAt)
        const bValid = Number.isFinite(b.parsedUpdatedAt)
        if (aValid && bValid) {
          return b.parsedUpdatedAt - a.parsedUpdatedAt
        }
        if (aValid !== bValid) {
          return aValid ? -1 : 1
        }
        return a.index - b.index
      })
    return ranked.slice(0, HOME_RECENT_ITEMS_LIMIT).map((row) => row.item)
  }, [items])
  const homeSearchResults = useMemo(() => {
    const value = homeSearchQuery.trim().toLowerCase()
    if (!value) return []
    return items.filter((item) => itemMatchesQuery(item, value)).slice(0, HOME_SEARCH_RESULTS_LIMIT)
  }, [items, homeSearchQuery])

  const scopedItems = useMemo(() => {
    if (selectedNode === 'all') return items
    if (selectedNode === 'home') {
      return []
    }
    if (selectedNode === 'expiring') {
      return expiringSoonItems
    }
    if (selectedNode === 'expired') {
      return expiredItems
    }
    if (selectedNode === 'unfiled') {
      return items.filter((item) => !item.folderId)
    }
    if (selectedNode === 'trash') {
      return []
    }
    const folderId = selectedNode.slice('folder:'.length)
    if (!folderId) return items
    if (folderFilterMode === 'recursive') {
      const ids = new Set(collectDescendantIds(folderId, folders))
      return items.filter((item) => item.folderId && ids.has(item.folderId))
    }
    return items.filter((item) => item.folderId === folderId)
  }, [items, selectedNode, folderFilterMode, folders, expiringSoonItems, expiredItems])

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    const base = !value
      ? scopedItems
      : scopedItems.filter((item) => itemMatchesQuery(item, value))

    return base
  }, [scopedItems, query])

  const scopedStorageItems = useMemo(() => {
    if (selectedNode === 'home' || selectedNode === 'expiring' || selectedNode === 'expired' || selectedNode === 'trash') {
      return []
    }
    if (selectedNode === 'all') return storageItems
    if (selectedNode === 'unfiled') return storageItems.filter((item) => !item.folderId)
    const folderId = selectedNode.slice('folder:'.length)
    if (!folderId) return storageItems
    if (folderFilterMode === 'recursive') {
      const ids = new Set(collectDescendantIds(folderId, folders))
      return storageItems.filter((item) => item.folderId && ids.has(item.folderId))
    }
    return storageItems.filter((item) => item.folderId === folderId)
  }, [storageItems, selectedNode, folderFilterMode, folders])

  const filteredStorage = useMemo(() => {
    const value = query.trim().toLowerCase()
    const base = !value
      ? scopedStorageItems
      : scopedStorageItems.filter((item) => storageItemMatchesQuery(item, value))
    return base
  }, [scopedStorageItems, query])

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const selected = itemById.get(selectedId) ?? null
  const storageItemById = useMemo(() => new Map(storageItems.map((item) => [item.id, item])), [storageItems])
  const selectedStorage = storageItemById.get(selectedStorageId) ?? null

  const folderOptions = useMemo(() => {
    return folders
      .map((folder) => ({ id: folder.id, label: folderPathById.get(folder.id) ?? folder.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [folders, folderPathById])
  const storageFeatureEnabled = hasCapability('vault.storage') && isFlagEnabled('experiments.storage_tab')

  useEffect(() => {
    // Seed folder editor when the selected draft changes.
    // Do not keep syncing while the user is typing, otherwise folder text
    // gets overwritten by the currently linked folderId path.
    setNewFolderValue(draft?.folderId ? (folderPathById.get(draft.folderId) ?? draft.folder) : (draft?.folder ?? ''))
  }, [draft?.id, folderPathById])

  useLayoutEffect(() => {
    const nextSelected = itemById.get(selectedId) ?? null
    setDraft(nextSelected)
  }, [selectedId, itemById])

  useEffect(() => {
    setNewStorageFolderValue(storageDraft?.folderId ? (folderPathById.get(storageDraft.folderId) ?? storageDraft.folder) : (storageDraft?.folder ?? ''))
  }, [storageDraft?.id, folderPathById])

  useLayoutEffect(() => {
    const nextSelected = storageItemById.get(selectedStorageId) ?? null
    setStorageDraft(nextSelected)
  }, [selectedStorageId, storageItemById])

  useEffect(() => {
    if (phase !== 'ready' || !vaultSession || items.length === 0) return
    const quickCheck = recomputeItemRisks(items)
    if (!quickCheck.changed) return

    type IdleWindow = Window & {
      requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const win = window as IdleWindow
    const runId = ++riskBackfillRunIdRef.current
    let canceled = false
    let timeoutId: number | null = null
    let idleId: number | null = null
    let cursor = 0
    let changed = false
    const working = [...items]
    const reuseCounts = computePasswordReuseCounts(items)
    const indexById = new Map(items.map((item, index) => [item.id, index]))
    const prioritizedIndices: number[] = []
    const prioritizedIds = [selectedId, ...filtered.map((item) => item.id)]
    for (const id of prioritizedIds) {
      if (!id) continue
      const index = indexById.get(id)
      if (typeof index === 'number' && !prioritizedIndices.includes(index)) {
        prioritizedIndices.push(index)
      }
    }
    const allIndices = items.map((_, index) => index)
    const remainingIndices = allIndices.filter((index) => !prioritizedIndices.includes(index))
    const queue = [...prioritizedIndices, ...remainingIndices]

    const processSlice = () => {
      if (canceled || runId !== riskBackfillRunIdRef.current) return
      const end = Math.min(cursor + 50, queue.length)
      for (; cursor < end; cursor += 1) {
        const index = queue[cursor]
        const item = working[index]
        if (!item || item.risk === 'exposed' || item.risk === 'stale') continue
        const analysis = analyzePassword(item.passwordMasked ?? '', buildPasswordStrengthContextFromItem(item))
        const nextRisk = mapAnalysisToRisk(analysis, (reuseCounts.get(item.passwordMasked || '') ?? 0) > 1)
        if (nextRisk !== item.risk) {
          working[index] = { ...item, risk: nextRisk }
          changed = true
        }
      }

      if (cursor < queue.length) {
        schedule()
        return
      }

      if (changed) {
        void persistPayload({ items: working })
      }
    }

    const schedule = () => {
      if (canceled || runId !== riskBackfillRunIdRef.current) return
      if (typeof win.requestIdleCallback === 'function') {
        idleId = win.requestIdleCallback(() => {
          processSlice()
        }, { timeout: 300 })
      } else {
        timeoutId = window.setTimeout(processSlice, 24)
      }
    }

    schedule()

    return () => {
      canceled = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleId)
      }
    }
  }, [phase, vaultSession, items, selectedId, filtered, persistPayload])

  function setDraftField<K extends keyof VaultItem>(key: K, value: VaultItem[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  function setStorageDraftField<K extends keyof VaultStorageItem>(key: K, value: VaultStorageItem[K]) {
    setStorageDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  function buildPasswordCandidates(raw: string) {
    const candidates: string[] = []
    const pushUnique = (value: string) => {
      if (value && !candidates.includes(value)) {
        candidates.push(value)
      }
    }

    pushUnique(raw)
    pushUnique(raw.trim())
    pushUnique(raw.normalize('NFC'))
    pushUnique(raw.normalize('NFC').trim())
    pushUnique(raw.replace(/[\u200B-\u200D\uFEFF]/g, ''))
    pushUnique(raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim())

    return candidates
  }

  async function createVault() {
    setVaultError('')

    if (createPassword.length < 12) {
      setVaultError('Master password must be at least 12 characters.')
      return
    }

    if (createPassword !== confirmPassword) {
      setVaultError('Master password confirmation does not match.')
      return
    }

    try {
      const session = await createVaultFile(createPassword)
      persistVaultSnapshot(session.file)
      applySession(session, { resetNavigation: true })
      setPhase('ready')
      setSyncState('local')
      setSyncMessage(storageMode === 'cloud_only' ? 'Encrypted cloud-only vault created (cached locally)' : 'Encrypted local vault created (.armadillo)')
      setCreatePassword('')
      setConfirmPassword('')
    } catch {
      setVaultError('Failed to create encrypted vault.')
    }
  }

  async function unlockVault() {
    if (isUnlocking) return
    const unlockStartedAt = Date.now()
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
    const ensureUnlockVisualFeedback = async () => {
      const elapsed = Date.now() - unlockStartedAt
      if (elapsed < UNLOCK_SPINNER_MIN_VISIBLE_MS) {
        await wait(UNLOCK_SPINNER_MIN_VISIBLE_MS - elapsed)
      }
    }
    setIsUnlocking(true)
    setVaultError('')
    await new Promise<void>((resolve) => {
      if (typeof window.requestAnimationFrame !== 'function') {
        resolve()
        return
      }
      window.requestAnimationFrame(() => resolve())
    })
    try {
      const file = getUnlockSourceFile()
      if (!file) {
        const cacheStatus = getCachedVaultStatus()
        if (storageMode === 'cloud_only' && cacheStatus === 'expired') {
          setVaultError('Cloud-only cache expired. Connect to the internet and refresh from cloud.')
        } else if (storageMode === 'cloud_only') {
          setVaultError('No cached cloud vault found on this device.')
        } else {
          setVaultError('No local vault file found.')
        }
        setPhase('create')
        return
      }
      const passwordCandidates = buildPasswordCandidates(unlockPassword)

      try {
        let session: VaultSession | null = null
        for (const passwordCandidate of passwordCandidates) {
          try {
            session = await unlockVaultFile(file, passwordCandidate)
            break
          } catch {
            // Try next password candidate.
          }
        }
        if (!session) {
          throw new Error('Local unlock failed for all password variants')
        }
        applySession(session, { resetNavigation: true })
        await ensureUnlockVisualFeedback()
        setPhase('ready')
        setSyncMessage(storageMode === 'cloud_only' ? 'Vault unlocked from encrypted cloud cache' : 'Vault unlocked locally')
        setUnlockPassword('')
      } catch (initialError) {
        const cloudSyncAllowed = hasCapability('cloud.sync') && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))
        if (cloudConnected && syncConfigured() && cloudSyncAllowed) {
          try {
            setSyncAuthToken(authToken ?? null)
            const remote = await listRemoteVaultsByOwner()
            if (syncProvider === 'convex' && remote?.ownerSource === 'anonymous') {
              setAuthMessage('Cloud recovery resolved as anonymous owner. Sign out and sign in with Google again.')
              throw new Error('Cloud owner resolved to anonymous during signed-in recovery')
            }
            const candidates = (remote?.snapshots || []).filter(
              (candidate) => candidate.vaultId !== file.vaultId || candidate.revision !== file.revision,
            )

            for (const candidate of candidates) {
              try {
                let recovered: VaultSession | null = null
                for (const passwordCandidate of passwordCandidates) {
                  try {
                    recovered = await unlockVaultFile(candidate, passwordCandidate)
                    break
                  } catch {
                    // Try next password candidate.
                  }
                }
                if (!recovered) {
                  throw new Error('Candidate failed for all password variants')
                }
                persistVaultSnapshot(candidate)
                applySession(recovered, { resetNavigation: true })
                await ensureUnlockVisualFeedback()
                setPhase('ready')
                setSyncMessage('Vault unlocked from cloud save')
                setAuthMessage('Recovered using a matching cloud vault save')
                setUnlockPassword('')
                return
              } catch {
                // Try next candidate.
              }
            }
          } catch (recoveryError) {
            console.error('[armadillo] cloud unlock recovery failed:', recoveryError)
          }
        }

        console.error('[armadillo] unlock failed:', initialError)
        const detail = initialError instanceof Error ? `${initialError.name}: ${initialError.message}` : String(initialError)
        if (detail.includes('crypto.subtle is unavailable') || detail.includes('Web Crypto API is unavailable')) {
          setVaultError('This browser cannot decrypt vault data in the current context. Open the app over HTTPS/localhost or use the desktop app.')
          return
        }
        setVaultError('Invalid master password or corrupted vault file.')
      }
    } finally {
      setIsUnlocking(false)
    }
  }

  function loadVaultFromCloud(snapshot?: ArmadilloVaultFile) {
    const chosen = snapshot || cloudVaultSnapshot
    if (!chosen) return
    persistVaultSnapshot(chosen)
    setCloudVaultSnapshot(null)
    setCloudVaultCandidates([])
    setAuthMessage('Cloud vault loaded. Enter your master password to unlock it.')
    setPhase('unlock')
  }



  function lockVault() {
    setVaultSession(null)
    setItems([])
    setStorageItems([])
    setDraft(null)
    setStorageDraft(null)
    setSelectedId('')
    setSelectedStorageId('')
    setWorkspaceSection('passwords')
    setThemeSettings(normalizeThemeSettings(vaultSettings.theme))
    setThemeSettingsDirty(false)
    setPhase('unlock')
    setSyncMessage('Vault locked')
    clearNativeCredentials()
  }

  function closeOpenItem() {
    if (workspaceSection === 'storage') {
      setSelectedStorageId('')
      setStorageDraft(null)
    } else {
      setSelectedId('')
      setDraft(null)
    }
    if (effectivePlatform === 'mobile') {
      setMobileStep('list')
    }
  }

  function getChildrenFolders(parentId: string | null) {
    return folders.filter((folder) => folder.parentId === parentId)
  }

  function openFolderEditor(folder: VaultFolder) {
    setFolderEditor({ ...folder })
    setFolderEditorOpen(true)
    setContextMenu(null)
  }

  function startFolderInlineRename(folderId: string) {
    const target = folders.find((folder) => folder.id === folderId)
    if (!target) return
    setFolderInlineEditor({
      mode: 'rename',
      folderId: target.id,
      parentId: target.parentId,
      value: target.name,
    })
    setContextMenu(null)
  }

  function updateFolderInlineEditorValue(value: string) {
    setFolderInlineEditor((prev) => (prev ? { ...prev, value } : prev))
  }

  function cancelFolderInlineEditor() {
    setFolderInlineEditor(null)
  }

  async function saveFolderEditor() {
    if (!folderEditor) return
    const nextParentId = folderEditor.parentId === folderEditor.id ? null : folderEditor.parentId
    const updated = folders.map((folder) => (folder.id === folderEditor.id
      ? {
          ...folderEditor,
          parentId: nextParentId,
          updatedAt: new Date().toISOString(),
          excludeFromCloudSync: folderEditor.excludeFromCloudSync === true,
        }
      : folder))
    setFolderEditorOpen(false)
    setFolderEditor(null)
    await persistPayload({ folders: updated })
  }

  async function setFolderCloudSyncExcluded(folderId: string, excluded: boolean) {
    const canManageCloudSyncExclusions = hasCapability('cloud.sync')
      && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))
    if (!canManageCloudSyncExclusions) {
      setSyncMessage(syncProvider === 'self_hosted'
        ? (capabilityLockReasons['enterprise.self_hosted'] ?? 'Requires Enterprise plan')
        : (capabilityLockReasons['cloud.sync'] ?? 'Requires Premium plan'))
      return
    }
    const target = folders.find((folder) => folder.id === folderId)
    if (!target) return
    const nextFolders = folders.map((folder) => (
      folder.id === folderId
        ? { ...folder, excludeFromCloudSync: excluded, updatedAt: new Date().toISOString() }
        : folder
    ))
    setFolderEditor((current) => (
      current?.id === folderId
        ? { ...current, excludeFromCloudSync: excluded }
        : current
    ))
    await persistPayload({ folders: nextFolders })
    setContextMenu(null)
    setSyncMessage(excluded ? 'Folder marked local-only (excluded from cloud sync)' : 'Folder included in cloud sync')
  }

  function createSubfolder(parentId: string | null) {
    setFolderInlineEditor({ mode: 'create', parentId, value: '' })
    setContextMenu(null)
  }

  async function commitFolderInlineEditor() {
    if (!folderInlineEditor) return false
    const name = folderInlineEditor.value.trim()
    if (!name) return false
    const now = new Date().toISOString()
    if (folderInlineEditor.mode === 'create') {
      const nextFolder: VaultFolder = {
        id: crypto.randomUUID(),
        name,
        parentId: folderInlineEditor.parentId,
        color: DEFAULT_FOLDER_COLOR,
        icon: DEFAULT_FOLDER_ICON,
        notes: '',
        createdAt: now,
        updatedAt: now,
        excludeFromCloudSync: false,
      }
      const nextFolders = [...folders, nextFolder]
      setFolderInlineEditor(null)
      setFolders(nextFolders)
      await persistPayload({ folders: nextFolders })
      setSelectedNode(`folder:${nextFolder.id}`)
      return true
    }
    const target = folders.find((folder) => folder.id === folderInlineEditor.folderId)
    if (!target) return false
    const nextFolders = folders.map((folder) => (folder.id === target.id ? { ...folder, name, updatedAt: now } : folder))
    setFolderInlineEditor(null)
    setFolders(nextFolders)
    await persistPayload({ folders: nextFolders })
    return true
  }

  async function moveFolder(folderId: string, parentId: string | null, beforeFolderId?: string) {
    const target = folders.find((folder) => folder.id === folderId)
    if (!target) return false
    if (parentId === folderId) return false
    if (beforeFolderId === folderId) return false

    const beforeFolder = beforeFolderId ? folders.find((folder) => folder.id === beforeFolderId) : null
    if (beforeFolderId && !beforeFolder) return false
    if (beforeFolder && beforeFolder.parentId !== parentId) return false

    if (parentId) {
      const descendantIds = new Set(collectDescendantIds(folderId, folders))
      if (descendantIds.has(parentId)) return false
    }

    const now = new Date().toISOString()
    const movedFolder: VaultFolder = { ...target, parentId, updatedAt: now }
    const baseFolders = folders.filter((folder) => folder.id !== folderId)

    let insertIndex = -1
    if (beforeFolder) {
      insertIndex = baseFolders.findIndex((folder) => folder.id === beforeFolder.id)
    } else {
      for (let i = baseFolders.length - 1; i >= 0; i -= 1) {
        if (baseFolders[i].parentId === parentId) {
          insertIndex = i + 1
          break
        }
      }
    }

    const nextFolders = [...baseFolders]
    if (insertIndex < 0 || insertIndex > nextFolders.length) {
      nextFolders.push(movedFolder)
    } else {
      nextFolders.splice(insertIndex, 0, movedFolder)
    }

    setFolders(nextFolders)
    await persistPayload({ folders: nextFolders })
    return true
  }

  async function deleteFolderCascade(folderId: string) {
    const target = folders.find((folder) => folder.id === folderId)
    if (!target) return
    const descendantIds = new Set(collectDescendantIds(folderId, folders))
    const impactedItems = items.filter((item) => item.folderId && descendantIds.has(item.folderId))
    const impactedStorageItems = storageItems.filter((item) => item.folderId && descendantIds.has(item.folderId))
    const impactedFolders = folders.filter((folder) => descendantIds.has(folder.id))
    const confirmed = window.confirm(
      `Delete folder "${target.name}" and all ${impactedFolders.length - 1} subfolders with ${impactedItems.length + impactedStorageItems.length} item(s)?`,
    )
    if (!confirmed) return

    const deletedAt = new Date().toISOString()
    const retentionMs = getSafeRetentionDays(vaultSettings.trashRetentionDays) * 24 * 60 * 60 * 1000
    const nextTrash: VaultTrashEntry = {
      id: crypto.randomUUID(),
      kind: 'folderTreeSnapshot',
      deletedAt,
      purgeAt: new Date(Date.parse(deletedAt) + retentionMs).toISOString(),
      payload: {
        folderIds: Array.from(descendantIds),
        folders: impactedFolders,
        items: impactedItems,
        storageItems: impactedStorageItems,
      },
    }

    const nextFolders = folders.filter((folder) => !descendantIds.has(folder.id))
    const nextItems = items.filter((item) => !(item.folderId && descendantIds.has(item.folderId)))
    const nextStorageItems = storageItems.filter((item) => !(item.folderId && descendantIds.has(item.folderId)))
    const nextTrashEntries = [nextTrash, ...trash]
    setContextMenu(null)
    setSelectedNode('all')
    setSelectedId(nextItems[0]?.id ?? '')
    setDraft(nextItems[0] ?? null)
    setSelectedStorageId(nextStorageItems[0]?.id ?? '')
    setStorageDraft(nextStorageItems[0] ?? null)
    await persistPayload({ folders: nextFolders, items: nextItems, storageItems: nextStorageItems, trash: nextTrashEntries })
  }

  async function restoreTrashEntry(entryId: string) {
    const entry = trash.find((row) => row.id === entryId)
    if (!entry) return

    if (entry.kind === 'folderTreeSnapshot') {
      const payload = (entry.payload && typeof entry.payload === 'object' ? entry.payload : {}) as {
        folders?: VaultFolder[]
        items?: VaultItem[]
        storageItems?: VaultStorageItem[]
      }
      const restoredFolders = Array.isArray(payload.folders) ? payload.folders : []
      const restoredItems = Array.isArray(payload.items) ? payload.items : []
      const restoredStorageItems = Array.isArray(payload.storageItems) ? payload.storageItems : []
      const folderIds = new Set(folders.map((folder) => folder.id))
      const itemIds = new Set(items.map((item) => item.id))
      const storageIds = new Set(storageItems.map((item) => item.id))
      const nextFolders = [...folders]
      for (const folder of restoredFolders) {
        if (!folderIds.has(folder.id)) {
          nextFolders.push(folder)
        }
      }
      const nextItems = [...items]
      for (const item of restoredItems) {
        if (!itemIds.has(item.id)) {
          nextItems.push(item)
        }
      }
      const nextStorageItems = [...storageItems]
      for (const item of restoredStorageItems) {
        if (!storageIds.has(item.id)) {
          nextStorageItems.push(item)
        }
      }
      const nextTrashEntries = trash.filter((row) => row.id !== entryId)
      await persistPayload({ folders: nextFolders, items: nextItems, storageItems: nextStorageItems, trash: nextTrashEntries })
      return
    }

    if (entry.kind === 'storageItemSnapshot') {
      const payload = (entry.payload && typeof entry.payload === 'object' ? entry.payload : null) as VaultStorageItem | null
      if (!payload) return
      if (storageItems.some((item) => item.id === payload.id)) {
        await persistPayload({ trash: trash.filter((row) => row.id !== entryId) })
        return
      }
      await persistPayload({
        storageItems: [payload, ...storageItems],
        trash: trash.filter((row) => row.id !== entryId),
      })
    }
  }

  async function deleteTrashEntryPermanently(entryId: string) {
    await persistPayload({ trash: trash.filter((row) => row.id !== entryId) })
  }

  async function emptyVaultForTesting() {
    if (!vaultSession) {
      setSyncMessage('Unlock vault before emptying the vault')
      return
    }
    await persistPayload({
      items: [],
      storageItems: [],
      folders: [],
      trash: [],
    })
    setSelectedNode('all')
    setSelectedId('')
    setDraft(null)
    setMobileStep('list')
    setActivePanel('details')
    setSyncMessage('Vault emptied for testing')
  }

  async function garbageCollectStorageBlobs(nextSession: VaultSession, payload: VaultPayload) {
    const keepBlobIds = new Set<string>()
    for (const item of payload.storageItems) {
      if (item.blobRef?.blobId) keepBlobIds.add(item.blobRef.blobId)
    }
    for (const entry of payload.trash) {
      if (entry.kind !== 'storageItemSnapshot') continue
      const snapshot = (entry.payload && typeof entry.payload === 'object' ? entry.payload : null) as VaultStorageItem | null
      if (snapshot?.blobRef?.blobId) keepBlobIds.add(snapshot.blobRef.blobId)
    }

    const vaultId = nextSession.file.vaultId
    const metas = await blobStore.listBlobMetaByVault(vaultId)
    const canDeleteRemote = cloudSyncEnabled
      && syncConfigured()
      && hasCapability('cloud.sync')
      && hasCapability('vault.storage.blobs')
      && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))

    for (const meta of metas) {
      if (keepBlobIds.has(meta.blobId)) continue
      await blobStore.deleteBlob(vaultId, meta.blobId)
      if (canDeleteRemote) {
        try {
          await deleteRemoteBlob(vaultId, meta.blobId)
        } catch {
          // Best effort cleanup only.
        }
      }
    }
  }

  async function persistPayload(next: Partial<VaultPayload>) {
    if (!vaultSession) {
      return
    }
    const nextItems = next.items ? applyComputedItemRisks(next.items) : items
    const payload: VaultPayload = {
      schemaVersion: vaultSession.payload.schemaVersion,
      items: nextItems,
      storageItems: next.storageItems ?? storageItems,
      folders: next.folders ?? folders,
      trash: purgeExpiredTrash(next.trash ?? trash),
      settings: next.settings ?? vaultSettings,
    }
    const nextSession = await rewriteVaultFile(vaultSession, payload)
    applySession(nextSession)
    persistVaultSnapshot(nextSession.file)
    await garbageCollectStorageBlobs(nextSession, payload)

    const canUseCloudSync = hasCapability('cloud.sync')
    const canUseSelfHosted = syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted')
    if (cloudSyncEnabled && syncConfigured() && canUseCloudSync && canUseSelfHosted) {
      try {
        setSyncState('syncing')
        const cloudPushFile = await buildCloudPushFile(nextSession)
        const result = await pushRemoteSnapshot(cloudPushFile)
        if (result) {
          setSyncState('live')
          setSyncMessage(result.accepted ? `Encrypted sync pushed (${result.ownerSource})` : 'Sync ignored older revision')
        }
      } catch {
        setSyncState('error')
        setSyncMessage(storageMode === 'cloud_only'
          ? 'Encrypted change cached locally; cloud sync failed'
          : 'Encrypted change saved locally; cloud sync failed')
      }
    } else {
      setSyncState('local')
      if (cloudSyncEnabled && !canUseCloudSync) {
        setSyncMessage(capabilityLockReasons['cloud.sync'] ?? 'Requires Premium plan')
      } else if (cloudSyncEnabled && !canUseSelfHosted) {
        setSyncMessage(capabilityLockReasons['enterprise.self_hosted'] ?? 'Requires Enterprise plan')
      } else {
        setSyncMessage(storageMode === 'cloud_only' ? 'Encrypted change cached locally' : 'Encrypted change saved locally')
      }
    }
  }

  async function addGeneratorPreset(preset: VaultSettings['generatorPresets'][number]) {
    const nextPresets = [...vaultSettings.generatorPresets, preset]
    const nextSettings = { ...vaultSettings, generatorPresets: nextPresets }
    setVaultSettings(nextSettings)
    await persistPayload({ settings: nextSettings })
  }

  async function removeGeneratorPreset(presetId: string) {
    const nextPresets = vaultSettings.generatorPresets.filter((p) => p.id !== presetId)
    const nextSettings = { ...vaultSettings, generatorPresets: nextPresets }
    setVaultSettings(nextSettings)
    await persistPayload({ settings: nextSettings })
  }

  function selectThemePreset(presetId: string) {
    setThemeSettings((current) => applyPresetSelection(current, presetId))
  }

  function updateThemeTokenOverride(token: ThemeEditableTokenKey, rawValue: string) {
    setThemeSettings((current) => {
      const normalized = normalizeThemeSettings(current)
      const nextOverrides = {
        ...normalized.activeOverrides,
      } as Record<string, unknown>
      const trimmed = rawValue.trim()
      if (!trimmed) {
        delete nextOverrides[token]
      } else {
        nextOverrides[token] = trimmed
      }
      return normalizeThemeSettings({
        ...normalized,
        activeOverrides: normalizeThemeTokenOverrides(nextOverrides),
      })
    })
  }

  function resetThemeOverrides() {
    setThemeSettings((current) => {
      const normalized = normalizeThemeSettings(current)
      return normalizeThemeSettings({
        ...normalized,
        activeOverrides: {},
        selectedPresetId: normalized.activeBaseThemeId,
      })
    })
  }

  function saveThemeAsCustomPreset(name: string) {
    setThemeSettings((current) => upsertCustomThemePreset(current, name).themeSettings)
  }

  function deleteThemePreset(presetId: string) {
    setThemeSettings((current) => deleteCustomThemePreset(current, presetId))
  }

  function setThemeMotionLevel(motionLevel: ThemeMotionLevel) {
    setThemeSettings((current) => normalizeThemeSettings({ ...current, motionLevel }))
  }

  async function persistThemeSettings() {
    if (!vaultSession) {
      setSyncMessage('Unlock vault before saving theme settings')
      return
    }
    const normalizedTheme = normalizeThemeSettings(themeSettings)
    const nextSettings = normalizeAutoFolderSettings({
      ...vaultSettings,
      theme: normalizedTheme,
    })
    setVaultSettings(nextSettings)
    setThemeSettings(normalizedTheme)
    await persistPayload({ settings: nextSettings })
    saveThemeSettingsToMirror(normalizedTheme)
    setThemeSettingsDirty(false)
    setSyncMessage('Theme settings saved')
  }

  function dismissExpiryAlerts() {
    setExpiryAlertsDismissed(true)
  }

  function ensureFolderByPath(pathRaw: string, source = folders, parentId: string | null = null) {
    const path = pathRaw.trim()
    if (!path) return { folder: null, nextFolders: source }
    const segments = path.split('/').map((s) => s.trim()).filter(Boolean)
    if (segments.length === 0) return { folder: null, nextFolders: source }
    let currentParentId = parentId
    let latest: VaultFolder | null = null
    const localFolders = [...source]
    const now = new Date().toISOString()

    for (const segment of segments) {
      const existing = localFolders.find((folder) =>
        folder.parentId === currentParentId && folder.name.trim().toLowerCase() === segment.toLowerCase())
      if (existing) {
        latest = existing
        currentParentId = existing.id
        continue
      }
      const created: VaultFolder = {
        id: crypto.randomUUID(),
        name: segment,
        parentId: currentParentId,
        color: DEFAULT_FOLDER_COLOR,
        icon: DEFAULT_FOLDER_ICON,
        notes: '',
        createdAt: now,
        updatedAt: now,
        excludeFromCloudSync: false,
      }
      localFolders.push(created)
      latest = created
      currentParentId = created.id
    }

    return { folder: latest, nextFolders: localFolders }
  }

  function createItem() {
    setWorkspaceSection('passwords')
    if (selectedNode === 'home') {
      setSelectedNode('all')
    }
    const selectedFolderId = selectedNode.startsWith('folder:') ? selectedNode.slice('folder:'.length) : null
    const selectedFolderPath = selectedFolderId ? (folderPathById.get(selectedFolderId) ?? '') : ''
    const item = buildEmptyItem(selectedFolderPath, selectedFolderId)
    const next = applyComputedItemRisks([item, ...items])
    void persistPayload({ items: next })
    setSelectedId(item.id)
    setDraft(next.find((entry) => entry.id === item.id) ?? item)
    setMobileStep('detail')
    setActivePanel('details')
  }

  function createStorageItem() {
    if (!hasCapability('vault.storage') || !isFlagEnabled('experiments.storage_tab')) {
      setSyncMessage(capabilityLockReasons['vault.storage'] ?? 'Requires Premium plan')
      return
    }
    setWorkspaceSection('storage')
    if (selectedNode === 'home' || selectedNode === 'expiring' || selectedNode === 'expired') {
      setSelectedNode('all')
    }
    const selectedFolderId = selectedNode.startsWith('folder:') ? selectedNode.slice('folder:'.length) : null
    const selectedFolderPath = selectedFolderId ? (folderPathById.get(selectedFolderId) ?? '') : ''
    const item = buildEmptyStorageItem(selectedFolderPath, selectedFolderId)
    const next = [item, ...storageItems]
    void persistPayload({ storageItems: next })
    setSelectedStorageId(item.id)
    setStorageDraft(item)
    setMobileStep('detail')
    setActivePanel('details')
  }

  function storageItemExcludedFromCloud(item: VaultStorageItem) {
    const excludedByFolder = Boolean(item.folderId && folders.find((folder) => folder.id === item.folderId)?.excludeFromCloudSync)
    return item.excludeFromCloudSync === true || excludedByFolder
  }

  function canSyncStorageBlob(item: VaultStorageItem) {
    if (storageItemExcludedFromCloud(item)) return false
    if (!cloudSyncEnabled || !syncConfigured()) return false
    if (!hasCapability('cloud.sync') || !hasCapability('vault.storage.blobs')) return false
    if (syncProvider === 'self_hosted' && !hasCapability('enterprise.self_hosted')) return false
    return true
  }

  async function loadStorageBlobRecord(item: VaultStorageItem) {
    if (!vaultSession || !item.blobRef) return null
    const vaultId = vaultSession.file.vaultId
    const local = await blobStore.getBlob(vaultId, item.blobRef.blobId)
    if (local) {
      return local
    }
    if (!canSyncStorageBlob(item)) {
      return null
    }
    const remote = await getRemoteBlob(vaultId, item.blobRef.blobId)
    if (!remote?.blob) return null
    await blobStore.putBlob({
      vaultId,
      blobId: remote.blob.blobId,
      nonce: remote.blob.nonce,
      ciphertext: remote.blob.ciphertext,
      sizeBytes: remote.blob.sizeBytes,
      sha256: remote.blob.sha256,
      mimeType: remote.blob.mimeType,
      fileName: remote.blob.fileName,
      updatedAt: remote.blob.updatedAt,
      createdAt: new Date().toISOString(),
    })
    return blobStore.getBlob(vaultId, item.blobRef.blobId)
  }

  async function attachFileToStorageDraft(file: File) {
    if (!vaultSession || !storageDraft) return
    if (file.size > STORAGE_FILE_LIMIT_BYTES) {
      setSyncMessage(`File exceeds ${Math.round(STORAGE_FILE_LIMIT_BYTES / (1024 * 1024))}MB limit`)
      return
    }

    setStorageFileBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const vaultId = vaultSession.file.vaultId
      const usageBytes = await blobStore.computeUsageBytes(vaultId)
      const existingBlobSize = storageDraft.blobRef
        ? ((await blobStore.getBlob(vaultId, storageDraft.blobRef.blobId))?.sizeBytes ?? 0)
        : 0
      const projectedUsage = usageBytes - existingBlobSize + bytes.byteLength
      if (projectedUsage > STORAGE_TOTAL_LIMIT_BYTES) {
        setSyncMessage(`Vault storage exceeds ${Math.round(STORAGE_TOTAL_LIMIT_BYTES / (1024 * 1024 * 1024))}GB limit`)
        return
      }
      const sha256 = await sha256Base64(bytes)
      const encrypted = await encryptBytesWithVaultKey(vaultSession.vaultKey, bytes)
      const blobId = storageDraft.blobRef?.blobId ?? crypto.randomUUID()
      const updatedAt = new Date().toISOString()
      const remoteBlob = {
        blobId,
        vaultId,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        sizeBytes: bytes.byteLength,
        sha256,
        mimeType: file.type || 'application/octet-stream',
        fileName: file.name || 'file.bin',
        updatedAt,
      }

      if (canSyncStorageBlob(storageDraft)) {
        const uploaded = await putRemoteBlob(vaultSession.file.vaultId, remoteBlob)
        if (!uploaded?.ok) {
          setSyncMessage('Encrypted file upload failed')
          return
        }
      }

      await blobStore.putBlob({
        ...remoteBlob,
        createdAt: new Date().toISOString(),
      })

      setStorageDraft((current) => {
        if (!current) return current
        return {
          ...current,
          kind: inferStorageKindFromMime(remoteBlob.mimeType, remoteBlob.fileName),
          blobRef: {
            blobId,
            fileName: remoteBlob.fileName,
            mimeType: remoteBlob.mimeType,
            sizeBytes: remoteBlob.sizeBytes,
            sha256: remoteBlob.sha256,
          },
          updatedAt: new Date().toLocaleString(),
        }
      })
      setSyncMessage('Encrypted file attached')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setSyncMessage(`Failed attaching file: ${detail}`)
    } finally {
      setStorageFileBusy(false)
    }
  }

  async function loadStorageBlobFile(itemId: string) {
    if (!vaultSession) return null
    const item = storageItems.find((row) => row.id === itemId)
    if (!item?.blobRef) return null
    const row = await loadStorageBlobRecord(item)
    if (!row) return null
    const bytes = await decryptBytesWithVaultKey(vaultSession.vaultKey, { nonce: row.nonce, ciphertext: row.ciphertext })
    return {
      fileName: row.fileName,
      mimeType: row.mimeType,
      bytes,
      sha256: row.sha256,
    }
  }

  async function downloadStorageFile(itemId: string) {
    const loaded = await loadStorageBlobFile(itemId)
    if (!loaded) {
      setSyncMessage('Storage file is unavailable')
      return
    }
    const blobBytes = loaded.bytes.slice()
    const blob = new Blob([blobBytes.buffer], { type: loaded.mimeType || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = loaded.fileName || 'download.bin'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function saveCurrentStorageItem() {
    if (!storageDraft) return
    setIsSaving(true)
    const folderInput = newStorageFolderValue.trim() || storageDraft.folder || ''
    const ensuredFolder = ensureFolderByPath(folderInput, folders)
    const nextItem: VaultStorageItem = {
      ...storageDraft,
      folder: folderInput,
      folderId: ensuredFolder.folder?.id ?? null,
      tags: storageDraft.tags.map((tag) => tag.trim()).filter(Boolean),
      updatedAt: new Date().toLocaleString(),
    }
    const nextItems = storageItems.map((item) => (item.id === nextItem.id ? nextItem : item))
    setFolders(ensuredFolder.nextFolders)
    await persistPayload({
      storageItems: nextItems,
      folders: ensuredFolder.nextFolders,
    })
    setIsSaving(false)
    setNewStorageFolderValue('')
  }

  async function removeStorageItemById(itemId: string) {
    const target = storageItems.find((item) => item.id === itemId)
    if (!target) return
    const deletedAt = new Date().toISOString()
    const retentionMs = getSafeRetentionDays(vaultSettings.trashRetentionDays) * 24 * 60 * 60 * 1000
    const trashEntry: VaultTrashEntry = {
      id: crypto.randomUUID(),
      kind: 'storageItemSnapshot',
      deletedAt,
      purgeAt: new Date(Date.parse(deletedAt) + retentionMs).toISOString(),
      payload: target,
    }
    const remaining = storageItems.filter((item) => item.id !== itemId)
    const nextTrash = [trashEntry, ...trash]
    await persistPayload({ storageItems: remaining, trash: nextTrash })
    const inViewRemaining = scopeStorageItemsForSelection(remaining, selectedNode, folderFilterMode)
    const nextSelected = inViewRemaining[0] ?? null
    setSelectedStorageId(nextSelected?.id ?? '')
    setStorageDraft(nextSelected)
  }

  async function removeCurrentStorageItem() {
    if (!storageDraft) return
    await removeStorageItemById(storageDraft.id)
  }

  const checkForAppUpdates = useCallback(async () => {
    setIsCheckingForUpdates(true)
    try {
      const manifest = await fetchUpdateManifest(APP_BUILD_INFO.manifestUrl)
      setUpdateCheckResult(evaluateUpdateStatus(manifest, APP_BUILD_INFO))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setUpdateCheckResult({
        ...defaultUpdateCheckResult(APP_BUILD_INFO),
        checkedAt: new Date().toISOString(),
        message: `Update check failed: ${detail}`,
        error: detail,
      })
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [])

  function openSettings(category?: SettingsCategoryId) {
    if (category) {
      setSettingsCategory(category)
    }
    setShowSettings(true)
    void checkForAppUpdates()
  }

  function closeSettings() {
    setShowSettings(false)
  }

  function openHome() {
    setWorkspaceSection('passwords')
    setSelectedNode('home')
    setMobileStep('home')
  }

  function openStorageWorkspace() {
    if (!hasCapability('vault.storage') || !isFlagEnabled('experiments.storage_tab')) {
      setSyncMessage(capabilityLockReasons['vault.storage'] ?? 'Requires Premium plan')
      return
    }
    setWorkspaceSection('storage')
    if (selectedNode === 'home' || selectedNode === 'expiring' || selectedNode === 'expired') {
      setSelectedNode('all')
    }
    if (effectivePlatform === 'mobile') {
      setMobileStep('list')
    }
  }

  function switchWorkspaceSection(section: WorkspaceSection) {
    if (section === 'storage') {
      openStorageWorkspace()
      return
    }
    setWorkspaceSection('passwords')
    if (selectedNode !== 'home' && effectivePlatform === 'mobile' && mobileStep === 'home') {
      setMobileStep('list')
    }
  }

  function openSmartView(view: 'expired' | 'expiring') {
    setWorkspaceSection('passwords')
    setQuery('')
    setSelectedNode(view)
    setMobileStep('list')
  }

  function updateHomeSearch(value: string) {
    setHomeSearchQuery(value)
  }

  function submitHomeSearch() {
    setWorkspaceSection('passwords')
    setSelectedNode('all')
    setQuery(homeSearchQuery.trim())
    setMobileStep('list')
  }

  function openItemFromHome(itemId: string) {
    setWorkspaceSection('passwords')
    setSelectedNode('all')
    setQuery('')
    setSelectedId(itemId)
    setActivePanel('details')
    if (effectivePlatform === 'mobile') {
      setMobileStep('detail')
    }
  }

  async function saveCurrentItem() {
    if (!draft) return
    setIsSaving(true)
    const folderInput = newFolderValue.trim() || draft.folder || ''
    const ensuredFolder = ensureFolderByPath(folderInput, folders)
    const nextItem: VaultItem = {
      ...draft,
      urls: draft.urls
        .map((url) => url.trim())
        .filter(Boolean),
      folder: folderInput,
      folderId: ensuredFolder.folder?.id ?? null,
      updatedAt: new Date().toLocaleString(),
    }
    const nextItems = applyComputedItemRisks(items.map((item) => (item.id === nextItem.id ? nextItem : item)))
    setFolders(ensuredFolder.nextFolders)
    await persistPayload({
      items: nextItems,
      folders: ensuredFolder.nextFolders,
    })

    setIsSaving(false)
    setNewFolderValue('')
  }

  function scopeItemsForSelection(sourceItems: VaultItem[], node: SidebarNode, mode: FolderFilterMode) {
    if (node === 'all') return sourceItems
    if (node === 'home' || node === 'trash') return []
    if (node === 'expiring') {
      return sourceItems.filter((item) => getPasswordExpiryStatus(item.passwordExpiryDate, { expiringWithinDays: PASSWORD_EXPIRING_SOON_DAYS }) === 'expiring')
    }
    if (node === 'expired') {
      return sourceItems.filter((item) => getPasswordExpiryStatus(item.passwordExpiryDate, { expiringWithinDays: PASSWORD_EXPIRING_SOON_DAYS }) === 'expired')
    }
    if (node === 'unfiled') {
      return sourceItems.filter((item) => !item.folderId)
    }
    const folderId = node.slice('folder:'.length)
    if (!folderId) return sourceItems
    if (mode === 'recursive') {
      const descendantIds = new Set(collectDescendantIds(folderId, folders))
      return sourceItems.filter((item) => item.folderId && descendantIds.has(item.folderId))
    }
    return sourceItems.filter((item) => item.folderId === folderId)
  }

  function scopeStorageItemsForSelection(sourceItems: VaultStorageItem[], node: SidebarNode, mode: FolderFilterMode) {
    if (node === 'all') return sourceItems
    if (node === 'home' || node === 'trash' || node === 'expiring' || node === 'expired') return []
    if (node === 'unfiled') return sourceItems.filter((item) => !item.folderId)
    const folderId = node.slice('folder:'.length)
    if (!folderId) return sourceItems
    if (mode === 'recursive') {
      const descendantIds = new Set(collectDescendantIds(folderId, folders))
      return sourceItems.filter((item) => item.folderId && descendantIds.has(item.folderId))
    }
    return sourceItems.filter((item) => item.folderId === folderId)
  }

  async function removeCurrentItem() {
    if (!draft) return
    const deletingId = draft.id
    const previousNode = selectedNode
    const previousFilterMode = folderFilterMode
    const previousMobileStep = mobileStep
    const remaining = items.filter((item) => item.id !== deletingId)
    await persistPayload({ items: remaining })
    const inViewRemaining = scopeItemsForSelection(remaining, previousNode, previousFilterMode)
    const nextSelected = inViewRemaining[0] ?? null
    setSelectedNode(previousNode)
    setFolderFilterMode(previousFilterMode)
    setSelectedId(nextSelected?.id ?? '')
    setDraft(nextSelected)
    if (effectivePlatform === 'mobile') {
      setMobileStep(nextSelected ? previousMobileStep : 'list')
    }
  }

  async function removeItemById(itemId: string) {
    const previousNode = selectedNode
    const previousFilterMode = folderFilterMode
    const previousMobileStep = mobileStep
    const previousSelectedId = selectedId
    const remaining = items.filter((item) => item.id !== itemId)
    await persistPayload({ items: remaining })
    const inViewRemaining = scopeItemsForSelection(remaining, previousNode, previousFilterMode)
    const fallbackSelected = inViewRemaining[0] ?? null
    const keepSelected = previousSelectedId && previousSelectedId !== itemId
      ? remaining.find((item) => item.id === previousSelectedId) ?? null
      : null
    const nextSelected = keepSelected ?? fallbackSelected
    setSelectedNode(previousNode)
    setFolderFilterMode(previousFilterMode)
    setSelectedId(nextSelected?.id ?? '')
    setDraft(nextSelected)
    if (effectivePlatform === 'mobile') {
      setMobileStep(nextSelected ? previousMobileStep : 'list')
    }
    setItemContextMenu(null)
  }

  async function setItemCloudSyncExcluded(itemId: string, excluded: boolean) {
    const canManageCloudSyncExclusions = hasCapability('cloud.sync')
      && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))
    if (!canManageCloudSyncExclusions) {
      setSyncMessage(syncProvider === 'self_hosted'
        ? (capabilityLockReasons['enterprise.self_hosted'] ?? 'Requires Enterprise plan')
        : (capabilityLockReasons['cloud.sync'] ?? 'Requires Premium plan'))
      return
    }
    const target = items.find((item) => item.id === itemId)
    if (!target) return
    const nextItems = items.map((item) => (
      item.id === itemId
        ? { ...item, excludeFromCloudSync: excluded, updatedAt: new Date().toLocaleString() }
        : item
    ))
    setDraft((current) => (
      current?.id === itemId
        ? { ...current, excludeFromCloudSync: excluded }
        : current
    ))
    await persistPayload({ items: nextItems })
    setItemContextMenu(null)
    setSyncMessage(excluded ? 'Credential marked local-only (excluded from cloud sync)' : 'Credential included in cloud sync')
  }

  async function setStorageItemCloudSyncExcluded(itemId: string, excluded: boolean) {
    const canManageCloudSyncExclusions = hasCapability('cloud.sync')
      && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))
    if (!canManageCloudSyncExclusions) {
      setSyncMessage(syncProvider === 'self_hosted'
        ? (capabilityLockReasons['enterprise.self_hosted'] ?? 'Requires Enterprise plan')
        : (capabilityLockReasons['cloud.sync'] ?? 'Requires Premium plan'))
      return
    }
    const target = storageItems.find((item) => item.id === itemId)
    if (!target) return
    const nextItems = storageItems.map((item) => (
      item.id === itemId
        ? { ...item, excludeFromCloudSync: excluded, updatedAt: new Date().toLocaleString() }
        : item
    ))
    setStorageDraft((current) => (
      current?.id === itemId
        ? { ...current, excludeFromCloudSync: excluded }
        : current
    ))
    await persistPayload({ storageItems: nextItems })
    setStorageContextMenu(null)
    setSyncMessage(excluded ? 'Storage item marked local-only (excluded from cloud sync)' : 'Storage item included in cloud sync')
  }

  async function duplicateItem(itemId: string) {
    const source = items.find((item) => item.id === itemId)
    if (!source) return
    const duplicated: VaultItem = {
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title || 'Credential'} Copy`,
      updatedAt: new Date().toLocaleString(),
    }
    const nextItems = applyComputedItemRisks([duplicated, ...items])
    await persistPayload({ items: nextItems })
    const nextSelected = nextItems.find((item) => item.id === duplicated.id) ?? duplicated
    setSelectedId(duplicated.id)
    setDraft(nextSelected)
    setMobileStep('detail')
    setItemContextMenu(null)
  }

  async function copyPassword() {
    if (!draft?.passwordMasked) return
    await copyToClipboard(draft.passwordMasked, 'Password copied to clipboard', 'Clipboard copy failed')
  }

  async function autofillItem(item: VaultItem) {
    if (!window.armadilloShell?.isElectron || !window.armadilloShell.autofillCredentials) {
      setSyncMessage('Autofill is available in the desktop app')
      return
    }
    setSyncMessage('Sending autofill to previous app...')
    const result = await window.armadilloShell.autofillCredentials(item.username || '', item.passwordMasked || '')
    if (result?.ok) {
      setSyncMessage('Autofill sent to previous app')
    } else {
      setSyncMessage(result?.error || 'Autofill failed')
    }
  }

  function updateSecurityQuestion(index: number, field: keyof SecurityQuestion, value: string) {
    if (!draft) return
    const next = [...draft.securityQuestions]
    next[index] = { ...next[index], [field]: value }
    setDraftField('securityQuestions', next)
  }

  function exportVaultFile() {
    if (!vaultSession) {
      return
    }

    const text = serializeVaultFile(vaultSession.file)
    const blob = new Blob([text], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `vault-${vaultSession.file.vaultId}.armadillo`
    anchor.click()
    URL.revokeObjectURL(url)
    setSyncMessage('Encrypted vault exported (.armadillo)')
  }

  async function exportVaultBackupBundle() {
    if (!vaultSession) {
      setSyncMessage('Unlock vault before exporting backup bundle')
      return
    }

    try {
      const vaultId = vaultSession.file.vaultId
      const manifest: BackupManifest = {
        version: 1,
        vaultId,
        createdAt: new Date().toISOString(),
        blobCount: 0,
        blobs: [],
      }
      const archive: Record<string, Uint8Array> = {
        'vault.armadillo': strToU8(serializeVaultFile(vaultSession.file)),
      }

      const metas = await blobStore.listBlobMetaByVault(vaultId)
      for (const meta of metas) {
        const row = await blobStore.getBlob(vaultId, meta.blobId)
        if (!row) continue
        const path = `blobs/${meta.blobId}.bin`
        archive[path] = strToU8(JSON.stringify({
          blobId: row.blobId,
          vaultId: row.vaultId,
          nonce: row.nonce,
          ciphertext: row.ciphertext,
          sizeBytes: row.sizeBytes,
          sha256: row.sha256,
          mimeType: row.mimeType,
          fileName: row.fileName,
          updatedAt: row.updatedAt,
        }))
        manifest.blobs.push({
          blobId: row.blobId,
          fileName: row.fileName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          sha256: row.sha256,
          updatedAt: row.updatedAt,
          path,
        })
      }
      manifest.blobCount = manifest.blobs.length
      archive['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))

      const zipped = zipSync(archive, { level: 0 })
      const zipBytes = new Uint8Array(zipped)
      const blob = new Blob([zipBytes.buffer], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `vault-${vaultId}.armadillo-backup.zip`
      anchor.click()
      URL.revokeObjectURL(url)
      setSyncMessage(`Encrypted backup bundle exported (${manifest.blobCount} blob${manifest.blobCount === 1 ? '' : 's'})`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setSyncMessage(`Backup bundle export failed: ${detail}`)
    }
  }

  function triggerImport() {
    importFileInputRef.current?.click()
  }

  function triggerBackupImport() {
    backupImportInputRef.current?.click()
  }

  function triggerGooglePasswordImport() {
    googlePasswordImportInputRef.current?.click()
  }

  function triggerKeePassImport() {
    keepassImportInputRef.current?.click()
  }

  async function onImportFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = parseVaultFileFromText(text)
      persistVaultSnapshot(parsed)
      setVaultSession(null)
      setItems([])
      setStorageItems([])
      setFolders([])
      setTrash([])
      setDraft(null)
      setStorageDraft(null)
      setSelectedId('')
      setSelectedStorageId('')
      setWorkspaceSection('passwords')
      setPhase('unlock')
      setSyncMessage('Encrypted vault imported. Unlock with master password.')
    } catch {
      setSyncMessage('Failed to import vault file')
    }

    event.currentTarget.value = ''
  }

  async function onBackupBundleSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const archive = unzipSync(bytes)
      const manifestBytes = archive['manifest.json']
      const vaultBytes = archive['vault.armadillo']
      if (!manifestBytes || !vaultBytes) {
        setSyncMessage('Backup bundle is missing manifest.json or vault.armadillo')
        return
      }

      const manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest
      const parsedVault = parseVaultFileFromText(strFromU8(vaultBytes))
      const nowIso = new Date().toISOString()
      for (const row of manifest.blobs ?? []) {
        const blobBytes = archive[row.path]
        if (!blobBytes) continue
        try {
          const payload = JSON.parse(strFromU8(blobBytes)) as {
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
          if (!payload.blobId || !payload.nonce || !payload.ciphertext) continue
          await blobStore.putBlob({
            vaultId: manifest.vaultId || parsedVault.vaultId,
            blobId: payload.blobId,
            nonce: payload.nonce,
            ciphertext: payload.ciphertext,
            sizeBytes: Number.isFinite(Number(payload.sizeBytes)) ? Number(payload.sizeBytes) : row.sizeBytes,
            sha256: payload.sha256 || row.sha256,
            mimeType: payload.mimeType || row.mimeType || 'application/octet-stream',
            fileName: payload.fileName || row.fileName || 'file.bin',
            updatedAt: payload.updatedAt || row.updatedAt || nowIso,
            createdAt: nowIso,
          })
        } catch {
          // Skip malformed blob rows.
        }
      }

      persistVaultSnapshot(parsedVault)
      setVaultSession(null)
      setItems([])
      setStorageItems([])
      setFolders([])
      setTrash([])
      setDraft(null)
      setStorageDraft(null)
      setSelectedId('')
      setSelectedStorageId('')
      setWorkspaceSection('passwords')
      setPhase('unlock')
      setSyncMessage(`Encrypted backup bundle imported (${manifest.blobCount ?? 0} blob${(manifest.blobCount ?? 0) === 1 ? '' : 's'})`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setSyncMessage(`Failed to import backup bundle: ${detail}`)
    } finally {
      event.currentTarget.value = ''
    }
  }

  async function onGooglePasswordCsvSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    if (!vaultSession) {
      setSyncMessage('Unlock vault before importing Google passwords')
      event.currentTarget.value = ''
      return
    }

    try {
      const text = await file.text()
      const parsed = parseGooglePasswordCsv(text)
      if (parsed.entries.length === 0) {
        setSyncMessage('No importable credentials found in Google CSV')
        return
      }

      const now = new Date().toLocaleString()
      const importedItems: VaultItem[] = parsed.entries.map((entry, index) => {
        const url = entry.url.trim()
        const username = entry.username
        const password = entry.password
        const note = entry.note
        return {
          id: crypto.randomUUID(),
          title: inferImportedItemTitle({ title: entry.name, url: entry.url, username: entry.username }, index + 1),
          username,
          passwordMasked: password,
          urls: url ? [url] : [],
          linkedAndroidPackages: [],
          folder: '',
          folderId: null,
          tags: ['imported', 'google-password-manager'],
          risk: 'safe',
          updatedAt: now,
          note,
          securityQuestions: [],
          passwordExpiryDate: null,
          excludeFromCloudSync: false,
        }
      })

      const nextItems = applyComputedItemRisks([...importedItems, ...items])
      await persistPayload({
        items: nextItems,
      })

      setSelectedNode('all')
      setSelectedId(importedItems[0].id)
      setDraft(nextItems.find((item) => item.id === importedItems[0].id) ?? importedItems[0])
      setMobileStep('detail')
      setActivePanel('details')

      const skippedSuffix = parsed.skippedRows > 0 ? `, skipped ${parsed.skippedRows}` : ''
      setSyncMessage(`Imported ${importedItems.length} credential(s) from Google CSV${skippedSuffix}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setSyncMessage(`Failed to import Google CSV: ${detail}`)
    } finally {
      event.currentTarget.value = ''
    }
  }

  async function onKeePassCsvSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    if (!vaultSession) {
      setSyncMessage('Unlock vault before importing KeePass data')
      event.currentTarget.value = ''
      return
    }

    try {
      const text = await file.text()
      const normalizedName = file.name.trim().toLowerCase()
      const trimmedText = text.trimStart()
      const looksLikeXml = normalizedName.endsWith('.xml')
        || trimmedText.startsWith('<?xml')
        || /<\s*KeePassFile(?:\s|>)/i.test(trimmedText.slice(0, 2048))
      const parsed = looksLikeXml ? parseKeePassXml(text) : parseKeePassCsv(text)
      const sourceLabel = looksLikeXml ? 'KeePass XML' : 'KeePass CSV'
      if (parsed.entries.length === 0) {
        setSyncMessage(`No importable credentials found in ${sourceLabel}`)
        return
      }

      let nextFolders = folders
      const folderIdByPathKey = new Map<string, string>()
      for (const [folderId, path] of folderPathById.entries()) {
        folderIdByPathKey.set(getPathKey(path), folderId)
      }
      const requestedGroupPaths = Array.from(new Set(parsed.entries
        .map((entry) => normalizeAutoFolderPath(entry.group))
        .filter(Boolean)))
      for (const groupPath of requestedGroupPaths) {
        const pathKey = getPathKey(groupPath)
        if (folderIdByPathKey.has(pathKey)) continue
        const ensured = ensureFolderByPath(groupPath, nextFolders)
        nextFolders = ensured.nextFolders
        if (ensured.folder) {
          folderIdByPathKey.set(pathKey, ensured.folder.id)
        }
      }

      const now = new Date().toLocaleString()
      const importedItems: VaultItem[] = parsed.entries.map((entry, index) => {
        const url = entry.url.trim()
        const username = entry.username
        const password = entry.password
        const groupPath = normalizeAutoFolderPath(entry.group)
        const folderId = groupPath ? (folderIdByPathKey.get(getPathKey(groupPath)) ?? null) : null
        const baseNote = entry.note
        const note = folderId
          ? baseNote
          : (groupPath ? `KeePass Group: ${groupPath}${baseNote ? `\n\n${baseNote}` : ''}` : baseNote)
        return {
          id: crypto.randomUUID(),
          title: inferImportedItemTitle({ title: entry.title, url: entry.url, username: entry.username }, index + 1),
          username,
          passwordMasked: password,
          urls: url ? [url] : [],
          linkedAndroidPackages: [],
          folder: groupPath || '',
          folderId,
          tags: ['imported', 'keepass'],
          risk: 'safe',
          updatedAt: now,
          note,
          securityQuestions: [],
          passwordExpiryDate: null,
          excludeFromCloudSync: false,
        }
      })

      const nextItems = applyComputedItemRisks([...importedItems, ...items])
      await persistPayload({ items: nextItems, folders: nextFolders })

      setSelectedNode('all')
      setSelectedId(importedItems[0].id)
      setDraft(nextItems.find((item) => item.id === importedItems[0].id) ?? importedItems[0])
      setMobileStep('detail')
      setActivePanel('details')

      const skippedSuffix = parsed.skippedRows > 0 ? `, skipped ${parsed.skippedRows}` : ''
      const createdFolderCount = Math.max(0, nextFolders.length - folders.length)
      const folderSuffix = createdFolderCount > 0 ? `, created ${createdFolderCount} folder(s)` : ''
      setSyncMessage(`Imported ${importedItems.length} credential(s) from ${sourceLabel}${skippedSuffix}${folderSuffix}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setSyncMessage(`Failed to import KeePass export: ${detail}`)
    } finally {
      event.currentTarget.value = ''
    }
  }

  function getPathKey(path: string) {
    return normalizeAutoFolderPath(path).toLowerCase()
  }

  function splitPath(pathRaw: string) {
    const normalized = normalizeAutoFolderPath(pathRaw)
    const segments = normalized.split('/').map((segment) => segment.trim()).filter(Boolean)
    return {
      normalized,
      topLevel: segments[0] ?? 'Other',
      subfolder: segments.length > 1 ? segments.slice(1).join('/') : null,
    }
  }

  function deriveAutoFolderWarnings(plan: AutoFolderPlan) {
    const warnings: string[] = []
    if (plan.lowConfidenceCount > 0) {
      warnings.push(`${plan.lowConfidenceCount} assignment(s) are low confidence`)
    }
    if (plan.newFolderPaths.length > 0) {
      warnings.push(`${plan.newFolderPaths.length} new folder path(s) will be created`)
    }
    if (plan.excludedCount > 0) {
      warnings.push(`${plan.excludedCount} item(s) are excluded`)
    }
    return warnings
  }

  function rebuildAutoFolderDraft(assignments: AutoFolderAssignment[], lockedFolderPaths: string[]) {
    const consideredCount = autoFolderPreview?.consideredCount ?? items.filter((item) => !item.folderId).length
    const skippedCount = items.length - consideredCount
    return summarizeAutoFolderPlanDraft({
      consideredCount,
      skippedCount,
      assignments,
      existingFolderPaths: Array.from(folderPathById.values()),
      lockedFolderPaths,
    })
  }

  async function previewAutoFolderingV2() {
    if (!vaultSession) {
      setSyncMessage('Unlock vault before auto-foldering')
      return
    }

    setAutoFolderBusy(true)
    setAutoFolderError('')
    try {
      const plan = buildAutoFolderPlan(items, {
        targetMaxTopLevel: 20,
        subfolderMinItems: 4,
        maxSubfoldersPerTopLevel: 8,
        existingFolderPaths: Array.from(folderPathById.values()),
        preferences: {
          excludedItemIds: vaultSettings.autoFolderExcludedItemIds,
          lockedFolderPaths: vaultSettings.autoFolderLockedFolderPaths,
          customMappings: vaultSettings.autoFolderCustomMappings,
        },
      })
      setAutoFolderPreview(plan)
      setAutoFolderPreviewDraft(plan)
      setShowAutoFolderPreview(true)
      setAutoFolderWarnings(deriveAutoFolderWarnings(plan))
      setAutoFolderPreferencesDirty(false)
      if (plan.moveCount === 0) {
        setSyncMessage('No unfiled items available for auto-foldering')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setAutoFolderError(`Preview failed: ${detail}`)
      setSyncMessage('Auto-folder preview failed')
    } finally {
      setAutoFolderBusy(false)
    }
  }

  function updateAutoFolderPreviewAssignment(itemId: string, targetPathRaw: string) {
    if (!autoFolderPreviewDraft) return
    const { normalized, topLevel, subfolder } = splitPath(targetPathRaw)
    if (!normalized) return
    const lockedFolderPaths = autoFolderPreviewDraft.lockedFolderPaths
    const nextAssignments = autoFolderPreviewDraft.assignments.map((assignment) => {
      if (assignment.itemId !== itemId) return assignment
      const baseReasons = assignment.reasons.includes('manual override') ? assignment.reasons : [...assignment.reasons, 'manual override']
      return {
        ...assignment,
        targetPath: normalized,
        topLevel,
        subfolder,
        overridden: true,
        reasons: baseReasons,
        excluded: false,
        lockedPathApplied: lockedFolderPaths.some((path) => getPathKey(path) === getPathKey(normalized)),
      }
    })
    const nextDraft = rebuildAutoFolderDraft(nextAssignments, lockedFolderPaths)
    setAutoFolderPreviewDraft(nextDraft)
    setAutoFolderWarnings(deriveAutoFolderWarnings(nextDraft))
    setAutoFolderPreferencesDirty(true)
  }

  function excludeItemFromAutoFoldering(itemId: string, excluded: boolean) {
    if (!autoFolderPreviewDraft) return
    const nextAssignments = autoFolderPreviewDraft.assignments.map((assignment) =>
      assignment.itemId === itemId ? { ...assignment, excluded } : assignment)
    const nextDraft = rebuildAutoFolderDraft(nextAssignments, autoFolderPreviewDraft.lockedFolderPaths)
    setAutoFolderPreviewDraft(nextDraft)
    setAutoFolderWarnings(deriveAutoFolderWarnings(nextDraft))
    setAutoFolderPreferencesDirty(true)
  }

  function lockAutoFolderPath(pathRaw: string, locked: boolean) {
    if (!autoFolderPreviewDraft) return
    const normalizedPath = normalizeAutoFolderPath(pathRaw)
    if (!normalizedPath) return
    const baseSet = new Set(autoFolderPreviewDraft.lockedFolderPaths.map((path) => normalizeAutoFolderPath(path)).filter(Boolean))
    if (locked) {
      baseSet.add(normalizedPath)
    } else {
      baseSet.delete(normalizedPath)
    }
    const nextLocked = Array.from(baseSet).sort((a, b) => a.localeCompare(b))
    const nextAssignments = autoFolderPreviewDraft.assignments.map((assignment) => ({
      ...assignment,
      lockedPathApplied: nextLocked.some((path) => getPathKey(path) === getPathKey(assignment.targetPath)),
    }))
    const nextDraft = rebuildAutoFolderDraft(nextAssignments, nextLocked)
    setAutoFolderPreviewDraft(nextDraft)
    setAutoFolderWarnings(deriveAutoFolderWarnings(nextDraft))
    setAutoFolderPreferencesDirty(true)
  }

  async function saveAutoFolderPreferences() {
    const draft = autoFolderPreviewDraft ?? autoFolderPreview
    if (!draft) return

    const nextSettings = normalizeAutoFolderSettings({
      ...vaultSettings,
      autoFolderExcludedItemIds: draft.excludedItemIds,
      autoFolderLockedFolderPaths: draft.lockedFolderPaths,
      autoFolderCustomMappings: vaultSettings.autoFolderCustomMappings ?? [],
    })

    setVaultSettings(nextSettings)
    await persistPayload({ settings: nextSettings })
    setAutoFolderPreferencesDirty(false)
    setSyncMessage('Auto-folder preferences saved')
  }

  function cancelAutoFolderingPreview() {
    setShowAutoFolderPreview(false)
    setAutoFolderPreview(null)
    setAutoFolderPreviewDraft(null)
    setAutoFolderError('')
    setAutoFolderWarnings([])
    setAutoFolderPreferencesDirty(false)
  }

  async function applyAutoFolderingV2() {
    if (!vaultSession) {
      setSyncMessage('Unlock vault before auto-foldering')
      return
    }

    const draft = autoFolderPreviewDraft ?? autoFolderPreview
    if (!draft || draft.assignments.length === 0) {
      setSyncMessage('No auto-folder plan to apply')
      setShowAutoFolderPreview(false)
      return
    }

    const activeAssignments = draft.assignments.filter((assignment) => !assignment.excluded && normalizeAutoFolderPath(assignment.targetPath))
    if (activeAssignments.length === 0) {
      setSyncMessage('No unfiled items were selected for auto-foldering')
      setShowAutoFolderPreview(false)
      return
    }

    setAutoFolderBusy(true)
    setAutoFolderError('')
    try {
      let nextFolders = folders
      const pathToFolderId = new Map<string, string>()
      for (const [folderId, path] of folderPathById.entries()) {
        pathToFolderId.set(getPathKey(path), folderId)
      }

      const assignmentByItemId = new Map(activeAssignments.map((assignment) => [assignment.itemId, assignment]))
      const targetPaths = Array.from(new Set(activeAssignments.map((assignment) => normalizeAutoFolderPath(assignment.targetPath))))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))

      for (const targetPath of targetPaths) {
        const lookupKey = getPathKey(targetPath)
        if (pathToFolderId.has(lookupKey)) continue
        const ensured = ensureFolderByPath(targetPath, nextFolders)
        nextFolders = ensured.nextFolders
        if (ensured.folder) {
          pathToFolderId.set(lookupKey, ensured.folder.id)
        }
      }

      const now = new Date().toLocaleString()
      let movedCount = 0
      const nextItems = items.map((item) => {
        const assignment = assignmentByItemId.get(item.id)
        if (!assignment || item.folderId) return item
        const normalizedTargetPath = normalizeAutoFolderPath(assignment.targetPath)
        const targetFolderId = pathToFolderId.get(getPathKey(normalizedTargetPath))
        if (!targetFolderId) return item
        movedCount += 1
        return {
          ...item,
          folderId: targetFolderId,
          folder: normalizedTargetPath,
          updatedAt: now,
        }
      })

      if (movedCount === 0) {
        setSyncMessage('No unfiled items were moved')
        setShowAutoFolderPreview(false)
        setAutoFolderPreview(null)
        setAutoFolderPreviewDraft(null)
        return
      }

      const nextSettings = normalizeAutoFolderSettings({
        ...vaultSettings,
        autoFolderExcludedItemIds: draft.excludedItemIds,
        autoFolderLockedFolderPaths: draft.lockedFolderPaths,
        autoFolderCustomMappings: vaultSettings.autoFolderCustomMappings ?? [],
      })

      const createdFolderCount = Math.max(0, nextFolders.length - folders.length)
      await persistPayload({ items: nextItems, folders: nextFolders, settings: nextSettings })
      setSelectedNode('all')
      setShowAutoFolderPreview(false)
      setAutoFolderPreview(null)
      setAutoFolderPreviewDraft(null)
      setAutoFolderPreferencesDirty(false)
      setAutoFolderWarnings([])
      setSyncMessage(
        `Auto-foldered ${movedCount} item(s) into ${draft.topLevelCount} folder(s)` +
        (createdFolderCount > 0 ? `, created ${createdFolderCount} new folder(s)` : ''),
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setAutoFolderError(`Apply failed: ${detail}`)
      setSyncMessage('Auto-foldering failed')
    } finally {
      setAutoFolderBusy(false)
    }
  }

  // Backward-compatible aliases for existing UI wiring.
  const previewAutoFoldering = previewAutoFolderingV2
  const applyAutoFoldering = applyAutoFolderingV2

  async function createPasskeyIdentity() {
    try {
      await bindPasskeyOwner()
      setSyncMessage('Passkey identity bound for cloud sync owner')
    } catch {
      setSyncMessage('Passkey setup failed or not supported on this device')
    }
  }

  async function enableBiometricUnlock() {
    if (!isNativeAndroid()) {
      setSyncMessage('Biometric quick unlock is available in the Android app')
      return
    }
    if (!vaultSession) {
      setSyncMessage('Unlock vault before enabling biometrics')
      return
    }
    try {
      await enrollBiometricQuickUnlock(vaultSession)
      setBiometricEnabled(true)
      setSyncMessage('Biometric quick unlock enabled on this device')
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      const normalized = detail.toLowerCase()
      if (normalized.includes('not extractable')) {
        setSyncMessage('Vault key was loaded in a legacy session. Lock and unlock once, then try enabling biometrics again.')
        return
      }
      if (normalized.includes('not implemented')) {
        setSyncMessage('Biometric plugin is unavailable in this app build. Rebuild/reinstall the Android app.')
        return
      }
      setSyncMessage(detail ? `Biometric enrollment failed: ${detail}` : 'Biometric enrollment failed on this device')
    }
  }

  async function unlockVaultBiometric() {
    if (!isNativeAndroid()) {
      setVaultError('Biometric unlock is available in the Android app')
      return
    }
    const file = getUnlockSourceFile()
    if (!file) {
      setVaultError(storageMode === 'cloud_only' ? 'No cached cloud vault found.' : 'No local vault file found.')
      return
    }

    try {
      const session = await unlockWithBiometric(file)
      applySession(session, { resetNavigation: true })
      setPhase('ready')
      setSyncMessage('Vault unlocked with biometrics')
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      setVaultError(detail ? `Biometric unlock failed: ${detail}` : 'Biometric unlock failed. Use master password.')
    }
  }

  async function chooseLocalVaultLocation() {
    if (storageMode === 'cloud_only') {
      setSyncMessage('Switch to Local File mode before choosing a vault path')
      return
    }
    const shell = window.armadilloShell
    if (!shell?.isElectron || !shell.chooseVaultSavePath) {
      setSyncMessage('Choose location is available in Electron desktop app')
      return
    }

    try {
      const selectedPath = await shell.chooseVaultSavePath(localVaultPath || undefined)
      if (!selectedPath) {
        return
      }

      setStoredLocalVaultPath(selectedPath)
      setLocalVaultPath(selectedPath)

      if (vaultSession) {
        persistVaultSnapshot(vaultSession.file)
      }

      setSyncMessage(`Local vault path set: ${selectedPath}`)
    } catch {
      setSyncMessage('Could not choose local vault location')
    }
  }

  async function signInWithGoogle() {
    if (syncProvider === 'self_hosted') {
      setAuthMessage('Self-hosted mode does not use built-in Google sign-in. Authenticate through your self-hosted sync deployment.')
      return
    }

    const shell = window.armadilloShell

    if (shell?.isElectron) {
      if (!shell.getOAuthCallbackUrl) {
        setAuthMessage('Desktop sign-in unavailable: preload missing getOAuthCallbackUrl')
        return
      }

      try {
        setAuthMessage('Starting desktop Google sign-in...')
        const callbackUrl = await shell.getOAuthCallbackUrl()

        // Use the library's signIn which correctly stores the verifier.
        // Electron's will-navigate handler intercepts the redirect and
        // opens it in the external browser instead of navigating away.
        await signIn('google', { redirectTo: callbackUrl })
        setAuthMessage(`Google sign-in launched in browser. Waiting for callback at ${callbackUrl}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown error'
        setAuthMessage(`Desktop Google sign-in failed: ${detail}`)
        return
      }

      return
    }

    if (isNativeAndroid()) {
      setAuthMessage('Starting Android Google sign-in...')
      await startAndroidGoogleSignIn()
      return
    }

    try {
      setAuthMessage('Redirecting to Google sign-in...')
      await signIn('google', { redirectTo: window.location.origin })
    } catch {
      setAuthMessage('Google sign-in failed')
    }
  }

  async function signOutCloud() {
    if (syncProvider === 'self_hosted') {
      setSyncAuthToken(null)
      setSyncAuthContext(null)
      setIsOrgMember(false)
      if (storageMode === 'cloud_only') {
        clearCachedVaultSnapshot()
        setCloudCacheExpiresAt('')
      }
      setAuthMessage('Self-hosted token cleared for this session')
      setCloudAuthState('disconnected')
      setCloudIdentity('')
      void refreshEntitlements()
      return
    }

    try {
      await signOut()
      if (storageMode === 'cloud_only') {
        clearCachedVaultSnapshot()
        setCloudCacheExpiresAt('')
      }
      setAuthMessage('Signed out')
      setCloudAuthState('disconnected')
      setCloudIdentity('')
      setIsOrgMember(false)
      void refreshEntitlements()
    } catch {
      setAuthMessage('Sign out failed')
    }
  }

  async function pushVaultToCloudNow() {
    if (!vaultSession) {
      setSyncMessage('Unlock vault before pushing to cloud')
      return
    }
    if (!hasCapability('cloud.sync')) {
      setSyncMessage(capabilityLockReasons['cloud.sync'] ?? 'Requires Premium plan')
      return
    }
    if (syncProvider === 'self_hosted' && !hasCapability('enterprise.self_hosted')) {
      setSyncMessage(capabilityLockReasons['enterprise.self_hosted'] ?? 'Requires Enterprise plan')
      return
    }
    if (!syncConfigured()) {
      setSyncMessage(syncProvider === 'self_hosted' ? 'Self-hosted sync is not configured' : 'Convex is not configured')
      return
    }
    if (syncProvider === 'convex' && (!cloudConnected || !authToken)) {
      setSyncMessage('Sign in with Google before pushing to cloud')
      return
    }
    if (syncProvider === 'self_hosted' && !cloudConnected) {
      setSyncMessage('Authenticate with your self-hosted sync service before pushing')
      return
    }

    try {
      setSyncAuthToken(authToken ?? null)
      setSyncState('syncing')
      setSyncMessage('Pushing vault save to cloud...')
      const cloudPushFile = await buildCloudPushFile(vaultSession)
      const result = await pushRemoteSnapshot(cloudPushFile)
      if (result?.ok) {
        setSyncState('live')
        setSyncMessage(`Manual cloud push complete (${result.ownerSource})`)
      } else {
        setSyncState('error')
        setSyncMessage('Manual cloud push did not complete')
      }
    } catch (error) {
      console.error('[armadillo] manual cloud push failed:', error)
      setSyncState('error')
      setSyncMessage('Manual cloud push failed')
    }
  }

  return {
    state: {
      phase,
      unlockPassword,
      createPassword,
      confirmPassword,
      isUnlocking,
      vaultError,
      pendingVaultExists,
      items,
      storageItems,
      folders,
      trash,
      vaultSettings,
      themeSettings,
      themeSettingsDirty,
      query,
      homeSearchQuery,
      workspaceSection,
      selectedId,
      selectedStorageId,
      activePanel,
      mobileStep,
      syncState,
      syncMessage,
      isSaving,
      showPassword,
      showSettings,
      settingsCategory,
      selectedNode,
      folderFilterMode,
      storageMode,
      cloudCacheTtlHours,
      cloudCacheExpiresAt,
      syncProvider,
      cloudSyncEnabled,
      entitlementState,
      effectiveTier,
      effectiveCapabilities,
      effectiveFlags,
      entitlementStatusMessage,
      capabilityLockReasons,
      billingUrl: BILLING_URL,
      appBuildInfo: APP_BUILD_INFO,
      updateCheckResult,
      isCheckingForUpdates,
      devFlagOverrideState,
      biometricEnabled,
      authMessage,
      cloudAuthState,
      cloudIdentity,
      isOrgMember,
      localVaultPath,
      cloudVaultCandidates,
      showAllCloudSnapshots,
      windowMaximized,
      contextMenu,
      itemContextMenu,
      storageContextMenu,
      folderEditor,
      folderEditorOpen,
      folderInlineEditor,
      newFolderValue,
      newStorageFolderValue,
      treeContextMenu,
      expiryAlerts,
      expiryAlertsDismissed,
      autoFolderPreview,
      autoFolderPreviewDraft,
      showAutoFolderPreview,
      autoFolderBusy,
      autoFolderError,
      autoFolderPreferencesDirty,
      autoFolderWarnings,
      draft,
      storageDraft,
      storageFileBusy,
    },
    derived: {
      cloudConnected,
      authStatus,
      vaultTitle,
      effectivePlatform,
      folderPathById,
      expiredItems,
      expiringSoonItems,
      homeRecentItems,
      homeSearchResults,
      filtered,
      filteredStorage,
      selected,
      selectedStorage,
      folderOptions,
      storageFeatureEnabled,
      hasCapability,
      isFlagEnabled,
    },
    actions: {
      setPhase,
      setUnlockPassword,
      setCreatePassword,
      setConfirmPassword,
      setQuery,
      setWorkspaceSection: switchWorkspaceSection,
      setSelectedId,
      setSelectedStorageId,
      setActivePanel,
      setMobileStep,
      setShowPassword,
      openSettings,
      closeSettings,
      setSettingsCategory,
      setSelectedNode,
      setFolderFilterMode,
      setCloudSyncEnabled: updateCloudSyncEnabled,
      setStorageMode: updateStorageMode,
      setCloudCacheTtlHours,
      setVaultSettings,
      refreshEntitlements,
      checkForAppUpdates,
      applyManualEntitlementToken,
      clearManualEntitlementToken: clearManualEntitlementTokenAction,
      applyDevFlagOverrides,
      clearDevFlagOverrides,
      selectThemePreset,
      updateThemeTokenOverride,
      resetThemeOverrides,
      saveThemeAsCustomPreset,
      deleteThemePreset,
      setThemeMotionLevel,
      persistThemeSettings,
      setItemContextMenu,
      setStorageContextMenu,
      setContextMenu,
      setFolderEditor,
      setFolderEditorOpen,
      setFolderInlineEditor,
      setNewFolderValue,
      setNewStorageFolderValue,
      setTreeContextMenu,
      setShowAllCloudSnapshots,
      setDraftField,
      setStorageDraftField,
      openHome,
      openStorageWorkspace,
      openSmartView,
      updateHomeSearch,
      submitHomeSearch,
      openItemFromHome,
      copyToClipboard,
      minimizeDesktopWindow,
      toggleMaximizeDesktopWindow,
      closeDesktopWindow,
      createVault,
      unlockVault,
      unlockVaultBiometric,
      loadVaultFromCloud,
      chooseLocalVaultLocation,
      signInWithGoogle,
      signOutCloud,
      createItem,
      createStorageItem,
      lockVault,
      closeOpenItem,
      createSubfolder,
      startFolderInlineRename,
      updateFolderInlineEditorValue,
      cancelFolderInlineEditor,
      commitFolderInlineEditor,
      openFolderEditor,
      saveFolderEditor,
      setFolderCloudSyncExcluded,
      moveFolder,
      deleteFolderCascade,
      restoreTrashEntry,
      deleteTrashEntryPermanently,
      saveCurrentItem,
      saveCurrentStorageItem,
      setItemCloudSyncExcluded,
      setStorageItemCloudSyncExcluded,
      removeCurrentItem,
      removeItemById,
      removeCurrentStorageItem,
      removeStorageItemById,
      duplicateItem,
      copyPassword,
      attachFileToStorageDraft,
      loadStorageBlobFile,
      downloadStorageFile,
      autofillItem,
      updateSecurityQuestion,
      exportVaultFile,
      exportVaultBackupBundle,
      triggerImport,
      triggerBackupImport,
      triggerGooglePasswordImport,
      triggerKeePassImport,
      onImportFileSelected,
      onBackupBundleSelected,
      onGooglePasswordCsvSelected,
      onKeePassCsvSelected,
      previewAutoFoldering,
      cancelAutoFolderingPreview,
      applyAutoFoldering,
      previewAutoFolderingV2,
      updateAutoFolderPreviewAssignment,
      excludeItemFromAutoFoldering,
      lockAutoFolderPath,
      saveAutoFolderPreferences,
      applyAutoFolderingV2,
      createPasskeyIdentity,
      enableBiometricUnlock,
      refreshVaultFromCloudNow,
      pushVaultToCloudNow,
      persistPayload,
      emptyVaultForTesting,
      clearLocalVaultFile,
      clearCachedVaultSnapshot,
      getChildrenFolders,
      addGeneratorPreset,
      removeGeneratorPreset,
      dismissExpiryAlerts,
    },
    refs: {
      importFileInputRef,
      backupImportInputRef,
      googlePasswordImportInputRef,
      keepassImportInputRef,
      folderLongPressTimerRef,
    },
  }
}

export type VaultAppModel = ReturnType<typeof useVaultApp>

