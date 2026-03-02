import { useState } from 'react'
import { AlertTriangle, Clock3, Copy, FolderOpen, KeyRound, Plus, Search, ShieldCheck } from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

function getInitials(title: string) {
  const words = title.trim().split(/\s+/)
  if (words.length >= 2) return (words[0][0]! + words[1][0]!).toUpperCase()
  return title.trim().slice(0, 2).toUpperCase() || '??'
}

export function HomePane() {
  const { items, storageItems, mobileStep, homeSearchQuery } = useVaultAppState()
  const { homeRecentItems, homeSearchResults, expiredItems, expiringSoonItems, reusedItems } = useVaultAppDerived()
  const { updateHomeSearch, submitHomeSearch, openSmartView, setSelectedNode, setMobileStep, setQuery, openItemFromHome, createEntry } = useVaultAppActions()
  const [showEntryTypePicker, setShowEntryTypePicker] = useState(false)

  const unfiledCount = items.filter((item) => !item.folderId).length
  const queryActive = homeSearchQuery.trim().length > 0
  const vaultIsEmpty = items.length === 0 && storageItems.length === 0

  return (
    <section className={`pane pane-middle home-pane ${mobileStep === 'home' ? 'mobile-active' : ''}`}>
      <div className="pane-head home-head">
        <h2>At a Glance</h2>
        <p className="muted">Vault overview and quick credential search.</p>
      </div>

      <div className="home-body">
        {vaultIsEmpty && (
          <div className="home-welcome">
            <div className="home-welcome-head">
              <h3>Welcome to your vault</h3>
              <p className="muted">Start by creating your first entry.</p>
            </div>
            <button
              className="solid home-welcome-btn"
              onClick={() => setShowEntryTypePicker((current) => !current)}
            >
              <Plus size={14} /> New Entry
            </button>
            {showEntryTypePicker && (
              <div className="home-entry-type-grid">
                <button className="ghost" onClick={() => createEntry('password')}>Password</button>
                <button className="ghost" onClick={() => createEntry('file')}>File</button>
                <button className="ghost" onClick={() => createEntry('key')}>Key</button>
                <button className="ghost" onClick={() => createEntry('token')}>Token</button>
                <button className="ghost" onClick={() => createEntry('secret')}>Secret</button>
                <button className="ghost" onClick={() => createEntry('image')}>Image</button>
                <button className="ghost" onClick={() => createEntry('note')}>Note</button>
              </div>
            )}
          </div>
        )}
        {!vaultIsEmpty && (
          <>

            {/* Search */}
            <div className="home-search-row">
              <Search size={14} aria-hidden="true" />
              <input
                value={homeSearchQuery}
                onChange={(event) => updateHomeSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitHomeSearch()
                  }
                }}
                placeholder="Search credentials..."
                aria-label="Search credentials"
              />
              <button className="ghost home-search-btn" onClick={submitHomeSearch}>
                Browse all
              </button>
            </div>

            {/* Quick Search Results */}
            {queryActive && (
              <div className="home-section">
                <div className="home-section-head">
                  <h3>Quick Results</h3>
                  <span className="home-section-count">{homeSearchResults.length}</span>
                </div>
                {homeSearchResults.length === 0 ? (
                  <div className="home-empty">
                    <p>No credentials match your search.</p>
                  </div>
                ) : (
                  <ul className="item-list home-item-list">
                    {homeSearchResults.map((item) => (
                      <li key={item.id} onClick={() => openItemFromHome(item.id)}>
                        <div className="item-info">
                          <strong className="item-title">{item.title || 'Untitled'}</strong>
                          {item.urls[0] && <p className="item-url">{item.urls[0]}</p>}
                          <p className="item-secondary">
                            <span className="item-username">{item.username || 'No username'}</span>
                          </p>
                        </div>
                        <div className="item-avatar" aria-hidden="true">{getInitials(item.title || 'U')}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Vault Stats */}
            <div className="home-stats">
          <button
            className="home-stat"
            onClick={() => { setQuery(''); setSelectedNode('all'); setMobileStep('list') }}
          >
            <ShieldCheck size={13} />
            <span className="home-stat-value">{items.length}</span>
            <span className="home-stat-label">Total</span>
          </button>

          <button
            className={`home-stat${expiredItems.length > 0 ? ' home-stat--alert' : ''}`}
            onClick={() => openSmartView('expired')}
          >
            <AlertTriangle size={13} />
            <span className="home-stat-value">{expiredItems.length}</span>
            <span className="home-stat-label">Expired</span>
          </button>

          <button
            className={`home-stat${expiringSoonItems.length > 0 ? ' home-stat--warn' : ''}`}
            onClick={() => openSmartView('expiring')}
          >
            <Clock3 size={13} />
            <span className="home-stat-value">{expiringSoonItems.length}</span>
            <span className="home-stat-label">Expiring</span>
          </button>

          <button
            className={`home-stat${reusedItems.length > 0 ? ' home-stat--reused' : ''}`}
            onClick={() => openSmartView('reused')}
          >
            <Copy size={13} />
            <span className="home-stat-value">{reusedItems.length}</span>
            <span className="home-stat-label">Reused</span>
          </button>

          <button
            className="home-stat"
            onClick={() => { setQuery(''); setSelectedNode('unfiled'); setMobileStep('list') }}
          >
            <FolderOpen size={13} />
            <span className="home-stat-value">{unfiledCount}</span>
            <span className="home-stat-label">Unfiled</span>
          </button>
            </div>

            {/* Recent Updates */}
            <div className="home-section">
          <div className="home-section-head">
            <h3>Recently Updated</h3>
            <span className="home-section-count">{homeRecentItems.length}</span>
          </div>
          {homeRecentItems.length === 0 ? (
            <div className="home-empty">
              <KeyRound size={18} aria-hidden="true" />
              <p>No credentials yet. Create your first item to get started.</p>
            </div>
          ) : (
            <ul className="item-list home-item-list">
              {homeRecentItems.map((item) => (
                <li key={item.id} onClick={() => openItemFromHome(item.id)}>
                  <div className="item-info">
                    <strong className="item-title">{item.title || 'Untitled'}</strong>
                    {item.urls[0] && <p className="item-url">{item.urls[0]}</p>}
                    <p className="item-secondary">
                      <span className="item-username">{item.username || 'No username'}</span>
                    </p>
                  </div>
                  <div className="item-avatar" aria-hidden="true">{getInitials(item.title || 'U')}</div>
                </li>
              ))}
            </ul>
          )}
            </div>
          </>
        )}

      </div>
    </section>
  )
}
