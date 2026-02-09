import { useEffect, useMemo, useState } from 'react'
import { convexConfigured, deleteVaultItem, listVaultItems, upsertVaultItem } from './lib/convexApi'
import type { RiskState, SaveVaultItemInput, SecurityQuestion, VaultItem } from './types/vault'

type Panel = 'details' | 'generator' | 'security'
type MobileStep = 'nav' | 'list' | 'detail'
type PlatformOverride = 'auto' | 'web' | 'desktop' | 'mobile'
type SyncState = 'local' | 'syncing' | 'live' | 'error'
type ThemePreset = 'midnight' | 'daylight' | 'void' | 'ember'

const LOCAL_ITEMS_KEY = 'armadillo.local.items'
const riskOrder: RiskState[] = ['exposed', 'reused', 'weak', 'stale', 'safe']

const shellSections = [
  { name: 'All Items' },
  { name: 'Favorites' },
  { name: 'Shared' },
  { name: 'Security Center' },
]

const THEME_PRESETS: { id: ThemePreset; label: string; colors: [string, string, string, string] }[] = [
  { id: 'midnight', label: 'Midnight', colors: ['#0b0d13', '#171b27', '#1d2235', '#d4854a'] },
  { id: 'daylight', label: 'Daylight', colors: ['#f3f4f7', '#ffffff', '#e9ebf0', '#00b892'] },
  { id: 'void', label: 'Void', colors: ['#000000', '#0a0a14', '#10101c', '#00ffcc'] },
  { id: 'ember', label: 'Ember', colors: ['#0e0a06', '#1e160e', '#281e14', '#e8824a'] },
]

const ACCENT_COLORS = [
  { name: 'Copper', value: '#d4854a' },
  { name: 'Teal', value: '#00d4aa' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Emerald', value: '#10b981' },
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

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? '#000000' : '#ffffff'
}

function getAutoPlatform(): 'web' | 'desktop' | 'mobile' {
  if (window.armadilloShell?.isElectron) return 'desktop'
  if (window.matchMedia('(max-width: 900px)').matches) return 'mobile'
  return 'web'
}

function buildEmptyItem(): VaultItem {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
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

function loadLocalItems(): VaultItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_ITEMS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as VaultItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveLocalItems(items: VaultItem[]) {
  localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(items))
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
  const [theme, setTheme] = useState<ThemePreset>(() => (localStorage.getItem('armadillo-theme') as ThemePreset) || 'midnight')
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('armadillo-accent') || '#d4854a')
  const [showSettings, setShowSettings] = useState(false)

  const [items, setItems] = useState<VaultItem[]>([])
  const [query, setQuery] = useState('')
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact')
  const [selectedId, setSelectedId] = useState('')
  const [activePanel, setActivePanel] = useState<Panel>('details')
  const [mobileStep, setMobileStep] = useState<MobileStep>('nav')
  const [platformOverride, setPlatformOverride] = useState<PlatformOverride>('auto')
  const [syncState, setSyncState] = useState<SyncState>('local')
  const [syncMessage, setSyncMessage] = useState('Loading...')
  const [isSaving, setIsSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [genLength, setGenLength] = useState(20)
  const [includeSymbols, setIncludeSymbols] = useState(true)
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true)
  const [generatorNonce, setGeneratorNonce] = useState(0)

  const [draft, setDraft] = useState<VaultItem | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('armadillo-theme', theme)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--accent', accentColor)
    root.setProperty('--accent-soft', hexToRgba(accentColor, 0.12))
    root.setProperty('--accent-glow', hexToRgba(accentColor, 0.22))
    root.setProperty('--accent-contrast', getContrastColor(accentColor))
    localStorage.setItem('armadillo-accent', accentColor)
  }, [accentColor])

  useEffect(() => {
    let cancelled = false

    async function loadItems() {
      const localItems = loadLocalItems()

      if (!convexConfigured()) {
        if (!cancelled) {
          setItems(localItems)
          setSelectedId(localItems[0]?.id || '')
          setSyncState('local')
          setSyncMessage('Local mode')
        }
        return
      }

      setSyncState('syncing')
      setSyncMessage('Connecting to Convex...')

      try {
        const remote = await listVaultItems()
        if (!cancelled && remote) {
          setItems(remote.items)
          setSelectedId((current) => current || remote.items[0]?.id || '')
          setSyncState('live')
          setSyncMessage(remote.ownerSource === 'auth' ? 'Synced (signed-in owner)' : 'Synced (anonymous owner)')
        }
      } catch {
        if (!cancelled) {
          setItems(localItems)
          setSelectedId(localItems[0]?.id || '')
          setSyncState('error')
          setSyncMessage('Convex unavailable - local mode')
        }
      }
    }

    void loadItems()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (syncState !== 'live') {
      saveLocalItems(items)
    }
  }, [items, syncState])

  useEffect(() => {
    const selected = items.find((item) => item.id === selectedId) ?? null
    setDraft(selected)
  }, [items, selectedId])

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
  const effectivePlatform = platformOverride === 'auto' ? getAutoPlatform() : platformOverride

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

  const generatedPreview = useMemo(() => {
    const chars = `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789${includeSymbols ? '!@#$%^&*()-_=+[]{}' : ''}`
    const safeChars = excludeAmbiguous ? chars.replace(/[O0Il|`~]/g, '') : chars
    const entropyBump = (generatorNonce % safeChars.length) || 1
    return Array.from({ length: genLength }, () => {
      const random = Math.floor(Math.random() * safeChars.length)
      return safeChars[(random + entropyBump) % safeChars.length]
    }).join('')
  }, [genLength, includeSymbols, excludeAmbiguous, generatorNonce])

  function setDraftField<K extends keyof VaultItem>(key: K, value: VaultItem[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  function createItem() {
    const item = buildEmptyItem()
    setItems((current) => [item, ...current])
    setSelectedId(item.id)
    setDraft(item)
    setMobileStep('detail')
    setActivePanel('details')
  }

  async function saveCurrentItem() {
    if (!draft) return
    setIsSaving(true)

    const nextItem: VaultItem = { ...draft, updatedAt: new Date().toLocaleString() }
    setItems((current) => current.map((item) => (item.id === nextItem.id ? nextItem : item)))

    try {
      const payload: SaveVaultItemInput = { ...nextItem }
      const remote = await upsertVaultItem(payload)

      if (remote) {
        setItems((current) => current.map((item) => (item.id === remote.item.id ? remote.item : item)))
        setSyncState('live')
        setSyncMessage(remote.ownerSource === 'auth' ? 'Saved (signed-in owner)' : 'Saved (anonymous owner)')
      } else {
        setSyncState('local')
        setSyncMessage('Saved locally')
      }
    } catch {
      setSyncState('error')
      setSyncMessage('Save failed - local changes retained')
    } finally {
      setIsSaving(false)
    }
  }

  async function removeCurrentItem() {
    if (!draft) return
    const deletingId = draft.id

    const remaining = items.filter((item) => item.id !== deletingId)
    setItems(remaining)
    setSelectedId(remaining[0]?.id || '')

    try {
      const result = await deleteVaultItem(deletingId)
      if (result) {
        setSyncState('live')
        setSyncMessage(result.ownerSource === 'auth' ? 'Deleted (signed-in owner)' : 'Deleted (anonymous owner)')
      } else {
        setSyncState('local')
        setSyncMessage('Deleted locally')
      }
    } catch {
      setSyncState('error')
      setSyncMessage('Delete failed on Convex - removed locally')
    }
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

  return (
    <div className={`app-shell platform-${effectivePlatform}`}>
      <div className="shell-noise" aria-hidden="true" />

      <header className="topbar">
        <div className="topbar-brand">
          <h1>Armadillo</h1>
          <div className={`sync-badge sync-${syncState}`}>{syncMessage}</div>
        </div>

        <div className="topbar-actions">
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">
            Settings
          </button>
          <button className="solid" onClick={createItem}>+ New Credential</button>
        </div>
      </header>

      {effectivePlatform === 'desktop' && (
        <div className="desktop-frame" aria-hidden="true">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
          <p>Armadillo Desktop Shell</p>
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
                <input type="range" min={12} max={48} value={genLength} onChange={(event) => setGenLength(Number(event.target.value))} />
              </label>
              <div className="switches">
                <label>
                  <input type="checkbox" checked={includeSymbols} onChange={(event) => setIncludeSymbols(event.target.checked)} />
                  Include symbols
                </label>
                <label>
                  <input type="checkbox" checked={excludeAmbiguous} onChange={(event) => setExcludeAmbiguous(event.target.checked)} />
                  Exclude ambiguous chars
                </label>
              </div>
              <div className="preview">{generatedPreview}</div>
              <div className="gen-actions">
                <button className="ghost" onClick={() => setGeneratorNonce((current) => current + 1)}>Regenerate</button>
                <button className="solid" onClick={() => { if (draft) { setDraftField('passwordMasked', generatedPreview); setActivePanel('details') } }}>
                  Use Password
                </button>
              </div>
            </div>
          )}

          {activePanel === 'security' && (
            <div className="security-panel">
              <h3>Security Center</h3>
              <p className="muted">Vault health overview and remediation actions.</p>
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

      {showSettings && (
        <div className="settings-overlay">
          <div className="settings-backdrop" onClick={() => setShowSettings(false)} />
          <div className="settings-panel">
            <div className="settings-header">
              <h2>Settings</h2>
              <button className="icon-btn" onClick={() => setShowSettings(false)} aria-label="Close settings">Close</button>
            </div>
            <div className="settings-body">
              <div className="settings-section">
                <h3>Theme</h3>
                <div className="theme-grid">
                  {THEME_PRESETS.map((preset) => (
                    <div key={preset.id} className={`theme-card ${theme === preset.id ? 'active' : ''}`} onClick={() => setTheme(preset.id)}>
                      <div className="theme-swatch">
                        {preset.colors.map((color, i) => (
                          <span key={i} style={{ background: color }} />
                        ))}
                      </div>
                      <span className="theme-label">{preset.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="settings-section">
                <h3>Accent Color</h3>
                <div className="accent-grid">
                  {ACCENT_COLORS.map((color) => (
                    <div
                      key={color.value}
                      className={`accent-swatch ${accentColor === color.value ? 'active' : ''}`}
                      style={{ background: color.value }}
                      onClick={() => setAccentColor(color.value)}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-section">
                <h3>Display Density</h3>
                <div className="toggle-row">
                  <button className={density === 'compact' ? 'active' : ''} onClick={() => setDensity('compact')}>Compact</button>
                  <button className={density === 'comfortable' ? 'active' : ''} onClick={() => setDensity('comfortable')}>Comfortable</button>
                </div>
              </div>

              <div className="settings-section">
                <h3>Platform Preview</h3>
                <div className="platform-grid">
                  {(['auto', 'web', 'desktop', 'mobile'] as PlatformOverride[]).map((p) => (
                    <button key={p} className={platformOverride === p ? 'active' : ''} onClick={() => setPlatformOverride(p)}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
