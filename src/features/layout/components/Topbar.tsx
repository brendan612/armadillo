import { Plus, RefreshCw } from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import logoSrc from '../../../assets/armadillo.png'

export function Topbar() {
  const { effectivePlatform } = useVaultAppDerived()
  const { syncState, syncMessage, authMessage } = useVaultAppState()
  const { createItem, lockVault, setShowSettings, refreshVaultFromCloudNow } = useVaultAppActions()
  const showRefreshButton = effectivePlatform === 'desktop' || effectivePlatform === 'web'

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <img className="topbar-logo" src={logoSrc} alt="Armadillo" />
        <div className={`sync-badge sync-${syncState}`}>{syncMessage}</div>
        {authMessage && <span className="auth-message">{authMessage}</span>}
      </div>

      <div className="topbar-actions">
        {showRefreshButton && (
          <button
            className={`icon-btn topbar-refresh-btn${syncState === 'syncing' ? ' spinning' : ''}`}
            onClick={() => void refreshVaultFromCloudNow()}
            title="Refresh from cloud"
            disabled={syncState === 'syncing'}
          >
            <RefreshCw size={16} strokeWidth={2.1} />
          </button>
        )}
        <button className="solid" onClick={createItem}>
          <span className="topbar-new-btn-text">+ New Credential</span>
          <span className="topbar-new-btn-icon"><Plus size={18} strokeWidth={2.2} /></span>
        </button>
        <button className="icon-btn" onClick={lockVault} title="Lock vault">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/></svg>
        </button>
      </div>
    </header>
  )
}
