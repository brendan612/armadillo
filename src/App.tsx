import { useEffect, useMemo, useRef, useState } from 'react'
import { useConvexAuth } from 'convex/react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { Copy, Fingerprint, Keyboard, NotebookPen, UserRound } from 'lucide-react'
import { convexConfigured, getCloudAuthStatus, listRemoteVaultsByOwner, pullRemoteSnapshot, pushRemoteSnapshot, setConvexAuthToken } from './lib/convexApi'
import { bindPasskeyOwner } from './lib/owner'
import { biometricEnrollmentExists, biometricSupported, enrollBiometricQuickUnlock, unlockWithBiometric } from './lib/biometric'
import {
  clearLocalVaultFile,
  createVaultFile,
  getLocalVaultPath,
  loadLocalVaultFile,
  parseVaultFileFromText,
  readPayloadWithSessionKey,
  rewriteVaultFile,
  saveLocalVaultFile,
  setLocalVaultPath as setStoredLocalVaultPath,
  serializeVaultFile,
  unlockVaultFile,
} from './lib/vaultFile'
import type { ArmadilloVaultFile, SecurityQuestion, VaultCategory, VaultFolder, VaultItem, VaultPayload, VaultSession, VaultSettings, VaultTrashEntry } from './types/vault'

type AppPhase = 'create' | 'unlock' | 'ready'
type Panel = 'details' | 'generator'
type MobileStep = 'nav' | 'list' | 'detail'
type SyncState = 'local' | 'syncing' | 'live' | 'error'
type CloudAuthState = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'error'
type FolderFilterMode = 'direct' | 'recursive'
type SidebarNode = 'all' | 'unfiled' | 'trash' | `folder:${string}`
type ItemContextMenuState = { itemId: string; x: number; y: number } | null

const CLOUD_SYNC_PREF_KEY = 'armadillo.cloud_sync_enabled'
const DEFAULT_FOLDER_COLOR = '#7f9cff'
const DEFAULT_FOLDER_ICON = 'folder'

/* shell sections moved inline into sidebar nav */

function getAutoPlatform(): 'web' | 'desktop' | 'mobile' {
  if (window.armadilloShell?.isElectron) return 'desktop'
  if (window.matchMedia('(max-width: 900px)').matches) return 'mobile'
  return 'web'
}

function buildEmptyItem(folderName = '', categoryName = '', folderId: string | null = null, categoryId: string | null = null): VaultItem {
  return {
    id: crypto.randomUUID(),
    title: 'New Credential',
    username: '',
    passwordMasked: '',
    urls: [],
    category: categoryName,
    folder: folderName,
    categoryId,
    folderId,
    tags: [],
    risk: 'safe',
    updatedAt: new Date().toLocaleString(),
    note: '',
    securityQuestions: [],
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

function generatePassword(length: number, includeSymbols: boolean, excludeAmbiguous: boolean) {
  const chars = `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789${includeSymbols ? '!@#$%^&*()-_=+[]{}' : ''}`
  const safeChars = excludeAmbiguous ? chars.replace(/[O0Il|`~]/g, '') : chars
  const randomBytes = new Uint8Array(length)
  crypto.getRandomValues(randomBytes)
  return Array.from(randomBytes, (byte) => safeChars[byte % safeChars.length]).join('')
}

function App() {
  const hasExistingVault = Boolean(loadLocalVaultFile())
  const [phase, setPhase] = useState<AppPhase>(hasExistingVault ? 'unlock' : 'create')
  const [vaultSession, setVaultSession] = useState<VaultSession | null>(null)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [vaultError, setVaultError] = useState('')
  const [pendingVaultExists] = useState(hasExistingVault)

  const [items, setItems] = useState<VaultItem[]>([])
  const [folders, setFolders] = useState<VaultFolder[]>([])
  const [categories, setCategories] = useState<VaultCategory[]>([])
  const [trash, setTrash] = useState<VaultTrashEntry[]>([])
  const [vaultSettings, setVaultSettings] = useState<VaultSettings>({ trashRetentionDays: 30 })
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
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(localStorage.getItem(CLOUD_SYNC_PREF_KEY) === 'true')
  const [biometricEnabled, setBiometricEnabled] = useState(() => biometricEnrollmentExists())
  const [authMessage, setAuthMessage] = useState('')
  const [cloudAuthState, setCloudAuthState] = useState<CloudAuthState>('unknown')
  const [cloudIdentity, setCloudIdentity] = useState('')
  const [localVaultPath, setLocalVaultPath] = useState(() => getLocalVaultPath())
  const [cloudVaultSnapshot, setCloudVaultSnapshot] = useState<ArmadilloVaultFile | null>(null)
  const [cloudVaultCandidates, setCloudVaultCandidates] = useState<ArmadilloVaultFile[]>([])
  const [showAllCloudSnapshots, setShowAllCloudSnapshots] = useState(false)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ folderId: string; x: number; y: number } | null>(null)
  const [itemContextMenu, setItemContextMenu] = useState<ItemContextMenuState>(null)
  const [folderEditor, setFolderEditor] = useState<VaultFolder | null>(null)
  const [folderEditorOpen, setFolderEditorOpen] = useState(false)
  const [createFolderModal, setCreateFolderModal] = useState<{ parentId: string | null } | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [newCategoryValue, setNewCategoryValue] = useState('')
  const [newFolderValue, setNewFolderValue] = useState('')

  const [genLength, setGenLength] = useState(20)
  const [includeSymbols, setIncludeSymbols] = useState(true)
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true)
  const [generatedPreview, setGeneratedPreview] = useState(() => generatePassword(20, true, true))

  const [draft, setDraft] = useState<VaultItem | null>(null)
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
  const folderLongPressTimerRef = useRef<number | null>(null)
  const previousCloudAuthStateRef = useRef<CloudAuthState>('unknown')
  const { isAuthenticated } = useConvexAuth()
  const { signIn, signOut } = useAuthActions()
  const authToken = useAuthToken()
  const cloudConnected = cloudAuthState === 'connected'
  const authStatus = useMemo(() => {
    if (!convexConfigured()) return 'Convex URL not configured'
    if (cloudConnected) return cloudIdentity ? `Connected as ${cloudIdentity}` : 'Google account connected'
    if (cloudAuthState === 'checking') return 'Google sign-in detected. Verifying cloud session...'
    if (isAuthenticated && !authToken) return 'Google authenticated, token pending'
    if (cloudAuthState === 'error') return 'Cloud auth check failed. Local vault is still available.'
    return 'Google account not connected'
  }, [cloudConnected, cloudIdentity, cloudAuthState, isAuthenticated, authToken])
  const vaultTitle = useMemo(() => {
    const rawPath = localVaultPath?.trim()
    if (!rawPath) {
      return 'vault.armadillo'
    }
    const parts = rawPath.split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] || 'vault.armadillo'
  }, [localVaultPath])

  function applySession(session: VaultSession) {
    setVaultSession(session)
    setItems(session.payload.items)
    setFolders(session.payload.folders)
    setCategories(session.payload.categories)
    setTrash(purgeExpiredTrash(session.payload.trash))
    setVaultSettings({
      trashRetentionDays: getSafeRetentionDays(session.payload.settings.trashRetentionDays),
    })
    const firstId = session.payload.items[0]?.id || ''
    setSelectedId(firstId)
    setDraft(session.payload.items[0] ?? null)
    setSelectedNode('all')
    setFolderFilterMode('direct')
  }

  useEffect(() => {
    localStorage.setItem(CLOUD_SYNC_PREF_KEY, String(cloudSyncEnabled))
  }, [cloudSyncEnabled])

  useEffect(() => {
    setConvexAuthToken(authToken ?? null)
  }, [authToken])

  useEffect(() => {
    let cancelled = false

    async function refreshCloudIdentity() {
      if (!convexConfigured()) {
        setCloudAuthState('unknown')
        setCloudIdentity('')
        return
      }

      if (!isAuthenticated) {
        setCloudAuthState('disconnected')
        setCloudIdentity('')
        return
      }

      if (!authToken) {
        setCloudAuthState('checking')
        return
      }

      setCloudAuthState('checking')
      try {
        const status = await getCloudAuthStatus()
        if (cancelled) return

        if (status?.authenticated) {
          const identityLabel = status.email || status.name || 'Google account'
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
      setAuthMessage(cloudIdentity ? `Google connected as ${cloudIdentity}` : 'Google account connected')
    } else if (cloudAuthState === 'disconnected' && (previous === 'connected' || previous === 'checking')) {
      setAuthMessage('No active Google cloud session')
    } else if (cloudAuthState === 'error') {
      setAuthMessage('Could not verify Google cloud session')
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
      if (!authToken) {
        setCloudVaultSnapshot(null)
        setCloudVaultCandidates([])
        setAuthMessage('Google session token pending. Retrying cloud check...')
        return
      }

      setConvexAuthToken(authToken)
      setAuthMessage('Checking cloud for existing vault...')
      try {
        const remote = await listRemoteVaultsByOwner()
        if (cancelled) return

        if (remote?.ownerSource === 'anonymous') {
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
            saveLocalVaultFile(latest)
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
  }, [phase, cloudAuthState, authToken])

  useEffect(() => {
    const shell = window.armadilloShell
    if (!shell?.isElectron || !shell.onOAuthCallback) {
      return
    }

    const unsubscribe = shell.onOAuthCallback((url) => {
      void completeDesktopGoogleSignIn(url)
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  useEffect(() => {
    function handlePointerDown() {
      setContextMenu(null)
      setItemContextMenu(null)
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

  function renderDesktopTitlebar() {
    if (effectivePlatform !== 'desktop') {
      return null
    }

    return (
      <div className="desktop-titlebar">
        <div className="desktop-titlebar-left">Armadillo</div>
        <div className="desktop-titlebar-center">{vaultTitle}</div>
        <div className="desktop-window-controls">
          <button className="window-control" onClick={() => void minimizeDesktopWindow()} aria-label="Minimize" title="Minimize">
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 5h8" />
            </svg>
          </button>
          <button
            className="window-control"
            onClick={() => void toggleMaximizeDesktopWindow()}
            aria-label={windowMaximized ? 'Restore' : 'Maximize'}
            title={windowMaximized ? 'Restore' : 'Maximize'}
          >
            {windowMaximized ? (
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 4h4v4H2z" />
                <path d="M4 2h4v4" />
              </svg>
            ) : (
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <rect x="2" y="2" width="6" height="6" />
              </svg>
            )}
          </button>
          <button className="window-control close" onClick={() => void closeDesktopWindow()} aria-label="Close" title="Close">
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2l6 6M8 2L2 8" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  useEffect(() => {
    let cancelled = false

    async function reconcileCloud() {
      if (!vaultSession || !cloudSyncEnabled || !convexConfigured()) {
        if (!cloudSyncEnabled) {
          setSyncState('local')
          setSyncMessage('Offline mode')
        }
        return
      }

      setSyncState('syncing')
      setSyncMessage('Syncing encrypted vault...')

      try {
        const remote = await pullRemoteSnapshot(vaultSession.file.vaultId)
        if (cancelled || !remote) {
          return
        }

        if (remote.snapshot && remote.snapshot.revision > vaultSession.file.revision) {
          try {
            const remotePayload = await readPayloadWithSessionKey(vaultSession, remote.snapshot)
            const nextSession: VaultSession = {
              file: remote.snapshot,
              payload: remotePayload,
              vaultKey: vaultSession.vaultKey,
            }
            saveLocalVaultFile(nextSession.file)
            applySession(nextSession)
            setSyncState('live')
            setSyncMessage(`Pulled remote encrypted update (${remote.ownerSource})`)
            return
          } catch {
            setSyncState('error')
            setSyncMessage('Remote save cannot be decrypted with current unlocked vault')
            return
          }
        }

        await pushRemoteSnapshot(vaultSession.file)
        setSyncState('live')
        setSyncMessage(`Encrypted sync active (${remote.ownerSource})`)
      } catch {
        if (!cancelled) {
          setSyncState('error')
          setSyncMessage('Cloud sync unavailable, local encrypted file remains canonical')
        }
      }
    }

    void reconcileCloud()

    return () => {
      cancelled = true
    }
  }, [vaultSession, cloudSyncEnabled])

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
            item.category.toLowerCase().includes(value) ||
            item.folder.toLowerCase().includes(value) ||
            item.tags.some((tag) => tag.toLowerCase().includes(value)),
        )

    return [...base]
  }, [scopedItems, query])

  const selected = items.find((item) => item.id === selectedId) ?? null

  const folderOptions = useMemo(() => {
    return folders
      .map((folder) => ({ id: folder.id, label: folderPathById.get(folder.id) ?? folder.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [folders, folderPathById])

  const categoryOptions = useMemo(() => {
    return [...categories]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => ({ id: category.id, label: category.name }))
  }, [categories])

  useEffect(() => {
    setNewCategoryValue(draft?.category ?? '')
    setNewFolderValue(draft?.folderId ? (folderPathById.get(draft.folderId) ?? draft.folder) : (draft?.folder ?? ''))
  }, [draft?.id, draft?.category, draft?.folder, draft?.folderId, folderPathById])

  useEffect(() => {
    const nextSelected = items.find((item) => item.id === selectedId) ?? null
    setDraft(nextSelected)
  }, [selectedId, items])

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
      saveLocalVaultFile(session.file)
      applySession(session)
      setPhase('ready')
      setSyncState('local')
      setSyncMessage('Encrypted local vault created (.armadillo)')
      setCreatePassword('')
      setConfirmPassword('')
    } catch {
      setVaultError('Failed to create encrypted vault.')
    }
  }

  async function unlockVault() {
    setVaultError('')
    const file = loadLocalVaultFile()
    if (!file) {
      setVaultError('No local vault file found.')
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
      setPhase('ready')
      setSyncMessage('Vault unlocked locally')
      setUnlockPassword('')
    } catch (initialError) {
      if (cloudConnected && convexConfigured()) {
        try {
          setConvexAuthToken(authToken ?? null)
          const remote = await listRemoteVaultsByOwner()
          if (remote?.ownerSource === 'anonymous') {
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
              saveLocalVaultFile(candidate)
              applySession(recovered)
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
  }

  function loadVaultFromCloud(snapshot?: ArmadilloVaultFile) {
    const chosen = snapshot || cloudVaultSnapshot
    if (!chosen) return
    saveLocalVaultFile(chosen)
    setCloudVaultSnapshot(null)
    setCloudVaultCandidates([])
    setAuthMessage('Cloud vault loaded. Enter your master password to unlock it.')
    setPhase('unlock')
  }

  function renderCloudSnapshots() {
    if (cloudVaultCandidates.length === 0) {
      return null
    }

    const latest = cloudVaultCandidates[0]
    const olderSnapshots = cloudVaultCandidates.slice(1, 6)
    const hasOlder = cloudVaultCandidates.length > 1
    const olderCount = cloudVaultCandidates.length - 1

    return (
      <section className="auth-status-card">
        <p className="muted" style={{ margin: 0 }}>Cloud save available</p>
        <button className="solid" onClick={() => loadVaultFromCloud()}>
          Load Latest Cloud Save
        </button>
        <p className="muted" style={{ margin: 0 }}>
          {`Latest revision r${latest.revision} (${new Date(latest.updatedAt).toLocaleString()})`}
        </p>
        {hasOlder && (
          <>
            <button className="ghost" onClick={() => setShowAllCloudSnapshots((prev) => !prev)}>
              {showAllCloudSnapshots ? 'Hide Older Saves' : `Show Older Saves (${olderCount})`}
            </button>
            {showAllCloudSnapshots && (
              <div className="detail-grid" style={{ gap: '.35rem' }}>
                {olderSnapshots.map((snapshot) => (
                  <button
                    key={`${snapshot.vaultId}-${snapshot.revision}-${snapshot.updatedAt}`}
                    className="ghost"
                    onClick={() => loadVaultFromCloud(snapshot)}
                  >
                    {`${snapshot.vaultId.slice(0, 8)} - r${snapshot.revision} - ${new Date(snapshot.updatedAt).toLocaleString()}`}
                  </button>
                ))}
                {olderCount > olderSnapshots.length && (
                  <p className="muted" style={{ margin: 0 }}>
                    {`Showing ${olderSnapshots.length} of ${olderCount} older saves.`}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>
    )
  }

  function renderFolderTree(parentId: string | null, depth = 0) {
    const rows = getChildrenFolders(parentId)
    if (rows.length === 0) {
      return null
    }

    return (
      <ul className="folder-tree-list">
        {rows.map((folder) => {
          const nodeKey = `folder:${folder.id}` as SidebarNode
          const directCount = items.filter((item) => item.folderId === folder.id).length
          return (
            <li key={folder.id}>
              <button
                className={`folder-tree-node ${selectedNode === nodeKey ? 'active' : ''}`}
                style={{ paddingLeft: `${0.55 + depth * 0.7}rem` }}
                onClick={() => {
                  setSelectedNode(nodeKey)
                  setMobileStep('list')
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setContextMenu({
                    folderId: folder.id,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }}
                onTouchStart={(event) => {
                  if (folderLongPressTimerRef.current) {
                    window.clearTimeout(folderLongPressTimerRef.current)
                  }
                  const touch = event.touches[0]
                  folderLongPressTimerRef.current = window.setTimeout(() => {
                    setContextMenu({
                      folderId: folder.id,
                      x: touch.clientX,
                      y: touch.clientY,
                    })
                  }, 520)
                }}
                onTouchEnd={() => {
                  if (folderLongPressTimerRef.current) {
                    window.clearTimeout(folderLongPressTimerRef.current)
                    folderLongPressTimerRef.current = null
                  }
                }}
              >
                <span className="folder-tree-label">{folder.icon === 'folder' ? '[ ]' : folder.icon} {folder.name}</span>
                <span className="folder-tree-count">{directCount}</span>
              </button>
              {renderFolderTree(folder.id, depth + 1)}
            </li>
          )
        })}
      </ul>
    )
  }

  function lockVault() {
    setVaultSession(null)
    setItems([])
    setDraft(null)
    setSelectedId('')
    setPhase('unlock')
    setSyncMessage('Vault locked')
  }

  function closeOpenItem() {
    setSelectedId('')
    setDraft(null)
    if (effectivePlatform === 'mobile') {
      setMobileStep('list')
    }
  }

  function getChildrenFolders(parentId: string | null) {
    return folders
      .filter((folder) => folder.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  function openFolderEditor(folder: VaultFolder) {
    setFolderEditor({ ...folder })
    setFolderEditorOpen(true)
    setContextMenu(null)
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
    setCreateFolderModal({ parentId })
    setNewFolderName('')
    setContextMenu(null)
  }

  async function submitCreateSubfolder() {
    if (!createFolderModal) return
    const name = newFolderName.trim()
    if (!name) return
    const now = new Date().toISOString()
    const nextFolder: VaultFolder = {
      id: crypto.randomUUID(),
      name,
      parentId: createFolderModal.parentId,
      color: DEFAULT_FOLDER_COLOR,
      icon: DEFAULT_FOLDER_ICON,
      notes: '',
      createdAt: now,
      updatedAt: now,
    }
    const nextFolders = [...folders, nextFolder]
    setCreateFolderModal(null)
    setNewFolderName('')
    setFolders(nextFolders)
    await persistPayload({ folders: nextFolders })
    setSelectedNode(`folder:${nextFolder.id}`)
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
      categories: next.categories ?? categories,
      trash: purgeExpiredTrash(next.trash ?? trash),
      settings: next.settings ?? vaultSettings,
    }
    const nextSession = await rewriteVaultFile(vaultSession, payload)
    applySession(nextSession)
    saveLocalVaultFile(nextSession.file)

    if (cloudSyncEnabled && convexConfigured()) {
      try {
        setSyncState('syncing')
        const result = await pushRemoteSnapshot(nextSession.file)
        if (result) {
          setSyncState('live')
          setSyncMessage(result.accepted ? `Encrypted sync pushed (${result.ownerSource})` : 'Sync ignored older revision')
        }
      } catch {
        setSyncState('error')
        setSyncMessage('Encrypted change saved locally; cloud sync failed')
      }
    } else {
      setSyncState('local')
      setSyncMessage('Encrypted change saved locally')
    }
  }

  function ensureCategoryByName(nameRaw: string, source = categories) {
    const name = nameRaw.trim()
    if (!name) return { category: null, nextCategories: source }
    const existing = source.find((category) => category.name.trim().toLowerCase() === name.toLowerCase())
    if (existing) return { category: existing, nextCategories: source }
    const now = new Date().toISOString()
    const created: VaultCategory = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
    }
    const nextCategories = [...source, created].sort((a, b) => a.name.localeCompare(b.name))
    return { category: created, nextCategories }
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
    const ensuredCategory = categories[0] ? { category: categories[0], nextCategories: categories } : ensureCategoryByName('General', categories)
    const selectedFolderId = selectedNode.startsWith('folder:') ? selectedNode.slice('folder:'.length) : null
    const selectedFolderPath = selectedFolderId ? (folderPathById.get(selectedFolderId) ?? '') : ''
    const item = buildEmptyItem(selectedFolderPath, ensuredCategory.category?.name ?? '', selectedFolderId, ensuredCategory.category?.id ?? null)
    const next = [item, ...items]
    setCategories(ensuredCategory.nextCategories)
    void persistPayload({ items: next, categories: ensuredCategory.nextCategories })
    setSelectedId(item.id)
    setDraft(item)
    setMobileStep('detail')
    setActivePanel('details')
  }

  async function saveCurrentItem() {
    if (!draft) return
    setIsSaving(true)
    const categoryInput = newCategoryValue.trim() || draft.category || ''
    const folderInput = newFolderValue.trim() || draft.folder || ''
    const ensuredCategory = ensureCategoryByName(categoryInput, categories)
    const ensuredFolder = ensureFolderByPath(folderInput, folders)
    const nextItem: VaultItem = {
      ...draft,
      category: ensuredCategory.category?.name ?? categoryInput,
      folder: folderInput,
      categoryId: ensuredCategory.category?.id ?? null,
      folderId: ensuredFolder.folder?.id ?? null,
      updatedAt: new Date().toLocaleString(),
    }
    const nextItems = items.map((item) => (item.id === nextItem.id ? nextItem : item))
    setFolders(ensuredFolder.nextFolders)
    setCategories(ensuredCategory.nextCategories)
    await persistPayload({
      items: nextItems,
      folders: ensuredFolder.nextFolders,
      categories: ensuredCategory.nextCategories,
    })

    setIsSaving(false)
    setNewCategoryValue('')
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

  async function onImportFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = parseVaultFileFromText(text)
      saveLocalVaultFile(parsed)
      setVaultSession(null)
      setItems([])
      setFolders([])
      setCategories([])
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

  async function createPasskeyIdentity() {
    try {
      await bindPasskeyOwner()
      setSyncMessage('Passkey identity bound for cloud sync owner')
    } catch {
      setSyncMessage('Passkey setup failed or not supported on this device')
    }
  }

  async function enableBiometricUnlock() {
    if (!vaultSession) return
    try {
      await enrollBiometricQuickUnlock(vaultSession)
      setBiometricEnabled(true)
      setSyncMessage('Biometric quick unlock enabled on this device')
    } catch {
      setSyncMessage('Biometric enrollment failed on this device')
    }
  }

  async function unlockVaultBiometric() {
    const file = loadLocalVaultFile()
    if (!file) {
      setVaultError('No local vault file found.')
      return
    }

    try {
      const session = await unlockWithBiometric(file)
      applySession(session)
      setPhase('ready')
      setSyncMessage('Vault unlocked with biometrics')
    } catch {
      setVaultError('Biometric unlock failed. Use master password.')
    }
  }

  async function chooseLocalVaultLocation() {
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
        saveLocalVaultFile(vaultSession.file)
      }

      setSyncMessage(`Local vault path set: ${selectedPath}`)
    } catch {
      setSyncMessage('Could not choose local vault location')
    }
  }

  async function signInWithGoogle() {
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

    try {
      setAuthMessage('Redirecting to Google sign-in...')
      await signIn('google', { redirectTo: window.location.origin })
    } catch {
      setAuthMessage('Google sign-in failed')
    }
  }

  async function signOutCloud() {
    try {
      await signOut()
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
    if (!convexConfigured()) {
      setSyncMessage('Convex is not configured')
      return
    }
    if (!cloudConnected || !authToken) {
      setSyncMessage('Sign in with Google before pushing to cloud')
      return
    }

    try {
      setConvexAuthToken(authToken)
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

  async function completeDesktopGoogleSignIn(callbackUrl: string) {
    try {
      const url = new URL(callbackUrl)
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')
      const code = url.searchParams.get('code')

      if (error) {
        setAuthMessage(`Google callback error: ${errorDescription || error}`)
        return
      }

      if (!code) {
        setAuthMessage('Google callback missing code')
        return
      }

      setAuthMessage('OAuth callback received. Finalizing desktop session...')
      // The verifier is already in localStorage (stored by the library's
      // signIn call that started the flow). Just pass the code to complete it.
      await (signIn as unknown as (provider: string | undefined, params: { code: string }) => Promise<unknown>)(undefined, { code })
      setAuthMessage('Google sign-in complete. Verifying session...')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error'
      setAuthMessage(`Desktop browser callback failed: ${detail}`)
    }
  }

  if (phase === 'create') {
    return (
      <div className={`app-shell platform-${effectivePlatform}`}>
        <div className="shell-noise" aria-hidden="true" />
        {renderDesktopTitlebar()}
        <main className="detail-grid auth-screen">
          <h1>Create Local Armadillo Vault</h1>
          <p className="muted">A local encrypted `.armadillo` vault file is the canonical database on this device.</p>
          <section className="auth-status-card">
            <p className="muted" style={{ margin: 0 }}>{authStatus}</p>
            {convexConfigured() && (
              <div className="auth-status-actions">
                {!cloudConnected ? (
                  <button className="ghost" onClick={() => void signInWithGoogle()} disabled={cloudAuthState === 'checking'}>
                    {cloudAuthState === 'checking' ? 'Checking Session...' : 'Sign in with Google'}
                  </button>
                ) : (
                  <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
                )}
              </div>
            )}
          </section>
          {authMessage && <p className="muted" style={{ margin: 0 }}>{authMessage}</p>}
          {renderCloudSnapshots()}
          {window.armadilloShell?.isElectron && (
            <>
              <p className="muted" style={{ margin: 0 }}>Vault file path: {localVaultPath || 'Not set'}</p>
              <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>Choose Vault Location</button>
            </>
          )}
          <label>
            Master Password
            <input
              type="password"
              name="armadillo_new_master_password"
              autoComplete="new-password"
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
            />
          </label>
          <label>
            Confirm Master Password
            <input
              type="password"
              name="armadillo_confirm_master_password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {vaultError && <p style={{ color: '#d85f5f' }}>{vaultError}</p>}
          <button className="solid" onClick={() => void createVault()}>Create Encrypted Vault</button>
          {pendingVaultExists && <button className="ghost" onClick={() => setPhase('unlock')}>Unlock Existing Vault</button>}
        </main>
      </div>
    )
  }

  if (phase === 'unlock') {
    return (
      <div className={`app-shell platform-${effectivePlatform}`}>
        <div className="shell-noise" aria-hidden="true" />
        {renderDesktopTitlebar()}
        <main className="detail-grid auth-screen">
          <h1>Unlock Armadillo Vault</h1>
          <p className="muted">Unlock your local encrypted `.armadillo` vault with your master password.</p>
          <section className="auth-status-card">
            <p className="muted" style={{ margin: 0 }}>{authStatus}</p>
            {convexConfigured() && (
              <div className="auth-status-actions">
                {!cloudConnected ? (
                  <button className="ghost" onClick={() => void signInWithGoogle()} disabled={cloudAuthState === 'checking'}>
                    {cloudAuthState === 'checking' ? 'Checking Session...' : 'Sign in with Google'}
                  </button>
                ) : (
                  <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
                )}
              </div>
            )}
          </section>
          {authMessage && <p className="muted" style={{ margin: 0 }}>{authMessage}</p>}
          {window.armadilloShell?.isElectron && (
            <>
              <p className="muted" style={{ margin: 0 }}>Vault file path: {localVaultPath || 'Not set'}</p>
              <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>Choose Vault Location</button>
            </>
          )}
          <form
            autoComplete="off"
            data-lpignore="true"
            onSubmit={(event) => {
              event.preventDefault()
              void unlockVault()
            }}
          >
            <label htmlFor="armadillo_unlock_master_password">Master Password</label>
            <div className="inline-field">
              <input
                id="armadillo_unlock_master_password"
                type="password"
                name="armadillo_unlock_master_password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
              />
              <button className="solid" type="submit">Unlock Vault</button>
              {biometricSupported() && pendingVaultExists && (
                <button
                  className="ghost biometric-inline-btn"
                  type="button"
                  aria-label="Unlock with Biometrics"
                  title="Unlock with Biometrics"
                  onClick={() => void unlockVaultBiometric()}
                >
                  <Fingerprint size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
          </form>
          {vaultError && <p style={{ color: '#d85f5f' }}>{vaultError}</p>}
          {renderCloudSnapshots()}
          <button className="ghost" onClick={triggerImport}>Import .armadillo Vault File</button>
          {!pendingVaultExists && <button className="ghost" onClick={() => setPhase('create')}>Create New Vault</button>}
        </main>
        <input
          ref={importFileInputRef}
          type="file"
          accept=".armadillo,application/octet-stream,application/json"
          style={{ display: 'none' }}
          onChange={(event) => void onImportFileSelected(event)}
        />
      </div>
    )
  }

  return (
    <div className={`app-shell platform-${effectivePlatform}`}>
      <div className="shell-noise" aria-hidden="true" />
      {renderDesktopTitlebar()}

      <header className="topbar">
        <div className="topbar-brand">
          <div className={`sync-badge sync-${syncState}`}>{syncMessage}</div>
          {authMessage && <span className="auth-message">{authMessage}</span>}
        </div>

        <div className="topbar-actions">
          <button className="solid" onClick={createItem}>+ New Credential</button>
          <button className="icon-btn" onClick={lockVault} title="Lock vault">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/></svg>
          </button>
        </div>
      </header>

      <main className="workspace density-compact">
        <aside className={`pane pane-left ${mobileStep === 'nav' ? 'mobile-active' : ''}`}>
          <div className="sidebar-header">
            <h2>Vault</h2>
            <span className="sidebar-count">{items.length} items</span>
          </div>

          <nav className="sidebar-nav">
            <button
              className={`sidebar-nav-item ${selectedNode === 'all' ? 'active' : ''}`}
              onClick={() => {
                setSelectedNode('all')
                setMobileStep('list')
              }}
            >
              <span>All Items</span>
              <span className="sidebar-badge">{items.length}</span>
            </button>
            <button
              className={`sidebar-nav-item ${selectedNode === 'unfiled' ? 'active' : ''}`}
              onClick={() => {
                setSelectedNode('unfiled')
                setMobileStep('list')
              }}
            >
              <span>Unfiled</span>
              <span className="sidebar-badge">{items.filter((item) => !item.folderId).length}</span>
            </button>
            <button
              className={`sidebar-nav-item ${selectedNode === 'trash' ? 'active' : ''}`}
              onClick={() => {
                setSelectedNode('trash')
                setMobileStep('list')
              }}
            >
              <span>Trash</span>
              <span className="sidebar-badge">{trash.length}</span>
            </button>
            <button className="sidebar-nav-item" onClick={() => createSubfolder(null)}>
              <span>+ New Folder</span>
            </button>
          </nav>

          <div className="sidebar-section">
            <h3>Folders</h3>
            <div className="folder-tree">{renderFolderTree(null)}</div>
          </div>
        </aside>

        <section className={`pane pane-middle ${mobileStep === 'list' ? 'mobile-active' : ''}`}>
          <div className="pane-head">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, URL, tag, category..." />
            {selectedNode.startsWith('folder:') && (
              <div className="toggle-row">
                <button className={folderFilterMode === 'direct' ? 'active' : ''} onClick={() => setFolderFilterMode('direct')}>Direct</button>
                <button className={folderFilterMode === 'recursive' ? 'active' : ''} onClick={() => setFolderFilterMode('recursive')}>Include Subfolders</button>
              </div>
            )}
          </div>

          {selectedNode === 'trash' ? (
            <div className="detail-grid">
              <h3>Trash</h3>
              {trash.length === 0 ? (
                <p className="muted">Trash is empty.</p>
              ) : (
                trash.map((entry) => (
                  <div key={entry.id} className="group-block">
                    <strong>{entry.kind === 'folderTreeSnapshot' ? 'Deleted folder tree' : 'Deleted item'}</strong>
                    <p className="muted" style={{ margin: 0 }}>{`Deleted ${new Date(entry.deletedAt).toLocaleString()}`}</p>
                    <p className="muted" style={{ margin: 0 }}>{`Expires ${new Date(entry.purgeAt).toLocaleString()}`}</p>
                    <div className="settings-action-list">
                      <button className="ghost" onClick={() => void restoreTrashEntry(entry.id)}>Restore</button>
                      <button className="ghost" onClick={() => void deleteTrashEntryPermanently(entry.id)}>Delete Permanently</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="detail-grid">
              <h3>Empty Vault</h3>
              <p className="muted">Create your first credential to get started.</p>
              <button className="solid" style={{ alignSelf: 'start' }} onClick={createItem}>+ Create First Credential</button>
            </div>
          ) : (
            <ul className="item-list">
              {filtered.map((item) => (
                <li
                  key={item.id}
                  className={item.id === selected?.id ? 'active' : ''}
                  onClick={() => { setSelectedId(item.id); setMobileStep('detail') }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setItemContextMenu({ itemId: item.id, x: event.clientX, y: event.clientY })
                  }}
                  onTouchStart={(event) => {
                    if (folderLongPressTimerRef.current) {
                      window.clearTimeout(folderLongPressTimerRef.current)
                    }
                    const touch = event.touches[0]
                    folderLongPressTimerRef.current = window.setTimeout(() => {
                      setItemContextMenu({ itemId: item.id, x: touch.clientX, y: touch.clientY })
                    }, 520)
                  }}
                  onTouchEnd={() => {
                    if (folderLongPressTimerRef.current) {
                      window.clearTimeout(folderLongPressTimerRef.current)
                      folderLongPressTimerRef.current = null
                    }
                  }}
                >
                  <div className="item-info">
                    <div className="item-inline-top">
                      <strong>{item.title || 'Untitled'}</strong>
                      {item.urls[0] && <p className="item-url">{item.urls[0]}</p>}
                      <div className="item-inline-actions">
                        {item.note && (
                          <button
                            className="item-action-btn"
                            title="Open notes"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedId(item.id)
                              setActivePanel('details')
                              setMobileStep('detail')
                            }}
                          >
                            <NotebookPen size={14} aria-hidden="true" />
                          </button>
                        )}
                        <button
                          className="item-action-btn"
                          title="Copy username"
                          onClick={(event) => {
                            event.stopPropagation()
                            void copyToClipboard(item.username || '', 'Username copied to clipboard', 'Clipboard copy failed')
                          }}
                        >
                          <UserRound size={14} aria-hidden="true" />
                        </button>
                        <button
                          className="item-action-btn"
                          title="Copy password"
                          onClick={(event) => {
                            event.stopPropagation()
                            void copyToClipboard(item.passwordMasked || '', 'Password copied to clipboard', 'Clipboard copy failed')
                          }}
                        >
                          <Copy size={14} aria-hidden="true" />
                        </button>
                        <button
                          className="item-action-btn"
                          title="Autofill in previous app"
                          onClick={(event) => {
                            event.stopPropagation()
                            void autofillItem(item)
                          }}
                        >
                          <Keyboard size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <p className="item-secondary">
                      <span>{item.username || 'No username'}</span>
                      <span>•</span>
                      <span>{item.passwordMasked ? '*'.repeat(Math.min(24, Math.max(8, item.passwordMasked.length))) : 'No password'}</span>
                    </p>
                  </div>
                  <div className="row-meta">
                    <span className="folder-tag">{item.folderId ? (folderPathById.get(item.folderId) ?? item.folder) : 'Unfiled'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`pane pane-right ${mobileStep === 'detail' ? 'mobile-active' : ''}`}>
          <div className="detail-head">
            <div>
              <p className="kicker">Credential Detail</p>
              <h2>{selected?.title ?? 'No item selected'}</h2>
            </div>
            <div className="detail-head-actions">
              <div className="tab-row">
                <button className={activePanel === 'details' ? 'active' : ''} onClick={() => setActivePanel('details')}>Details</button>
                <button className={activePanel === 'generator' ? 'active' : ''} onClick={() => setActivePanel('generator')}>Generator</button>
              </div>
              {selected && (
                <button className="ghost detail-close-btn" onClick={closeOpenItem} title="Close item">
                  Close
                </button>
              )}
            </div>
          </div>

          {activePanel === 'details' && draft && (
            <div className="detail-grid">
              <label>
                Title
                <input value={draft.title} onChange={(event) => setDraftField('title', event.target.value)} />
              </label>
              <label>
                Username
                <input value={draft.username} onChange={(event) => setDraftField('username', event.target.value)} />
              </label>
              <label>
                Password
                <div className="inline-field">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={draft.passwordMasked}
                    onChange={(event) => setDraftField('passwordMasked', event.target.value)}
                  />
                  <button onClick={() => setShowPassword((current) => !current)}>{showPassword ? 'Hide' : 'Reveal'}</button>
                  <button onClick={() => void copyPassword()}>Copy</button>
                </div>
              </label>
              <label>
                URLs (one per line)
                <textarea
                  value={draft.urls.join('\n')}
                  onChange={(event) =>
                    setDraftField(
                      'urls',
                      event.target.value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean),
                    )
                  }
                  rows={3}
                />
              </label>
              <div className="compact-meta-row">
                <label>
                  Category
                  <input
                    list="category-options"
                    value={newCategoryValue}
                    onChange={(event) => {
                      setNewCategoryValue(event.target.value)
                      setDraftField('category', event.target.value)
                    }}
                    placeholder="Select or create category"
                  />
                  <datalist id="category-options">
                    {categoryOptions.map((option) => (
                      <option key={option.id} value={option.label} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Folder
                  <input
                    list="folder-options"
                    value={newFolderValue}
                    onChange={(event) => {
                      setNewFolderValue(event.target.value)
                      setDraftField('folder', event.target.value)
                    }}
                    placeholder="Select or create folder path"
                  />
                  <datalist id="folder-options">
                    {folderOptions.map((option) => (
                      <option key={option.id} value={option.label} />
                    ))}
                  </datalist>
                </label>
              </div>
              <label>
                Tags (comma separated)
                <input
                  value={draft.tags.join(', ')}
                  onChange={(event) =>
                    setDraftField(
                      'tags',
                      event.target.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </label>
              <label>
                Notes
                <textarea value={draft.note} onChange={(event) => setDraftField('note', event.target.value)} rows={3} />
              </label>

              <div className="group-block">
                <h3>Security Questions</h3>
                {draft.securityQuestions.length === 0 ? (
                  <p className="muted">No security questions saved.</p>
                ) : (
                  draft.securityQuestions.map((entry, index) => (
                    <div key={`${entry.question}-${index}`} className="qa-row">
                      <input value={entry.question} onChange={(event) => updateSecurityQuestion(index, 'question', event.target.value)} />
                      <input type="password" value={entry.answer} onChange={(event) => updateSecurityQuestion(index, 'answer', event.target.value)} />
                    </div>
                  ))
                )}
                <button className="ghost" onClick={() => setDraftField('securityQuestions', [...draft.securityQuestions, { question: '', answer: '' }])}>
                  + Add Security Question
                </button>
              </div>

              <div className="meta-strip">
                <span>Updated: {draft.updatedAt}</span>
              </div>

              <div className="save-row">
                <button className="solid" onClick={() => void saveCurrentItem()} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Item'}</button>
                <button className="ghost" onClick={() => void removeCurrentItem()} disabled={isSaving}>Delete Item</button>
              </div>
            </div>
          )}

          {activePanel === 'generator' && (
            <div className="generator-panel">
              <h3>Password Generator</h3>
              <p className="muted">Policy-aware generation with ambiguity controls.</p>
              <label>
                Length: {genLength}
                <input
                  type="range"
                  min={12}
                  max={48}
                  value={genLength}
                  onChange={(event) => {
                    const nextLength = Number(event.target.value)
                    setGenLength(nextLength)
                    setGeneratedPreview(generatePassword(nextLength, includeSymbols, excludeAmbiguous))
                  }}
                />
              </label>
              <div className="switches">
                <label>
                  <input
                    type="checkbox"
                    checked={includeSymbols}
                    onChange={(event) => {
                      const next = event.target.checked
                      setIncludeSymbols(next)
                      setGeneratedPreview(generatePassword(genLength, next, excludeAmbiguous))
                    }}
                  />
                  Include symbols
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={excludeAmbiguous}
                    onChange={(event) => {
                      const next = event.target.checked
                      setExcludeAmbiguous(next)
                      setGeneratedPreview(generatePassword(genLength, includeSymbols, next))
                    }}
                  />
                  Exclude ambiguous chars
                </label>
              </div>
              <div className="preview">{generatedPreview}</div>
              <div className="gen-actions">
                <button
                  className="ghost"
                  onClick={() => {
                    setGeneratedPreview(generatePassword(genLength, includeSymbols, excludeAmbiguous))
                  }}
                >
                  Regenerate
                </button>
                <button className="solid" onClick={() => { if (draft) { setDraftField('passwordMasked', generatedPreview); setActivePanel('details') } }}>
                  Use Password
                </button>
              </div>
            </div>
          )}

        </section>
      </main>

      {contextMenu && (
        <div
          className="folder-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="ghost"
            onClick={() => {
              const target = folders.find((folder) => folder.id === contextMenu.folderId)
              if (target) {
                openFolderEditor(target)
              }
            }}
          >
            Edit Properties
          </button>
          <button className="ghost" onClick={() => createSubfolder(contextMenu.folderId)}>Add Subfolder</button>
          <button className="ghost" onClick={() => void deleteFolderCascade(contextMenu.folderId)}>Delete Folder</button>
        </div>
      )}

      {itemContextMenu && (
        <div
          className="folder-context-menu item-context-menu"
          style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="ghost"
            onClick={() => {
              setSelectedId(itemContextMenu.itemId)
              setMobileStep('detail')
              setItemContextMenu(null)
            }}
          >
            Open Item
          </button>
          <button className="ghost" onClick={() => void duplicateItem(itemContextMenu.itemId)}>Duplicate</button>
          <button
            className="ghost"
            onClick={() => {
              const item = items.find((row) => row.id === itemContextMenu.itemId)
              if (item?.username) {
                void copyToClipboard(item.username, 'Username copied to clipboard', 'Clipboard copy failed')
              }
              setItemContextMenu(null)
            }}
          >
            Copy Username
          </button>
          <button
            className="ghost"
            onClick={() => {
              const item = items.find((row) => row.id === itemContextMenu.itemId)
              if (item?.passwordMasked) {
                void copyToClipboard(item.passwordMasked, 'Password copied to clipboard', 'Clipboard copy failed')
              }
              setItemContextMenu(null)
            }}
          >
            Copy Password
          </button>
          <button
            className="ghost"
            onClick={() => {
              const item = items.find((row) => row.id === itemContextMenu.itemId)
              if (item) {
                void autofillItem(item)
              }
              setItemContextMenu(null)
            }}
          >
            Autofill Previous App
          </button>
          <button className="ghost" onClick={() => void removeItemById(itemContextMenu.itemId)}>Delete Item</button>
        </div>
      )}

      {createFolderModal && (
        <div className="settings-overlay">
          <div className="settings-backdrop" onClick={() => setCreateFolderModal(null)} />
          <div className="settings-panel">
            <div className="settings-header">
              <h2>Create Subfolder</h2>
              <button className="icon-btn" onClick={() => setCreateFolderModal(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="settings-body">
              <section className="settings-section">
                <label>
                  Folder Name
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    placeholder="e.g. Banking"
                  />
                </label>
                <div className="settings-action-list">
                  <button className="solid" onClick={() => void submitCreateSubfolder()} disabled={!newFolderName.trim()}>
                    Create Folder
                  </button>
                  <button className="ghost" onClick={() => setCreateFolderModal(null)}>Cancel</button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {folderEditorOpen && folderEditor && (
        <div className="settings-overlay">
          <div className="settings-backdrop" onClick={() => setFolderEditorOpen(false)} />
          <div className="settings-panel">
            <div className="settings-header">
              <h2>Folder Properties</h2>
              <button className="icon-btn" onClick={() => setFolderEditorOpen(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="settings-body">
              <section className="settings-section">
                <label>
                  Name
                  <input
                    value={folderEditor.name}
                    onChange={(event) => setFolderEditor((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                  />
                </label>
                <label>
                  Parent
                  <select
                    value={folderEditor.parentId ?? ''}
                    onChange={(event) =>
                      setFolderEditor((prev) => (prev ? { ...prev, parentId: event.target.value || null } : prev))
                    }
                  >
                    <option value="">(Root)</option>
                    {folders
                      .filter((folder) => folder.id !== folderEditor.id)
                      .map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folderPathById.get(folder.id) ?? folder.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Color
                  <input
                    type="color"
                    value={folderEditor.color}
                    onChange={(event) => setFolderEditor((prev) => (prev ? { ...prev, color: event.target.value } : prev))}
                  />
                </label>
                <label>
                  Icon
                  <input
                    value={folderEditor.icon}
                    onChange={(event) => setFolderEditor((prev) => (prev ? { ...prev, icon: event.target.value } : prev))}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    rows={3}
                    value={folderEditor.notes}
                    onChange={(event) => setFolderEditor((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
                  />
                </label>
                <div className="settings-action-list">
                  <button className="solid" onClick={() => void saveFolderEditor()}>Save Folder</button>
                  <button className="ghost" onClick={() => setFolderEditorOpen(false)}>Cancel</button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      <div className="mobile-nav">
        <button className={mobileStep === 'nav' ? 'active' : ''} onClick={() => setMobileStep('nav')}>Menu</button>
        <button className={mobileStep === 'list' ? 'active' : ''} onClick={() => setMobileStep('list')}>Vault</button>
        <button className={mobileStep === 'detail' ? 'active' : ''} onClick={() => setMobileStep('detail')}>Detail</button>
      </div>
      <div className="mobile-nav-spacer" />

      <input
        ref={importFileInputRef}
        type="file"
        accept=".armadillo,application/octet-stream,application/json"
        style={{ display: 'none' }}
        onChange={(event) => void onImportFileSelected(event)}
      />

      {showSettings && (
        <div className="settings-overlay">
          <div className="settings-backdrop" onClick={() => setShowSettings(false)} />
          <div className="settings-panel">
            <div className="settings-header">
              <h2>Settings</h2>
              <button className="icon-btn" onClick={() => setShowSettings(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="settings-body">
              <section className="settings-section">
                <h3>Account</h3>
                <div className="settings-identity">
                  <span className={`dot-status ${cloudConnected ? 'connected' : 'disconnected'}`} />
                  <span>{cloudConnected ? cloudIdentity || 'Google connected' : 'Not signed in'}</span>
                </div>
                <div className="settings-action-list">
                  {!cloudConnected ? (
                    <button className="ghost" onClick={() => void signInWithGoogle()} disabled={cloudAuthState === 'checking'}>
                      {cloudAuthState === 'checking' ? 'Checking Session...' : 'Sign in with Google'}
                    </button>
                  ) : (
                    <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
                  )}
                  <button className="ghost" onClick={() => void createPasskeyIdentity()}>Bind Passkey Identity</button>
                </div>
              </section>

              <div className="settings-divider" />

              <section className="settings-section">
                <h3>Cloud Sync</h3>
                <div className="settings-toggle-row">
                  <span>Auto Sync</span>
                  <button className={cloudSyncEnabled ? 'solid' : 'ghost'} onClick={() => setCloudSyncEnabled((v) => !v)}>
                    {cloudSyncEnabled ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="settings-action-list">
                  <button className="ghost" onClick={() => void pushVaultToCloudNow()}>Push Vault to Cloud Now</button>
                </div>
              </section>

              <div className="settings-divider" />

              <section className="settings-section">
                <h3>Security</h3>
                <div className="settings-action-list">
                  {biometricSupported() && (
                    <button className={biometricEnabled ? 'solid' : 'ghost'} onClick={() => void enableBiometricUnlock()}>
                      {biometricEnabled ? 'Biometric Enabled' : 'Enable Biometric'}
                    </button>
                  )}
                </div>
              </section>

              <div className="settings-divider" />

              <section className="settings-section">
                <h3>Vault</h3>
                <div className="settings-action-list">
                  <button className="ghost" onClick={exportVaultFile}>Export .armadillo</button>
                  <button className="ghost" onClick={triggerImport}>Import .armadillo</button>
                  {window.armadilloShell?.isElectron && (
                    <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>Choose Vault Location</button>
                  )}
                </div>
              </section>

              <div className="settings-divider" />

              <section className="settings-section">
                <h3>Trash</h3>
                <label>
                  Retention (days)
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={vaultSettings.trashRetentionDays}
                    onChange={(event) => {
                      const nextDays = getSafeRetentionDays(Number(event.target.value))
                      setVaultSettings({ trashRetentionDays: nextDays })
                    }}
                  />
                </label>
                <div className="settings-action-list">
                  <button
                    className="ghost"
                    onClick={() => void persistPayload({ settings: vaultSettings })}
                  >
                    Save Trash Settings
                  </button>
                  <button
                    className="ghost"
                    onClick={() => void persistPayload({ trash: [] })}
                  >
                    Empty Trash
                  </button>
                </div>
              </section>

              <div className="settings-divider" />

              <section className="settings-section">
                <h3>Danger Zone</h3>
                <div className="settings-action-list">
                  <button className="ghost" onClick={() => { clearLocalVaultFile(); window.location.reload() }}>Reset Local Vault</button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
