import { useEffect, useMemo, useRef, useState } from 'react'
import { useConvexAuth } from 'convex/react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { convexConfigured, getCloudAuthStatus, listRemoteVaultsByOwner, pullRemoteSnapshot, pushRemoteSnapshot, setConvexAuthToken } from './lib/convexApi'
import { bindPasskeyOwner, getOwnerMode } from './lib/owner'
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
import type { ArmadilloVaultFile, RiskState, SecurityQuestion, VaultItem, VaultSession } from './types/vault'

type AppPhase = 'create' | 'unlock' | 'ready'
type Panel = 'details' | 'generator' | 'security'
type MobileStep = 'nav' | 'list' | 'detail'
type SyncState = 'local' | 'syncing' | 'live' | 'error'
type CloudAuthState = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'error'

const CLOUD_SYNC_PREF_KEY = 'armadillo.cloud_sync_enabled'
const riskOrder: RiskState[] = ['exposed', 'reused', 'weak', 'stale', 'safe']

/* shell sections moved inline into sidebar nav */

function riskLabel(risk: RiskState) {
  switch (risk) {
    case 'safe':
      return 'Safe'
    case 'weak':
      return 'Weak'
    case 'reused':
      return 'Reused'
    case 'exposed':
      return 'Exposed'
    case 'stale':
      return 'Stale'
  }
}

function getAutoPlatform(): 'web' | 'desktop' | 'mobile' {
  if (window.armadilloShell?.isElectron) return 'desktop'
  if (window.matchMedia('(max-width: 900px)').matches) return 'mobile'
  return 'web'
}

function buildEmptyItem(): VaultItem {
  return {
    id: crypto.randomUUID(),
    title: 'New Credential',
    username: '',
    passwordMasked: '',
    urls: [],
    category: 'General',
    folder: 'Personal',
    tags: [],
    risk: 'safe',
    updatedAt: new Date().toLocaleString(),
    note: '',
    securityQuestions: [],
  }
}

function generatePassword(length: number, includeSymbols: boolean, excludeAmbiguous: boolean) {
  const chars = `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789${includeSymbols ? '!@#$%^&*()-_=+[]{}' : ''}`
  const safeChars = excludeAmbiguous ? chars.replace(/[O0Il|`~]/g, '') : chars
  const randomBytes = new Uint8Array(length)
  crypto.getRandomValues(randomBytes)
  return Array.from(randomBytes, (byte) => safeChars[byte % safeChars.length]).join('')
}

function SecurityMetric({ count, label, detail, tone }: { count: number; label: string; detail: string; tone: string }) {
  return (
    <li>
      <span className={`security-metric ${tone}`}>{count}</span>
      <div>
        <strong>{label}</strong>
        <p className="muted" style={{ margin: 0 }}>{detail}</p>
      </div>
    </li>
  )
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
  const [query, setQuery] = useState('')
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact')
  const [selectedId, setSelectedId] = useState('')
  const [activePanel, setActivePanel] = useState<Panel>('details')
  const [mobileStep, setMobileStep] = useState<MobileStep>('nav')
  const [syncState, setSyncState] = useState<SyncState>('local')
  const [syncMessage, setSyncMessage] = useState('Offline mode')
  const [isSaving, setIsSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(localStorage.getItem(CLOUD_SYNC_PREF_KEY) === 'true')
  const [ownerMode, setOwnerMode] = useState(getOwnerMode())
  const [biometricEnabled, setBiometricEnabled] = useState(() => biometricEnrollmentExists())
  const [authMessage, setAuthMessage] = useState('')
  const [cloudAuthState, setCloudAuthState] = useState<CloudAuthState>('unknown')
  const [cloudIdentity, setCloudIdentity] = useState('')
  const [localVaultPath, setLocalVaultPath] = useState(() => getLocalVaultPath())
  const [cloudVaultSnapshot, setCloudVaultSnapshot] = useState<ArmadilloVaultFile | null>(null)
  const [cloudVaultCandidates, setCloudVaultCandidates] = useState<ArmadilloVaultFile[]>([])
  const [debugStatusLines, setDebugStatusLines] = useState<string[]>([])

  const [genLength, setGenLength] = useState(20)
  const [includeSymbols, setIncludeSymbols] = useState(true)
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true)
  const [generatedPreview, setGeneratedPreview] = useState(() => generatePassword(20, true, true))

  const [draft, setDraft] = useState<VaultItem | null>(null)
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
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

  function pushDebug(message: string) {
    const timestamp = new Date().toLocaleTimeString()
    setDebugStatusLines((prev) => [...prev.slice(-5), `${timestamp} ${message}`])
  }

  function applySession(session: VaultSession) {
    setVaultSession(session)
    setItems(session.payload.items)
    const firstId = session.payload.items[0]?.id || ''
    setSelectedId(firstId)
    setDraft(session.payload.items[0] ?? null)
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
        console.log('[cloud-auth] /api/auth/status response', status)
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
        pushDebug('[cloud] token pending')
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
          pushDebug('[cloud] owner resolved to anonymous')
          return
        }

        if ((remote?.snapshots?.length || 0) > 0) {
          const snapshots = remote?.snapshots || []
          const latest = snapshots[0]
          setCloudVaultSnapshot(latest)
          setCloudVaultCandidates(snapshots)
          pushDebug(`[cloud] snapshots found: ${snapshots.length}, latest v=${latest.vaultId} r=${latest.revision}`)

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
          pushDebug('[cloud] no snapshot found')
        }
      } catch (err) {
        console.error('[armadillo] cloud vault check failed:', err)
        const detail = err instanceof Error ? err.message : String(err)
        if (!cancelled) {
          setCloudVaultSnapshot(null)
          setCloudVaultCandidates([])
          setAuthMessage(`Cloud vault check failed: ${detail}`)
          pushDebug(`[cloud] check failed: ${detail}`)
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
            setSyncMessage('Remote snapshot cannot be decrypted with current unlocked vault')
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

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    const base = !value
      ? items
      : items.filter(
          (item) =>
            item.title.toLowerCase().includes(value) ||
            item.username.toLowerCase().includes(value) ||
            item.urls.some((url) => url.toLowerCase().includes(value)) ||
            item.category.toLowerCase().includes(value) ||
            item.tags.some((tag) => tag.toLowerCase().includes(value)),
        )

    return [...base].sort((a, b) => riskOrder.indexOf(a.risk) - riskOrder.indexOf(b.risk))
  }, [items, query])

  const selected = filtered.find((item) => item.id === selectedId) ?? null
  const effectivePlatform = getAutoPlatform()

  const folders = useMemo(() => {
    const set = new Set(items.map((item) => item.folder).filter(Boolean))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [items])

  const categories = useMemo(() => {
    const set = new Set(items.map((item) => item.category).filter(Boolean))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [items])

  const securityCounts = useMemo(() => {
    const exposed = items.filter((i) => i.risk === 'exposed').length
    const reused = items.filter((i) => i.risk === 'reused').length
    const weak = items.filter((i) => i.risk === 'weak').length
    const stale = items.filter((i) => i.risk === 'stale').length
    return { exposed, reused, weak, stale }
  }, [items])

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
    console.log('[unlock] attempting local vault', {
      vaultId: file.vaultId,
      revision: file.revision,
      kdf: file.kdf.algorithm,
      updatedAt: file.updatedAt,
    })
    pushDebug(`[unlock] trying local v=${file.vaultId} r=${file.revision} kdf=${file.kdf.algorithm}`)

    const passwordCandidates = buildPasswordCandidates(unlockPassword)
    pushDebug(`[unlock] password variants: ${passwordCandidates.length}`)

    try {
      let session: VaultSession | null = null
      let localLastError: unknown = null
      for (const passwordCandidate of passwordCandidates) {
        try {
          session = await unlockVaultFile(file, passwordCandidate)
          break
        } catch (error) {
          localLastError = error
          // Try next password candidate.
        }
      }
      if (!session) {
        if (localLastError instanceof Error) {
          pushDebug(`[unlock] local error: ${localLastError.name}: ${localLastError.message}`)
        }
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
          console.log('[unlock] cloud recovery list response', {
            ownerSource: remote?.ownerSource,
            count: remote?.snapshots?.length ?? 0,
          })
          pushDebug(`[unlock] recovery owner=${remote?.ownerSource ?? 'none'} candidates=${remote?.snapshots?.length ?? 0}`)
          if (remote?.ownerSource === 'anonymous') {
            setAuthMessage('Cloud recovery resolved as anonymous owner. Sign out and sign in with Google again.')
            throw new Error('Cloud owner resolved to anonymous during signed-in recovery')
          }
          const candidates = (remote?.snapshots || []).filter(
            (candidate) => candidate.vaultId !== file.vaultId || candidate.revision !== file.revision,
          )
          pushDebug(`[unlock] candidate list after excluding local: ${candidates.length}`)

          for (const candidate of candidates) {
            pushDebug(`[unlock] trying cloud candidate v=${candidate.vaultId} r=${candidate.revision}`)
            try {
              let recovered: VaultSession | null = null
              let candidateLastError: unknown = null
              for (const passwordCandidate of passwordCandidates) {
                try {
                  recovered = await unlockVaultFile(candidate, passwordCandidate)
                  break
                } catch (error) {
                  candidateLastError = error
                  // Try next password candidate.
                }
              }
              if (!recovered) {
                if (candidateLastError instanceof Error) {
                  pushDebug(`[unlock] candidate error: ${candidateLastError.name}: ${candidateLastError.message}`)
                }
                throw new Error('Candidate failed for all password variants')
              }
              saveLocalVaultFile(candidate)
              applySession(recovered)
              setPhase('ready')
              setSyncMessage('Vault unlocked from cloud snapshot')
              setAuthMessage('Recovered using a matching cloud vault snapshot')
              pushDebug(`[unlock] recovered from cloud v=${candidate.vaultId} r=${candidate.revision}`)
              setUnlockPassword('')
              return
            } catch {
              // Try next candidate.
            }
          }
        } catch (recoveryError) {
          console.error('[armadillo] cloud unlock recovery failed:', recoveryError)
          pushDebug('[unlock] recovery request failed')
        }
      }

      console.error('[armadillo] unlock failed:', initialError)
      pushDebug('[unlock] failed for all candidates')
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
    pushDebug(`[cloud] loaded v=${chosen.vaultId} r=${chosen.revision}`)
    setPhase('unlock')
  }

  function lockVault() {
    setVaultSession(null)
    setItems([])
    setDraft(null)
    setSelectedId('')
    setPhase('unlock')
    setSyncMessage('Vault locked')
  }

  async function persistItems(nextItems: VaultItem[]) {
    if (!vaultSession) {
      return
    }

    const nextSession = await rewriteVaultFile(vaultSession, { items: nextItems })
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

  function createItem() {
    const item = buildEmptyItem()
    const next = [item, ...items]
    void persistItems(next)
    setSelectedId(item.id)
    setDraft(item)
    setMobileStep('detail')
    setActivePanel('details')
  }

  async function saveCurrentItem() {
    if (!draft) return
    setIsSaving(true)

    const nextItem: VaultItem = { ...draft, updatedAt: new Date().toLocaleString() }
    const nextItems = items.map((item) => (item.id === nextItem.id ? nextItem : item))
    await persistItems(nextItems)

    setIsSaving(false)
  }

  async function removeCurrentItem() {
    if (!draft) return
    const deletingId = draft.id
    const remaining = items.filter((item) => item.id !== deletingId)
    await persistItems(remaining)
    setSelectedId(remaining[0]?.id || '')
  }

  async function copyPassword() {
    if (!draft?.passwordMasked) return
    try {
      await navigator.clipboard.writeText(draft.passwordMasked)
      setSyncMessage('Password copied to clipboard')
    } catch {
      setSyncMessage('Clipboard copy failed')
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
      setOwnerMode(getOwnerMode())
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
      setSyncMessage('Pushing vault snapshot to cloud...')
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
      <div className="app-shell">
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
          {debugStatusLines.length > 0 && (
            <div className="muted" style={{ margin: 0, fontSize: '.75rem' }}>
              {debugStatusLines.map((line) => <p key={line} style={{ margin: 0 }}>{line}</p>)}
            </div>
          )}
          {cloudVaultCandidates.length > 0 && (
            <div className="detail-grid" style={{ gap: '.45rem' }}>
              <p className="muted" style={{ margin: 0 }}>Cloud snapshots:</p>
              {cloudVaultCandidates.slice(0, 8).map((snapshot) => (
                <button
                  key={`${snapshot.vaultId}-${snapshot.revision}-${snapshot.updatedAt}`}
                  className="solid"
                  onClick={() => loadVaultFromCloud(snapshot)}
                >
                  {`Load ${snapshot.vaultId.slice(0, 8)} r${snapshot.revision} (${new Date(snapshot.updatedAt).toLocaleString()})`}
                </button>
              ))}
            </div>
          )}
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
      <div className="app-shell">
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
          {debugStatusLines.length > 0 && (
            <div className="muted" style={{ margin: 0, fontSize: '.75rem' }}>
              {debugStatusLines.map((line) => <p key={line} style={{ margin: 0 }}>{line}</p>)}
            </div>
          )}
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
            <label>
              Master Password
              <input
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
            </label>
            <button className="solid" type="submit">Unlock Vault</button>
          </form>
          {vaultError && <p style={{ color: '#d85f5f' }}>{vaultError}</p>}
          {biometricSupported() && pendingVaultExists && (
            <button className="ghost" onClick={() => void unlockVaultBiometric()}>Unlock with Biometrics</button>
          )}
          {cloudVaultCandidates.length > 0 && (
            <div className="detail-grid" style={{ gap: '.45rem' }}>
              <p className="muted" style={{ margin: 0 }}>Cloud snapshots:</p>
              {cloudVaultCandidates.slice(0, 8).map((snapshot) => (
                <button
                  key={`${snapshot.vaultId}-${snapshot.revision}-${snapshot.updatedAt}`}
                  className="solid"
                  onClick={() => loadVaultFromCloud(snapshot)}
                >
                  {`Load ${snapshot.vaultId.slice(0, 8)} r${snapshot.revision} (${new Date(snapshot.updatedAt).toLocaleString()})`}
                </button>
              ))}
            </div>
          )}
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

      <header className="topbar">
        <div className="topbar-brand">
          <h1>Armadillo</h1>
          <div className={`sync-badge sync-${syncState}`}>{syncMessage}</div>
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

      {authMessage && <div className="auth-message">{authMessage}</div>}

      {effectivePlatform === 'desktop' && (
        <div className="desktop-frame" aria-hidden="true">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
          <p>Armadillo Desktop Shell · Owner: {ownerMode}</p>
        </div>
      )}

      <main className={`workspace density-${density}`}>
        <aside className={`pane pane-left ${mobileStep === 'nav' ? 'mobile-active' : ''}`}>
          <div className="sidebar-header">
            <h2>Vault</h2>
            <span className="sidebar-count">{items.length} items</span>
          </div>

          <nav className="sidebar-nav">
            <button className="sidebar-nav-item active" onClick={() => setMobileStep('list')}>
              <span>All Items</span>
              <span className="sidebar-badge">{items.length}</span>
            </button>
            <button className="sidebar-nav-item" onClick={() => { setActivePanel('security'); setMobileStep('detail') }}>
              <span>Security Center</span>
              {(securityCounts.exposed + securityCounts.weak) > 0 && (
                <span className="sidebar-badge warn">{securityCounts.exposed + securityCounts.weak}</span>
              )}
            </button>
          </nav>

          {(securityCounts.exposed > 0 || securityCounts.weak > 0 || securityCounts.reused > 0 || securityCounts.stale > 0) && (
            <div className="sidebar-health">
              {securityCounts.exposed > 0 && <span className="health-dot exposed">{securityCounts.exposed} exposed</span>}
              {securityCounts.weak > 0 && <span className="health-dot weak">{securityCounts.weak} weak</span>}
              {securityCounts.reused > 0 && <span className="health-dot reused">{securityCounts.reused} reused</span>}
              {securityCounts.stale > 0 && <span className="health-dot stale">{securityCounts.stale} stale</span>}
            </div>
          )}

          {folders.length > 0 && (
            <div className="sidebar-section">
              <h3>Folders</h3>
              <div className="sidebar-tags">
                {folders.map((folder) => (
                  <button key={folder} className="sidebar-tag" onClick={() => { setQuery(folder); setMobileStep('list') }}>{folder}</button>
                ))}
              </div>
            </div>
          )}

          {categories.length > 0 && (
            <div className="sidebar-section">
              <h3>Categories</h3>
              <div className="sidebar-tags">
                {categories.map((cat) => (
                  <button key={cat} className="sidebar-tag" onClick={() => { setQuery(cat); setMobileStep('list') }}>{cat}</button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className={`pane pane-middle ${mobileStep === 'list' ? 'mobile-active' : ''}`}>
          <div className="pane-head">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, URL, tag, category..." />
            <div className="toggle-row">
              <button className={density === 'compact' ? 'active' : ''} onClick={() => setDensity('compact')}>Compact</button>
              <button className={density === 'comfortable' ? 'active' : ''} onClick={() => setDensity('comfortable')}>Comfortable</button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="detail-grid">
              <h3>Empty Vault</h3>
              <p className="muted">Create your first credential to get started.</p>
              <button className="solid" style={{ alignSelf: 'start' }} onClick={createItem}>+ Create First Credential</button>
            </div>
          ) : (
            <ul className="item-list">
              {filtered.map((item) => (
                <li key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setMobileStep('detail') }}>
                  <div className="item-info">
                    <strong>{item.title || 'Untitled'}</strong>
                    <p>{item.username || 'No username'}</p>
                  </div>
                  <div className="row-meta">
                    <span className={`risk risk-${item.risk}`}>{riskLabel(item.risk)}</span>
                    <span className="folder-tag">{item.folder}</span>
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
            <div className="tab-row">
              <button className={activePanel === 'details' ? 'active' : ''} onClick={() => setActivePanel('details')}>Details</button>
              <button className={activePanel === 'generator' ? 'active' : ''} onClick={() => setActivePanel('generator')}>Generator</button>
              <button className={activePanel === 'security' ? 'active' : ''} onClick={() => setActivePanel('security')}>Security</button>
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
              <label>
                Category
                <input value={draft.category} onChange={(event) => setDraftField('category', event.target.value)} />
              </label>
              <label>
                Folder
                <input value={draft.folder} onChange={(event) => setDraftField('folder', event.target.value)} />
              </label>
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
                Risk
                <select value={draft.risk} onChange={(event) => setDraftField('risk', event.target.value as RiskState)}>
                  <option value="safe">Safe</option>
                  <option value="weak">Weak</option>
                  <option value="reused">Reused</option>
                  <option value="exposed">Exposed</option>
                  <option value="stale">Stale</option>
                </select>
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
                <span className={`risk risk-${draft.risk}`}>{riskLabel(draft.risk)}</span>
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

          {activePanel === 'security' && (
            <div className="security-panel">
              <h3>Security Center</h3>
              <p className="muted">Vault health overview based on encrypted local data.</p>
              <ul>
                <SecurityMetric count={securityCounts.exposed} label="Exposed credentials" detail="Entries marked as exposed" tone="danger" />
                <SecurityMetric count={securityCounts.reused} label="Reused passwords" detail="Entries marked as reused" tone="caution" />
                <SecurityMetric count={securityCounts.weak} label="Weak passwords" detail="Entries below your policy" tone="warning" />
                <SecurityMetric count={securityCounts.stale} label="Stale entries" detail="Entries not recently rotated" tone="info" />
              </ul>
            </div>
          )}

        </section>
      </main>

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
