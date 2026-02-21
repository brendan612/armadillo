import { useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import logoSrc from '../../../assets/armadillo.png'

const QUICK_ENTRY_TYPES = [
  { key: 'password', label: 'Password' },
  { key: 'file', label: 'File' },
  { key: 'key', label: 'Key' },
  { key: 'token', label: 'Token' },
  { key: 'secret', label: 'Secret' },
  { key: 'image', label: 'Image' },
  { key: 'note', label: 'Note' },
] as const

export function Topbar() {
  const { effectivePlatform } = useVaultAppDerived()
  const { syncState, syncMessage, authMessage, showSettings, workspaceSection } = useVaultAppState()
  const { createStorageItem, createEntry, lockVault, openSettings, closeSettings, refreshVaultFromCloudNow } = useVaultAppActions()
  const [showEntryTypeMenu, setShowEntryTypeMenu] = useState(false)
  const quickCreateRef = useRef<HTMLDivElement | null>(null)
  const showRefreshButton = effectivePlatform === 'desktop' || effectivePlatform === 'web'

  useEffect(() => {
    if (!showEntryTypeMenu) return
    function onPointerDown(event: PointerEvent) {
      if (!quickCreateRef.current?.contains(event.target as Node)) {
        setShowEntryTypeMenu(false)
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowEntryTypeMenu(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [showEntryTypeMenu])

  function handleQuickCreate(type: (typeof QUICK_ENTRY_TYPES)[number]['key']) {
    createEntry(type)
    setShowEntryTypeMenu(false)
  }

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
        {!showSettings && (
          workspaceSection === 'storage' ? (
            <button className="solid" onClick={createStorageItem}>
              <span className="topbar-new-btn-text">+ New Storage Item</span>
              <span className="topbar-new-btn-icon"><Plus size={18} strokeWidth={2.2} /></span>
            </button>
          ) : (
            <div className="topbar-quick-create" ref={quickCreateRef}>
              <button
                className="solid topbar-quick-create-trigger"
                aria-haspopup="menu"
                aria-expanded={showEntryTypeMenu}
                aria-label="Create new entry"
                title="Create new entry"
                onClick={() => setShowEntryTypeMenu((current) => !current)}
              >
                +
              </button>
              {showEntryTypeMenu && (
                <div className="topbar-quick-create-menu" role="menu" aria-label="New entry type">
                  {QUICK_ENTRY_TYPES.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className="ghost"
                      role="menuitem"
                      onClick={() => handleQuickCreate(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        <button className="icon-btn" onClick={lockVault} title="Lock vault">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </button>
        <button
          className="icon-btn"
          onClick={() => (showSettings ? closeSettings() : openSettings())}
          title={showSettings ? 'Close settings' : 'Settings'}
        >
          {showSettings ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/></svg>
          )}
        </button>
      </div>
    </header>
  )
}
