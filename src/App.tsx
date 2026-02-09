import { useMemo, useState } from 'react'

type VaultItem = {
  id: string
  title: string
  username: string
  urls: string[]
  category: string
  folder: string
  tags: string[]
  risk: 'safe' | 'weak' | 'reused' | 'exposed' | 'stale'
  updatedAt: string
  note: string
  securityQuestions: { question: string; answer: string }[]
}

const items: VaultItem[] = [
  {
    id: '1',
    title: 'GitHub',
    username: 'bren.dev',
    urls: ['https://github.com', 'https://gist.github.com'],
    category: 'Developer',
    folder: 'Work',
    tags: ['2FA', 'critical'],
    risk: 'safe',
    updatedAt: '2 days ago',
    note: 'Hardware key required for org repos.',
    securityQuestions: [{ question: 'First IDE?', answer: 'Notepad++' }],
  },
  {
    id: '2',
    title: 'Chase Bank',
    username: 'bren.personal',
    urls: ['https://chase.com'],
    category: 'Finance',
    folder: 'Personal',
    tags: ['banking'],
    risk: 'weak',
    updatedAt: '7 months ago',
    note: 'Enable travel notice before international trips.',
    securityQuestions: [
      { question: 'Mother maiden name?', answer: 'Stored in passphrase format' },
      { question: 'First school?', answer: 'Enciphered alias' },
    ],
  },
  {
    id: '3',
    title: 'Cloudflare',
    username: 'admin@armadillo.dev',
    urls: ['https://dash.cloudflare.com'],
    category: 'Infrastructure',
    folder: 'Work',
    tags: ['dns', 'critical'],
    risk: 'reused',
    updatedAt: '1 month ago',
    note: 'Rotate API token every quarter.',
    securityQuestions: [],
  },
  {
    id: '4',
    title: 'Netflix',
    username: 'family.media',
    urls: ['https://netflix.com'],
    category: 'Streaming',
    folder: 'Family',
    tags: ['shared'],
    risk: 'stale',
    updatedAt: '13 months ago',
    note: 'Shared with household vault.',
    securityQuestions: [],
  },
  {
    id: '5',
    title: 'Stripe',
    username: 'ops@armadillo.dev',
    urls: ['https://dashboard.stripe.com'],
    category: 'Payments',
    folder: 'Work',
    tags: ['finance', 'critical'],
    risk: 'exposed',
    updatedAt: '2 hours ago',
    note: 'Potential leak alert triggered from reused token list.',
    securityQuestions: [],
  },
]

const riskOrder: VaultItem['risk'][] = ['exposed', 'reused', 'weak', 'stale', 'safe']

const shellSections = [
  { name: 'All Items', count: 248 },
  { name: 'Favorites', count: 16 },
  { name: 'Shared', count: 7 },
  { name: 'Security Center', count: 4 },
]

const folders = ['Work', 'Personal', 'Family', 'Archive']
const categories = ['Developer', 'Finance', 'Infrastructure', 'Payments', 'Streaming']

function riskLabel(risk: VaultItem['risk']) {
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

function App() {
  const [query, setQuery] = useState('')
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact')
  const [selectedId, setSelectedId] = useState(items[0].id)
  const [activePanel, setActivePanel] = useState<'details' | 'generator' | 'security'>('details')
  const [mobileStep, setMobileStep] = useState<'nav' | 'list' | 'detail'>('nav')
  const [genLength, setGenLength] = useState(20)
  const [includeSymbols, setIncludeSymbols] = useState(true)
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true)

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
  }, [query])

  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0]

  const generatedPreview = useMemo(() => {
    const chars = `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789${includeSymbols ? '!@#$%^&*()-_=+[]{}' : ''}`
    const safeChars = excludeAmbiguous ? chars.replace(/[O0Il|`~]/g, '') : chars
    return Array.from({ length: genLength }, () => safeChars[Math.floor(Math.random() * safeChars.length)]).join('')
  }, [genLength, includeSymbols, excludeAmbiguous])

  return (
    <div className="app-shell">
      <div className="shell-noise" aria-hidden="true" />
      <header className="topbar">
        <div>
          <p className="kicker">Armadillo Vault</p>
          <h1>Protected by layers, built for speed.</h1>
        </div>
        <div className="topbar-actions">
          <button className="ghost">Ctrl/Cmd + K</button>
          <button className="solid">+ New Credential</button>
        </div>
      </header>

      <main className={`workspace density-${density}`}>
        <aside className={`pane pane-left ${mobileStep === 'nav' ? 'mobile-active' : ''}`}>
          <section className="plate">
            <h2>Vaults</h2>
            <p className="muted">Personal Zero-Knowledge</p>
            <ul className="section-list">
              {shellSections.map((section) => (
                <li
                  key={section.name}
                  className={section.name === 'All Items' ? 'active' : ''}
                  onClick={() => setMobileStep('list')}
                >
                  <span>{section.name}</span>
                  <span>{section.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="plate">
            <h3>Folders</h3>
            <ul className="token-list">
              {folders.map((folder) => (
                <li key={folder}>{folder}</li>
              ))}
            </ul>
          </section>

          <section className="plate">
            <h3>Categories</h3>
            <ul className="token-list categories">
              {categories.map((category) => (
                <li key={category}>{category}</li>
              ))}
            </ul>
          </section>
        </aside>

        <section className={`pane pane-middle ${mobileStep === 'list' ? 'mobile-active' : ''}`}>
          <div className="pane-head">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, URL, tag, category"
            />
            <div className="toggle-row">
              <button
                className={density === 'compact' ? 'active' : ''}
                onClick={() => setDensity('compact')}
              >
                Compact
              </button>
              <button
                className={density === 'comfortable' ? 'active' : ''}
                onClick={() => setDensity('comfortable')}
              >
                Comfortable
              </button>
            </div>
          </div>

          <ul className="item-list">
            {filtered.map((item) => (
              <li
                key={item.id}
                className={item.id === selected?.id ? 'active' : ''}
                onClick={() => {
                  setSelectedId(item.id)
                  setMobileStep('detail')
                }}
              >
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.username}</p>
                </div>
                <div className="row-meta">
                  <span className={`risk risk-${item.risk}`}>{riskLabel(item.risk)}</span>
                  <span>{item.folder}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className={`pane pane-right ${mobileStep === 'detail' ? 'mobile-active' : ''}`}>
          <div className="detail-head">
            <div>
              <p className="kicker">Credential Detail</p>
              <h2>{selected?.title ?? 'No item selected'}</h2>
            </div>
            <div className="tab-row">
              <button className={activePanel === 'details' ? 'active' : ''} onClick={() => setActivePanel('details')}>
                Details
              </button>
              <button className={activePanel === 'generator' ? 'active' : ''} onClick={() => setActivePanel('generator')}>
                Generator
              </button>
              <button className={activePanel === 'security' ? 'active' : ''} onClick={() => setActivePanel('security')}>
                Security
              </button>
            </div>
          </div>

          {activePanel === 'details' && selected && (
            <div className="detail-grid">
              <label>
                Username
                <input defaultValue={selected.username} />
              </label>
              <label>
                Password
                <div className="inline-field">
                  <input type="password" defaultValue="A*************9" />
                  <button>Reveal</button>
                  <button>Copy 30s</button>
                </div>
              </label>
              <label>
                URLs
                <textarea defaultValue={selected.urls.join('\n')} rows={3} />
              </label>
              <label>
                Notes
                <textarea defaultValue={selected.note} rows={3} />
              </label>

              <div className="group-block">
                <h3>Security Questions</h3>
                {selected.securityQuestions.length === 0 ? (
                  <p className="muted">No security questions saved.</p>
                ) : (
                  selected.securityQuestions.map((entry) => (
                    <div key={entry.question} className="qa-row">
                      <input defaultValue={entry.question} />
                      <input type="password" defaultValue={entry.answer} />
                    </div>
                  ))
                )}
                <button className="ghost">+ Add Security Question</button>
              </div>

              <div className="meta-strip">
                <span>Category: {selected.category}</span>
                <span>Folder: {selected.folder}</span>
                <span>Updated: {selected.updatedAt}</span>
                <span className={`risk risk-${selected.risk}`}>{riskLabel(selected.risk)}</span>
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
                  onChange={(event) => setGenLength(Number(event.target.value))}
                />
              </label>
              <div className="switches">
                <label>
                  <input
                    type="checkbox"
                    checked={includeSymbols}
                    onChange={(event) => setIncludeSymbols(event.target.checked)}
                  />
                  Include symbols
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={excludeAmbiguous}
                    onChange={(event) => setExcludeAmbiguous(event.target.checked)}
                  />
                  Exclude ambiguous chars
                </label>
              </div>
              <div className="preview">{generatedPreview}</div>
              <div className="gen-actions">
                <button className="ghost" onClick={() => setGenLength((value) => value + 1)}>
                  Regenerate
                </button>
                <button className="solid">Use Password</button>
              </div>
            </div>
          )}

          {activePanel === 'security' && (
            <div className="security-panel">
              <h3>Security Center</h3>
              <ul>
                <li>
                  <strong>Exposed credentials:</strong> 1 detected (Stripe)
                </li>
                <li>
                  <strong>Reused passwords:</strong> 2 accounts linked
                </li>
                <li>
                  <strong>Weak passwords:</strong> 3 candidates
                </li>
                <li>
                  <strong>Stale entries:</strong> 12 older than 12 months
                </li>
              </ul>
              <button className="solid">Run Bulk Remediation</button>
            </div>
          )}

          <div className="mobile-nav">
            <button onClick={() => setMobileStep('nav')}>Taxonomy</button>
            <button onClick={() => setMobileStep('list')}>Items</button>
            <button onClick={() => setMobileStep('detail')}>Detail</button>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
