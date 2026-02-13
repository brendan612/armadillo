import { ChevronLeft, Copy, Keyboard, NotebookPen, UserRound } from 'lucide-react'
import type { VaultItem } from '../../../types/vault'
import { useVaultAppActions, useVaultAppDerived, useVaultAppRefs, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function ItemListPane() {
  const { query, selectedNode, folderFilterMode, trash, mobileStep } = useVaultAppState()
  const { filtered, selected, folderPathById } = useVaultAppDerived()
  const { folderLongPressTimerRef } = useVaultAppRefs()
  const {
    setQuery,
    setFolderFilterMode,
    restoreTrashEntry,
    deleteTrashEntryPermanently,
    createItem,
    setSelectedId,
    setMobileStep,
    setItemContextMenu,
    setActivePanel,
    copyToClipboard,
    autofillItem,
  } = useVaultAppActions()

  return (
    <section className={`pane pane-middle ${mobileStep === 'list' ? 'mobile-active' : ''}`}>
      <div className="pane-head">
        <button className="mobile-back-btn" onClick={() => setMobileStep('nav')}>
          <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
          Menu
        </button>
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
              onClick={() => {
                setSelectedId(item.id)
                setMobileStep('detail')
              }}
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
              <ItemRow item={item} folderPathById={folderPathById} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  function ItemRow({ item, folderPathById: pathById }: { item: VaultItem; folderPathById: Map<string, string> }) {
    return (
      <>
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
            <span>&bull;</span>
            <span>{item.passwordMasked ? '*'.repeat(Math.min(24, Math.max(8, item.passwordMasked.length))) : 'No password'}</span>
          </p>
        </div>
        <div className="row-meta">
          <span className="folder-tag">{item.folderId ? (pathById.get(item.folderId) ?? item.folder) : 'Unfiled'}</span>
        </div>
      </>
    )
  }
}
