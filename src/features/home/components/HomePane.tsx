import { AlertTriangle, Clock3, FolderOpen, Search, ShieldCheck } from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

function formatUpdatedAt(updatedAtRaw: string) {
  const parsed = Date.parse(updatedAtRaw)
  if (!Number.isFinite(parsed)) return updatedAtRaw
  return new Date(parsed).toLocaleString()
}

export function HomePane() {
  const { items, mobileStep, homeSearchQuery } = useVaultAppState()
  const { folderPathById, homeRecentItems, homeSearchResults, expiredItems, expiringSoonItems } = useVaultAppDerived()
  const { updateHomeSearch, submitHomeSearch, openSmartView, setSelectedNode, setMobileStep, setQuery, openItemFromHome } = useVaultAppActions()

  const unfiledCount = items.filter((item) => !item.folderId).length
  const queryActive = homeSearchQuery.trim().length > 0

  return (
    <section className={`pane pane-middle home-pane ${mobileStep === 'home' ? 'mobile-active' : ''}`}>
      <div className="pane-head home-head">
        <h2>At a Glance</h2>
        <p className="muted">Search credentials and monitor vault health.</p>
      </div>

      <div className="home-body">
        <div className="home-search-row">
          <Search size={15} aria-hidden="true" />
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
          />
          <button className="ghost" onClick={submitHomeSearch}>Open List</button>
        </div>

        {queryActive && (
          <div className="home-section">
            <div className="home-section-head">
              <h3>Quick Search</h3>
              <span>{homeSearchResults.length} shown</span>
            </div>
            {homeSearchResults.length === 0 ? (
              <p className="home-empty">No credentials match your search.</p>
            ) : (
              <ul className="home-inline-list">
                {homeSearchResults.map((item) => (
                  <li key={item.id}>
                    <button className="home-result-row" onClick={() => openItemFromHome(item.id)}>
                      <strong>{item.title || 'Untitled'}</strong>
                      <span>{item.username || 'No username'}</span>
                      <span>{item.folderId ? (folderPathById.get(item.folderId) ?? item.folder) : 'Unfiled'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="home-cards">
          <button className="home-card" onClick={() => { setQuery(''); setSelectedNode('all'); setMobileStep('list') }}>
            <span className="home-card-icon"><ShieldCheck size={16} /></span>
            <span className="home-card-value">{items.length}</span>
            <span className="home-card-label">Total Credentials</span>
          </button>
          <button className="home-card" onClick={() => openSmartView('expired')}>
            <span className="home-card-icon"><AlertTriangle size={16} /></span>
            <span className="home-card-value">{expiredItems.length}</span>
            <span className="home-card-label">Expired</span>
          </button>
          <button className="home-card" onClick={() => openSmartView('expiring')}>
            <span className="home-card-icon"><Clock3 size={16} /></span>
            <span className="home-card-value">{expiringSoonItems.length}</span>
            <span className="home-card-label">Expiring Soon (7d)</span>
          </button>
          <button className="home-card" onClick={() => { setQuery(''); setSelectedNode('unfiled'); setMobileStep('list') }}>
            <span className="home-card-icon"><FolderOpen size={16} /></span>
            <span className="home-card-value">{unfiledCount}</span>
            <span className="home-card-label">Unfiled</span>
          </button>
        </div>

        <div className="home-section">
          <div className="home-section-head">
            <h3>Recent Updates</h3>
            <span>{homeRecentItems.length}</span>
          </div>
          {homeRecentItems.length === 0 ? (
            <p className="home-empty">No credentials yet. Create your first item to get started.</p>
          ) : (
            <ul className="home-recent-list">
              {homeRecentItems.map((item) => (
                <li key={item.id}>
                  <button className="home-recent-row" onClick={() => openItemFromHome(item.id)}>
                    <strong>{item.title || 'Untitled'}</strong>
                    <span>{item.username || 'No username'}</span>
                    <span>{formatUpdatedAt(item.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
