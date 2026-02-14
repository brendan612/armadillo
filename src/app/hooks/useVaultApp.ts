import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ConvexHttpClient } from 'convex/browser'
import { useConvexAuth } from 'convex/react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { getCloudAuthStatus, listRemoteVaultsByOwner, pullRemoteSnapshot, pushRemoteSnapshot, setSyncAuthToken, subscribeToVaultUpdates, syncConfigured, syncProvider } from '../../lib/syncClient'
import { convexAuthStorageNamespace, convexUrl } from '../../lib/convexClient'
import { bindPasskeyOwner } from '../../lib/owner'
import { biometricEnrollmentExists, enrollBiometricQuickUnlock, unlockWithBiometric } from '../../lib/biometric'
import { getAutoPlatform, isNativeAndroid } from '../../shared/utils/platform'
import { parseGooglePasswordCsv, type GooglePasswordCsvEntry } from '../../shared/utils/googlePasswordCsv'
import {
  buildAutoFolderPlan,
  normalizeAutoFolderPath,
  summarizeAutoFolderPlanDraft,
  type AutoFolderAssignment,
  type AutoFolderPlan,
} from '../../shared/utils/autoFoldering'
import { LocalNotifications } from '@capacitor/local-notifications'
import AutofillBridge from '../../plugins/autofillBridge'
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
import type { ArmadilloVaultFile, SecurityQuestion, VaultFolder, VaultItem, VaultPayload, VaultSession, VaultSettings, VaultStorageMode, VaultTrashEntry } from '../../types/vault'

type AppPhase = 'create' | 'unlock' | 'ready'
type Panel = 'details'
type MobileStep = 'nav' | 'list' | 'detail'
type SyncState = 'local' | 'syncing' | 'live' | 'error'
type CloudAuthState = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'error'
type FolderFilterMode = 'direct' | 'recursive'
type SidebarNode = 'all' | 'unfiled' | 'trash' | `folder:${string}`
type ItemContextMenuState = { itemId: string; x: number; y: number } | null
type FolderContextMenuState = { folderId: string; x: number; y: number } | null
type FolderInlineEditorState =
  | { mode: 'create'; parentId: string | null; value: string }
  | { mode: 'rename'; folderId: string; parentId: string | null; value: string }

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

/* shell sections moved inline into sidebar nav */

function buildEmptyItem(folderName = '', folderId: string | null = null): VaultItem {
  return {
    id: crypto.randomUUID(),
    title: 'New Credential',
    username: '',
    passwordMasked: '',
    urls: [],
    folder: folderName,
    folderId,
    tags: [],
    risk: 'safe',
    updatedAt: new Date().toLocaleString(),
    note: '',
    securityQuestions: [],
    passwordExpiryDate: null,
  }
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
  now.setHours(0, 0, 0, 0)
  const soonThreshold = new Date(now)
  soonThreshold.setDate(soonThreshold.getDate() + 7)

  const alerts: ExpiryAlert[] = []
  for (const item of items) {
    if (!item.passwordExpiryDate) continue
    const expiry = new Date(item.passwordExpiryDate)
    if (isNaN(expiry.getTime())) continue
    expiry.setHours(0, 0, 0, 0)
    if (expiry <= now) {
      alerts.push({ itemId: item.id, title: item.title, status: 'expired' })
    } else if (expiry <= soonThreshold) {
      alerts.push({ itemId: item.id, title: item.title, status: 'expiring' })
    }
  }
  return alerts
}

function inferImportedItemTitle(entry: GooglePasswordCsvEntry, rowNumber: number) {
  const name = entry.name.trim()
  if (name) return name
  const url = entry.url.trim()
  if (url) {
    try {
      const host = new URL(url).hostname.trim().replace(/^www\./i, '')
      if (host) return host
    } catch {
      // Keep fallback order if URL is not valid.
    }
  }
  const username = entry.username.trim()
  if (username) return username
  return `Imported Credential ${rowNumber}`
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
  return {
    ...settings,
    autoFolderExcludedItemIds: uniqueNonEmptyStrings(settings.autoFolderExcludedItemIds),
    autoFolderLockedFolderPaths: uniqueNonEmptyStrings(settings.autoFolderLockedFolderPaths).map((path) => normalizeAutoFolderPath(path)).filter(Boolean),
    autoFolderCustomMappings: normalizeAutoFolderMappings(settings.autoFolderCustomMappings),
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
  const [folders, setFolders] = useState<VaultFolder[]>([])
  const [trash, setTrash] = useState<VaultTrashEntry[]>([])
  const [vaultSettings, setVaultSettings] = useState<VaultSettings>({
    trashRetentionDays: 30,
    generatorPresets: [],
    autoFolderExcludedItemIds: [],
    autoFolderLockedFolderPaths: [],
    autoFolderCustomMappings: [],
  })
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [activePanel, setActivePanel] = useState<Panel>('details')
  const [mobileStep, setMobileStep] = useState<MobileStep>('nav')
  const [syncState, setSyncState] = useState<SyncState>('local')
  const [syncMessage, setSyncMessage] = useState('Offline mode')
  const [isSaving, setIsSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedNode, setSelectedNode] = useState<SidebarNode>('all')
  const [folderFilterMode, setFolderFilterMode] = useState<FolderFilterMode>('direct')
  const [storageMode, setStorageMode] = useState<VaultStorageMode>(initialStorageMode)
  const [cloudCacheTtlHours, setCloudCacheTtlHours] = useState(() => getCloudCacheTtlHours())
  const [cloudCacheExpiresAt, setCloudCacheExpiresAt] = useState(() => getCachedVaultExpiresAt())
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(localStorage.getItem(CLOUD_SYNC_PREF_KEY) === 'true')
  const [biometricEnabled, setBiometricEnabled] = useState(() => biometricEnrollmentExists())
  const [authMessage, setAuthMessage] = useState('')
  const [cloudAuthState, setCloudAuthState] = useState<CloudAuthState>('unknown')
  const [cloudIdentity, setCloudIdentity] = useState('')
  const [localVaultPath, setLocalVaultPath] = useState(() => (initialStorageMode === 'cloud_only' ? '' : getLocalVaultPath()))
  const [cloudVaultSnapshot, setCloudVaultSnapshot] = useState<ArmadilloVaultFile | null>(null)
  const [cloudVaultCandidates, setCloudVaultCandidates] = useState<ArmadilloVaultFile[]>([])
  const [showAllCloudSnapshots, setShowAllCloudSnapshots] = useState(false)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [contextMenu, setContextMenu] = useState<FolderContextMenuState>(null)
  const [itemContextMenu, setItemContextMenu] = useState<ItemContextMenuState>(null)
  const [folderEditor, setFolderEditor] = useState<VaultFolder | null>(null)
  const [folderEditorOpen, setFolderEditorOpen] = useState(false)
  const [folderInlineEditor, setFolderInlineEditor] = useState<FolderInlineEditorState | null>(null)
  const [newFolderValue, setNewFolderValue] = useState('')

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

  const [draft, setDraft] = useState<VaultItem | null>(null)
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
  const googlePasswordImportInputRef = useRef<HTMLInputElement | null>(null)
  const folderLongPressTimerRef = useRef<number | null>(null)
  const previousCloudAuthStateRef = useRef<CloudAuthState>('unknown')
  const cloudRefreshInFlightRef = useRef(false)
  const { isAuthenticated } = useSafeConvexAuth()
  const { signIn, signOut } = useSafeAuthActions()
  const authToken = useSafeAuthToken()
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

  function applySession(session: VaultSession) {
    setVaultSession(session)
    setItems(session.payload.items)
    setFolders(session.payload.folders)
    setTrash(purgeExpiredTrash(session.payload.trash))
    const settings = normalizeAutoFolderSettings({
      ...session.payload.settings,
      trashRetentionDays: getSafeRetentionDays(session.payload.settings.trashRetentionDays),
      generatorPresets: session.payload.settings.generatorPresets ?? [],
    })
    setVaultSettings(settings)
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
    setSelectedId(firstId)
    setDraft(session.payload.items[0] ?? null)
    setSelectedNode('all')
    setFolderFilterMode('direct')
    syncCredentialsToNative(session.payload.items)
  }

  function syncCredentialsToNative(vaultItems: VaultItem[]) {
    if (!isNativeAndroid()) return
    const credentials = vaultItems.map((item) => ({
      id: item.id,
      title: item.title,
      username: item.username || '',
      password: item.passwordMasked || '',
      urls: item.urls,
    }))
    AutofillBridge.syncCredentials({ credentials }).catch(() => {
      /* non-blocking */
    })
  }

  function clearNativeCredentials() {
    if (!isNativeAndroid()) return
    AutofillBridge.clearCredentials().catch(() => {
      /* non-blocking */
    })
  }

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

  function updateCloudSyncEnabled(value: boolean | ((value: boolean) => boolean)) {
    const nextValue = typeof value === 'function' ? value(cloudSyncEnabled) : value
    if (storageMode === 'cloud_only' && !nextValue) {
      setSyncMessage('Cloud-only mode requires cloud sync to stay enabled')
      return
    }
    setCloudSyncEnabled(nextValue)
  }

  function updateStorageMode(nextMode: VaultStorageMode) {
    if (nextMode === storageMode) return

    if (nextMode === 'cloud_only') {
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
    setSyncAuthToken(authToken ?? null)
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
  }, [phase, cloudAuthState, authToken, persistVaultSnapshot])

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
          const nextSession: VaultSession = {
            file: remoteSnapshot,
            payload: remotePayload,
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
        const pushResult = await pushRemoteSnapshot(activeSession.file)
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
  }, [vaultSession, cloudSyncEnabled, storageMode, applySession, persistVaultSnapshot])

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

  const scopedItems = useMemo(() => {
    if (selectedNode === 'all') return items
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
  }, [items, selectedNode, folderFilterMode, folders])

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    const base = !value
      ? scopedItems
      : scopedItems.filter(
          (item) =>
            item.title.toLowerCase().includes(value) ||
            item.username.toLowerCase().includes(value) ||
            item.urls.some((url) => url.toLowerCase().includes(value)) ||
            item.folder.toLowerCase().includes(value) ||
            item.tags.some((tag) => tag.toLowerCase().includes(value)),
        )

    return [...base]
  }, [scopedItems, query])

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const selected = itemById.get(selectedId) ?? null

  const folderOptions = useMemo(() => {
    return folders
      .map((folder) => ({ id: folder.id, label: folderPathById.get(folder.id) ?? folder.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [folders, folderPathById])

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

  function setDraftField<K extends keyof VaultItem>(key: K, value: VaultItem[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
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
      applySession(session)
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
        applySession(session)
        await ensureUnlockVisualFeedback()
        setPhase('ready')
        setSyncMessage(storageMode === 'cloud_only' ? 'Vault unlocked from encrypted cloud cache' : 'Vault unlocked locally')
        setUnlockPassword('')
      } catch (initialError) {
        if (cloudConnected && syncConfigured()) {
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
                applySession(recovered)
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
    setDraft(null)
    setSelectedId('')
    setPhase('unlock')
    setSyncMessage('Vault locked')
    clearNativeCredentials()
  }

  function closeOpenItem() {
    setSelectedId('')
    setDraft(null)
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
      ? { ...folderEditor, parentId: nextParentId, updatedAt: new Date().toISOString() }
      : folder))
    setFolderEditorOpen(false)
    setFolderEditor(null)
    await persistPayload({ folders: updated })
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
    const impactedFolders = folders.filter((folder) => descendantIds.has(folder.id))
    const confirmed = window.confirm(`Delete folder "${target.name}" and all ${impactedFolders.length - 1} subfolders with ${impactedItems.length} item(s)?`)
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
      },
    }

    const nextFolders = folders.filter((folder) => !descendantIds.has(folder.id))
    const nextItems = items.filter((item) => !(item.folderId && descendantIds.has(item.folderId)))
    const nextTrashEntries = [nextTrash, ...trash]
    setContextMenu(null)
    setSelectedNode('all')
    setSelectedId(nextItems[0]?.id ?? '')
    setDraft(nextItems[0] ?? null)
    await persistPayload({ folders: nextFolders, items: nextItems, trash: nextTrashEntries })
  }

  async function restoreTrashEntry(entryId: string) {
    const entry = trash.find((row) => row.id === entryId)
    if (!entry || entry.kind !== 'folderTreeSnapshot') return
    const payload = (entry.payload && typeof entry.payload === 'object' ? entry.payload : {}) as {
      folders?: VaultFolder[]
      items?: VaultItem[]
    }
    const restoredFolders = Array.isArray(payload.folders) ? payload.folders : []
    const restoredItems = Array.isArray(payload.items) ? payload.items : []
    const folderIds = new Set(folders.map((folder) => folder.id))
    const itemIds = new Set(items.map((item) => item.id))
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
    const nextTrashEntries = trash.filter((row) => row.id !== entryId)
    await persistPayload({ folders: nextFolders, items: nextItems, trash: nextTrashEntries })
  }

  async function deleteTrashEntryPermanently(entryId: string) {
    await persistPayload({ trash: trash.filter((row) => row.id !== entryId) })
  }

  async function persistPayload(next: Partial<VaultPayload>) {
    if (!vaultSession) {
      return
    }
    const payload: VaultPayload = {
      schemaVersion: vaultSession.payload.schemaVersion,
      items: next.items ?? items,
      folders: next.folders ?? folders,
      trash: purgeExpiredTrash(next.trash ?? trash),
      settings: next.settings ?? vaultSettings,
    }
    const nextSession = await rewriteVaultFile(vaultSession, payload)
    applySession(nextSession)
    persistVaultSnapshot(nextSession.file)

    if (cloudSyncEnabled && syncConfigured()) {
      try {
        setSyncState('syncing')
        const result = await pushRemoteSnapshot(nextSession.file)
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
      setSyncMessage(storageMode === 'cloud_only' ? 'Encrypted change cached locally' : 'Encrypted change saved locally')
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
      }
      localFolders.push(created)
      latest = created
      currentParentId = created.id
    }

    return { folder: latest, nextFolders: localFolders }
  }

  function createItem() {
    const selectedFolderId = selectedNode.startsWith('folder:') ? selectedNode.slice('folder:'.length) : null
    const selectedFolderPath = selectedFolderId ? (folderPathById.get(selectedFolderId) ?? '') : ''
    const item = buildEmptyItem(selectedFolderPath, selectedFolderId)
    const next = [item, ...items]
    void persistPayload({ items: next })
    setSelectedId(item.id)
    setDraft(item)
    setMobileStep('detail')
    setActivePanel('details')
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
    const nextItems = items.map((item) => (item.id === nextItem.id ? nextItem : item))
    setFolders(ensuredFolder.nextFolders)
    await persistPayload({
      items: nextItems,
      folders: ensuredFolder.nextFolders,
    })

    setIsSaving(false)
    setNewFolderValue('')
  }

  async function removeCurrentItem() {
    if (!draft) return
    const deletingId = draft.id
    const remaining = items.filter((item) => item.id !== deletingId)
    await persistPayload({ items: remaining })
    setSelectedId(remaining[0]?.id || '')
  }

  async function removeItemById(itemId: string) {
    const remaining = items.filter((item) => item.id !== itemId)
    await persistPayload({ items: remaining })
    setSelectedId((current) => (current === itemId ? (remaining[0]?.id || '') : current))
    setItemContextMenu(null)
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
    const nextItems = [duplicated, ...items]
    await persistPayload({ items: nextItems })
    setSelectedId(duplicated.id)
    setDraft(duplicated)
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

  function triggerImport() {
    importFileInputRef.current?.click()
  }

  function triggerGooglePasswordImport() {
    googlePasswordImportInputRef.current?.click()
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
      setFolders([])
      setTrash([])
      setDraft(null)
      setSelectedId('')
      setPhase('unlock')
      setSyncMessage('Encrypted vault imported. Unlock with master password.')
    } catch {
      setSyncMessage('Failed to import vault file')
    }

    event.currentTarget.value = ''
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
          title: inferImportedItemTitle(entry, index + 1),
          username,
          passwordMasked: password,
          urls: url ? [url] : [],
          folder: '',
          folderId: null,
          tags: ['imported', 'google-password-manager'],
          risk: 'safe',
          updatedAt: now,
          note,
          securityQuestions: [],
          passwordExpiryDate: null,
        }
      })

      const nextItems = [...importedItems, ...items]
      await persistPayload({
        items: nextItems,
      })

      setSelectedNode('all')
      setSelectedId(importedItems[0].id)
      setDraft(importedItems[0])
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
      applySession(session)
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
      if (storageMode === 'cloud_only') {
        clearCachedVaultSnapshot()
        setCloudCacheExpiresAt('')
      }
      setAuthMessage('Self-hosted token cleared for this session')
      setCloudAuthState('disconnected')
      setCloudIdentity('')
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
    } catch {
      setAuthMessage('Sign out failed')
    }
  }

  async function pushVaultToCloudNow() {
    if (!vaultSession) {
      setSyncMessage('Unlock vault before pushing to cloud')
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
      const result = await pushRemoteSnapshot(vaultSession.file)
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
      folders,
      trash,
      vaultSettings,
      query,
      selectedId,
      activePanel,
      mobileStep,
      syncState,
      syncMessage,
      isSaving,
      showPassword,
      showSettings,
      selectedNode,
      folderFilterMode,
      storageMode,
      cloudCacheTtlHours,
      cloudCacheExpiresAt,
      syncProvider,
      cloudSyncEnabled,
      biometricEnabled,
      authMessage,
      cloudAuthState,
      cloudIdentity,
      localVaultPath,
      cloudVaultCandidates,
      showAllCloudSnapshots,
      windowMaximized,
      contextMenu,
      itemContextMenu,
      folderEditor,
      folderEditorOpen,
      folderInlineEditor,
      newFolderValue,
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
    },
    derived: {
      cloudConnected,
      authStatus,
      vaultTitle,
      effectivePlatform,
      folderPathById,
      filtered,
      selected,
      folderOptions,
    },
    actions: {
      setPhase,
      setUnlockPassword,
      setCreatePassword,
      setConfirmPassword,
      setQuery,
      setSelectedId,
      setActivePanel,
      setMobileStep,
      setShowPassword,
      setShowSettings,
      setSelectedNode,
      setFolderFilterMode,
      setCloudSyncEnabled: updateCloudSyncEnabled,
      setStorageMode: updateStorageMode,
      setCloudCacheTtlHours,
      setVaultSettings,
      setItemContextMenu,
      setContextMenu,
      setFolderEditor,
      setFolderEditorOpen,
      setFolderInlineEditor,
      setNewFolderValue,
      setTreeContextMenu,
      setShowAllCloudSnapshots,
      setDraftField,
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
      lockVault,
      closeOpenItem,
      createSubfolder,
      startFolderInlineRename,
      updateFolderInlineEditorValue,
      cancelFolderInlineEditor,
      commitFolderInlineEditor,
      openFolderEditor,
      saveFolderEditor,
      moveFolder,
      deleteFolderCascade,
      restoreTrashEntry,
      deleteTrashEntryPermanently,
      saveCurrentItem,
      removeCurrentItem,
      removeItemById,
      duplicateItem,
      copyPassword,
      autofillItem,
      updateSecurityQuestion,
      exportVaultFile,
      triggerImport,
      triggerGooglePasswordImport,
      onImportFileSelected,
      onGooglePasswordCsvSelected,
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
      clearLocalVaultFile,
      clearCachedVaultSnapshot,
      getChildrenFolders,
      addGeneratorPreset,
      removeGeneratorPreset,
      dismissExpiryAlerts,
    },
    refs: {
      importFileInputRef,
      googlePasswordImportInputRef,
      folderLongPressTimerRef,
    },
  }
}

export type VaultAppModel = ReturnType<typeof useVaultApp>

