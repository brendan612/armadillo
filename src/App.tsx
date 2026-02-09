import { useEffect, useMemo, useRef, useState } from 'react'
import { useConvexAuth } from 'convex/react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { convexConfigured, getCloudAuthStatus, pullRemoteSnapshot, pushRemoteSnapshot, setConvexAuthToken } from './lib/convexApi'
import { bindPasskeyOwner, getOwnerMode } from './lib/owner'
import { biometricEnrollmentExists, biometricSupported, enrollBiometricQuickUnlock, unlockWithBiometric } from './lib/biometric'
import {
  clearLocalVaultFile,
  createVaultFile,
  loadLocalVaultFile,
  parseVaultFileFromText,
  readPayloadWithSessionKey,
  rewriteVaultFile,
  saveLocalVaultFile,
  serializeVaultFile,
  unlockVaultFile,
} from './lib/vaultFile'
import type { RiskState, SecurityQuestion, VaultItem, VaultSession } from './types/vault'

type AppPhase = 'create' | 'unlock' | 'ready'
type Panel = 'details' | 'generator' | 'security'
type MobileStep = 'nav' | 'list' | 'detail'
type SyncState = 'local' | 'syncing' | 'live' | 'error'
type CloudAuthState = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'error'

const CLOUD_SYNC_PREF_KEY = 'armadillo.cloud_sync_enabled'
const riskOrder: RiskState[] = ['exposed', 'reused', 'weak', 'stale', 'safe']

const shellSections = [
  { name: 'All Items' },
  { name: 'Favorites' },
  { name: 'Shared' },
  { name: 'Security Center' },
]

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
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(localStorage.getItem(CLOUD_SYNC_PREF_KEY) === 'true')
  const [ownerMode, setOwnerMode] = useState(getOwnerMode())
  const [biometricEnabled, setBiometricEnabled] = useState(() => biometricEnrollmentExists())
  const [authMessage, setAuthMessage] = useState('')
  const [cloudAuthState, setCloudAuthState] = useState<CloudAuthState>('unknown')
  const [cloudIdentity, setCloudIdentity] = useState('')

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
        if (cancelled) return

        if (status?.authenticated) {
          const identityLabel = status.email || status.name || status.subject || status.tokenIdentifier || 'Google account'
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

    try {
      const session = await unlockVaultFile(file, unlockPassword)
      applySession(session)
      setPhase('ready')
      setSyncMessage('Vault unlocked locally')
      setUnlockPassword('')
    } catch {
      setVaultError('Invalid master password or corrupted vault file.')
    }
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

  async function signInWithGoogle() {
    try {
      setAuthMessage('Redirecting to Google sign-in...')
      await signIn('google')
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

  if (phase === 'create') {
    return (
      <div className="app-shell">
        <main className="detail-grid" style={{ maxWidth: 540, margin: '4rem auto' }}>
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
        <main className="detail-grid" style={{ maxWidth: 540, margin: '4rem auto' }}>
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
          <div className="muted" style={{ fontSize: '.8rem' }}>{authStatus}</div>
        </div>

        <div className="topbar-actions" style={{ gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="ghost" onClick={exportVaultFile}>Export .armadillo</button>
          <button className="ghost" onClick={triggerImport}>Import .armadillo</button>
          {biometricSupported() && (
            <button className={biometricEnabled ? 'solid' : 'ghost'} onClick={() => void enableBiometricUnlock()}>
              {biometricEnabled ? 'Biometric Enabled' : 'Enable Biometric'}
            </button>
          )}
          <button className={cloudSyncEnabled ? 'solid' : 'ghost'} onClick={() => setCloudSyncEnabled((value) => !value)}>
            {cloudSyncEnabled ? 'Cloud Sync On' : 'Cloud Sync Off'}
          </button>
          {!cloudConnected ? (
            <button className="ghost" onClick={() => void signInWithGoogle()} disabled={cloudAuthState === 'checking'}>
              {cloudAuthState === 'checking' ? 'Checking Session...' : 'Sign in with Google'}
            </button>
          ) : (
            <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
          )}
          <button className="ghost" onClick={() => void createPasskeyIdentity()}>Bind Passkey Identity</button>
          <button className="ghost" onClick={lockVault}>Lock</button>
          <button className="solid" onClick={createItem}>+ New Credential</button>
        </div>
      </header>

      {authMessage && (
        <div style={{ padding: '0 1rem .6rem', fontSize: '.82rem', color: '#8e9388' }}>
          {authMessage}
        </div>
      )}

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
          <section className="plate">
            <h2>Vault</h2>
            <p className="muted">{items.length} item(s)</p>
            <ul className="section-list">
              {shellSections.map((section) => (
                <li key={section.name} className={section.name === 'All Items' ? 'active' : ''} onClick={() => setMobileStep('list')}>
                  <span>{section.name}</span>
                  <span>{section.name === 'All Items' ? items.length : ''}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="plate">
            <h3>Folders</h3>
            <ul className="token-list">
              {folders.length === 0 ? <li>None</li> : folders.map((folder) => <li key={folder}>{folder}</li>)}
            </ul>
          </section>

          <section className="plate">
            <h3>Categories</h3>
            <ul className="token-list categories">
              {categories.length === 0 ? <li>None</li> : categories.map((category) => <li key={category}>{category}</li>)}
            </ul>
          </section>
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
              <button className="solid" onClick={createItem}>+ Create First Credential</button>
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

          <div className="mobile-nav">
            <button onClick={() => setMobileStep('nav')}>Taxonomy</button>
            <button onClick={() => setMobileStep('list')}>Items</button>
            <button onClick={() => setMobileStep('detail')}>Detail</button>
          </div>
        </section>
      </main>

      <input
        ref={importFileInputRef}
        type="file"
        accept=".armadillo,application/octet-stream,application/json"
        style={{ display: 'none' }}
        onChange={(event) => void onImportFileSelected(event)}
      />

      <div style={{ padding: '0 1rem 1rem', fontSize: '.82rem', color: '#8e9388' }}>
        Unlock methods: master password required. Biometric/passkey quick-unlock can be layered via platform integrations.
        {convexConfigured() ? ' Convex sync endpoint configured.' : ' Convex sync endpoint not configured.'}
      </div>

      <div style={{ padding: '0 1rem 1rem', display: 'flex', gap: '.5rem' }}>
        <button className="ghost" onClick={() => { clearLocalVaultFile(); window.location.reload() }}>Reset Local Vault</button>
      </div>
    </div>
  )
}

export default App





