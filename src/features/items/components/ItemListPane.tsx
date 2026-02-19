import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { ChevronLeft, Copy, Keyboard, NotebookPen, UserRound } from 'lucide-react'
import type { RiskState, VaultItem } from '../../../types/vault'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

const ITEM_CONTEXT_LONG_PRESS_MS = 520
const riskLabelByState: Record<VaultItem['risk'], string> = {
  safe: 'Safe',
  weak: 'Weak',
  reused: 'Reused',
  exposed: 'Exposed',
  stale: 'Stale',
}
const riskFilterOptions: Array<{ key: RiskState; label: string }> = [
  { key: 'safe', label: 'Safe' },
  { key: 'weak', label: 'Weak' },
  { key: 'reused', label: 'Reused' },
  { key: 'exposed', label: 'Exposed' },
  { key: 'stale', label: 'Stale' },
]

function clearLongPressTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
}

type ItemListRowProps = {
  item: VaultItem
  isActive: boolean
  folderLabel: string
  isLocalOnly: boolean
  onSelectItem: (itemId: string) => void
  onOpenItemContextMenu: (itemId: string, x: number, y: number) => void
  onTouchStartItem: (itemId: string, x: number, y: number) => void
  onTouchEndItem: () => void
  onOpenNotes: (itemId: string) => void
  onCopyUsername: (username: string) => void
  onCopyPassword: (password: string) => void
  onAutofillItem: (item: VaultItem) => void
  onSelectRiskFilter: (item: VaultItem) => void
}

const ItemListRow = memo(function ItemListRow({
  item,
  isActive,
  folderLabel,
  isLocalOnly,
  onSelectItem,
  onOpenItemContextMenu,
  onTouchStartItem,
  onTouchEndItem,
  onOpenNotes,
  onCopyUsername,
  onCopyPassword,
  onAutofillItem,
  onSelectRiskFilter,
}: ItemListRowProps) {
  const maskedPassword = item.passwordMasked ? '*'.repeat(Math.min(24, Math.max(8, item.passwordMasked.length))) : 'No password'

  return (
    <li
      className={isActive ? 'active' : ''}
      onClick={() => onSelectItem(item.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenItemContextMenu(item.id, event.clientX, event.clientY)
      }}
      onPointerDown={(event) => {
        // Open desktop right-click menus on pointer-down so users don't wait for the contextmenu timing.
        if (event.pointerType === 'mouse' && event.button === 2) {
          event.preventDefault()
          event.stopPropagation()
          onOpenItemContextMenu(item.id, event.clientX, event.clientY)
        }
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0]
        if (!touch) return
        onTouchStartItem(item.id, touch.clientX, touch.clientY)
      }}
      onTouchEnd={onTouchEndItem}
      onTouchCancel={onTouchEndItem}
    >
      <div className="item-info">
        <div className="item-inline-top">
          <strong className="item-title">{item.title || 'Untitled'}</strong>
          {isLocalOnly && <span className="item-local-badge">Local only</span>}
        </div>
        {item.urls[0] && <p className="item-url">{item.urls[0]}</p>}
        <p className="item-secondary">
          <span className="item-username">{item.username || 'No username'}</span>
          <span className="item-bullet" aria-hidden="true">&bull;</span>
          <span>{maskedPassword}</span>
        </p>
      </div>
      <div className="row-meta">
        <div className="item-inline-actions">
          {item.note && (
            <button
              className="item-action-btn"
              title="Open notes"
              onClick={(event) => {
                event.stopPropagation()
                onOpenNotes(item.id)
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
              onCopyUsername(item.username || '')
            }}
          >
            <UserRound size={14} aria-hidden="true" />
          </button>
          <button
            className="item-action-btn"
            title="Copy password"
            onClick={(event) => {
              event.stopPropagation()
              onCopyPassword(item.passwordMasked || '')
            }}
          >
            <Copy size={14} aria-hidden="true" />
          </button>
          <button
            className="item-action-btn"
            title="Autofill in previous app"
            onClick={(event) => {
              event.stopPropagation()
              onAutofillItem(item)
            }}
          >
            <Keyboard size={14} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className={`risk risk-${item.risk} risk-filter-pill`}
          onClick={(event) => {
            event.stopPropagation()
            onSelectRiskFilter(item)
          }}
          title={`Filter by ${riskLabelByState[item.risk]} risk`}
        >
          {riskLabelByState[item.risk]}
        </button>
        <span className="folder-tag">{folderLabel}</span>
      </div>
    </li>
  )
}, (previous, next) =>
  previous.item === next.item &&
  previous.isActive === next.isActive &&
  previous.folderLabel === next.folderLabel &&
  previous.isLocalOnly === next.isLocalOnly,
)

export function ItemListPane() {
  const { query, selectedId, selectedNode, folderFilterMode, trash, mobileStep, items, syncProvider } = useVaultAppState()
  const { filtered, folderPathById, effectivePlatform, hasCapability } = useVaultAppDerived()
  const [riskFilter, setRiskFilter] = useState<RiskState | 'all'>('all')
  const [reusedPasswordFilter, setReusedPasswordFilter] = useState<string | null>(null)
  const folderLongPressTimerRef = useRef<number | null>(null)
  const {
    setQuery,
    setFolderFilterMode,
    restoreTrashEntry,
    deleteTrashEntryPermanently,
    createItem,
    setSelectedId,
    setSelectedNode,
    setMobileStep,
    setItemContextMenu,
    setActivePanel,
    copyToClipboard,
    autofillItem,
  } = useVaultAppActions()

  const handleSelectItem = useCallback((itemId: string) => {
    setSelectedId(itemId)
    if (effectivePlatform === 'mobile') {
      setMobileStep('detail')
    }
  }, [effectivePlatform, setMobileStep, setSelectedId])

  const handleOpenItemContextMenu = useCallback((itemId: string, x: number, y: number) => {
    setItemContextMenu({ itemId, x, y })
  }, [setItemContextMenu])

  const handleTouchStartItem = useCallback((itemId: string, x: number, y: number) => {
    clearLongPressTimer(folderLongPressTimerRef)
    folderLongPressTimerRef.current = window.setTimeout(() => {
      setItemContextMenu({ itemId, x, y })
    }, ITEM_CONTEXT_LONG_PRESS_MS)
  }, [setItemContextMenu])

  const handleTouchEndItem = useCallback(() => {
    clearLongPressTimer(folderLongPressTimerRef)
  }, [])

  const handleOpenNotes = useCallback((itemId: string) => {
    setSelectedId(itemId)
    setActivePanel('details')
    if (effectivePlatform === 'mobile') {
      setMobileStep('detail')
    }
  }, [effectivePlatform, setActivePanel, setMobileStep, setSelectedId])

  const handleCopyUsername = useCallback((username: string) => {
    void copyToClipboard(username, 'Username copied to clipboard', 'Clipboard copy failed')
  }, [copyToClipboard])

  const handleCopyPassword = useCallback((password: string) => {
    void copyToClipboard(password, 'Password copied to clipboard', 'Clipboard copy failed')
  }, [copyToClipboard])

  const handleAutofillItem = useCallback((item: VaultItem) => {
    void autofillItem(item)
  }, [autofillItem])
  const handleSelectRiskFilterFromItem = useCallback((item: VaultItem) => {
    setSelectedNode('all')
    setQuery('')
    if (item.risk === 'reused' && item.passwordMasked) {
      setRiskFilter('reused')
      setReusedPasswordFilter(item.passwordMasked)
      return
    }
    setReusedPasswordFilter(null)
    setRiskFilter((current) => (current === item.risk ? 'all' : item.risk))
  }, [setQuery, setSelectedNode])

  useEffect(() => {
    setRiskFilter('all')
    setReusedPasswordFilter(null)
  }, [selectedNode])

  const canManageCloudSyncExclusions = hasCapability('cloud.sync')
    && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))

  const filteredByRisk = useMemo(() => {
    const byRisk = riskFilter === 'all'
      ? filtered
      : filtered.filter((item) => item.risk === riskFilter)
    if (!reusedPasswordFilter) return byRisk
    return byRisk.filter((item) => item.passwordMasked === reusedPasswordFilter)
  }, [filtered, riskFilter, reusedPasswordFilter])

  const itemRows = useMemo(() => filteredByRisk.map((item) => {
    const folderLabel = item.folderId ? (folderPathById.get(item.folderId) ?? item.folder) : 'Unfiled'
    return (
      <ItemListRow
        key={item.id}
        item={item}
        isActive={item.id === selectedId}
        folderLabel={folderLabel}
        isLocalOnly={canManageCloudSyncExclusions && item.excludeFromCloudSync === true}
        onSelectItem={handleSelectItem}
        onOpenItemContextMenu={handleOpenItemContextMenu}
        onTouchStartItem={handleTouchStartItem}
        onTouchEndItem={handleTouchEndItem}
        onOpenNotes={handleOpenNotes}
        onCopyUsername={handleCopyUsername}
        onCopyPassword={handleCopyPassword}
        onAutofillItem={handleAutofillItem}
        onSelectRiskFilter={handleSelectRiskFilterFromItem}
      />
    )
  }), [
    filteredByRisk,
    selectedId,
    folderPathById,
    handleSelectItem,
    handleOpenItemContextMenu,
    handleTouchStartItem,
    handleTouchEndItem,
    handleOpenNotes,
    handleCopyUsername,
    handleCopyPassword,
    handleAutofillItem,
    handleSelectRiskFilterFromItem,
    canManageCloudSyncExclusions,
  ])

  const noCredentialsInVault = items.length === 0
  const emptyState = selectedNode === 'expiring'
    ? {
        title: 'No Upcoming Expiries',
        message: 'No credentials expire within the next 7 days.',
      }
    : selectedNode === 'expired'
      ? {
          title: 'No Expired Passwords',
          message: 'No credentials are currently marked as expired.',
        }
      : selectedNode === 'unfiled'
        ? {
            title: 'No Unfiled Credentials',
            message: 'All credentials are assigned to folders.',
          }
        : {
            title: 'Empty Vault',
            message: 'Create your first credential to get started.',
          }

  return (
    <section className={`pane pane-middle ${mobileStep === 'list' ? 'mobile-active' : ''}`}>
      <div className="pane-head">
        <button className="mobile-back-btn" onClick={() => setMobileStep('nav')}>
          <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
          Menu
        </button>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, URL, tag, folder..." />
        {selectedNode.startsWith('folder:') && (
          <div className="toggle-row">
            <button className={folderFilterMode === 'direct' ? 'active' : ''} onClick={() => setFolderFilterMode('direct')}>Direct</button>
            <button className={folderFilterMode === 'recursive' ? 'active' : ''} onClick={() => setFolderFilterMode('recursive')}>Include Subfolders</button>
          </div>
        )}
        {selectedNode !== 'trash' && (
          <div className="risk-filter-row">
            <button
              className={`risk-filter-chip ${riskFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setSelectedNode('all')
                setQuery('')
                setReusedPasswordFilter(null)
                setRiskFilter('all')
              }}
            >
              All ({items.length})
            </button>
            {riskFilterOptions.map((option) => (
              <button
                key={option.key}
                className={`risk-filter-chip risk-${option.key} ${riskFilter === option.key ? 'active' : ''}`}
                onClick={() => {
                  setSelectedNode('all')
                  setQuery('')
                  setReusedPasswordFilter(null)
                  setRiskFilter(option.key)
                }}
              >
                {option.label} ({items.filter((item) => item.risk === option.key).length})
              </button>
            ))}
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
      ) : filteredByRisk.length === 0 ? (
        <div className="detail-grid">
          <h3>{riskFilter === 'all' ? emptyState.title : `No ${riskLabelByState[riskFilter]} Credentials`}</h3>
          <p className="muted">
            {reusedPasswordFilter
              ? 'No credentials match the selected reused password group.'
              : (riskFilter === 'all' ? emptyState.message : `No credentials match the ${riskLabelByState[riskFilter]} filter in this view.`)}
          </p>
          {noCredentialsInVault && (
            <button className="solid" style={{ alignSelf: 'start' }} onClick={createItem}>+ Create First Credential</button>
          )}
        </div>
      ) : (
        <ul className="item-list">{itemRows}</ul>
      )}
    </section>
  )
}
