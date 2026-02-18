import { ChevronLeft, FileText, Image, KeyRound, LockKeyhole, Tag } from 'lucide-react'
import type { VaultStorageItem } from '../../../types/vault'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

function kindLabel(kind: VaultStorageItem['kind']) {
  if (kind === 'image') return 'Image'
  if (kind === 'key') return 'Key'
  if (kind === 'token') return 'Token'
  if (kind === 'secret') return 'Secret'
  if (kind === 'document') return 'Document'
  return 'Other'
}

function kindIcon(kind: VaultStorageItem['kind']) {
  if (kind === 'image') return <Image size={14} aria-hidden="true" />
  if (kind === 'key') return <KeyRound size={14} aria-hidden="true" />
  if (kind === 'token' || kind === 'secret') return <LockKeyhole size={14} aria-hidden="true" />
  return <FileText size={14} aria-hidden="true" />
}

export function StorageListPane() {
  const { query, selectedStorageId, selectedNode, folderFilterMode, trash, mobileStep, storageItems, workspaceSection, syncProvider } = useVaultAppState()
  const { filteredStorage, folderPathById, effectivePlatform, hasCapability } = useVaultAppDerived()
  const {
    setQuery,
    setFolderFilterMode,
    restoreTrashEntry,
    deleteTrashEntryPermanently,
    createStorageItem,
    setSelectedStorageId,
    setMobileStep,
    setStorageContextMenu,
  } = useVaultAppActions()

  const canManageCloudSyncExclusions = hasCapability('cloud.sync')
    && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))
  const noStorageInVault = storageItems.length === 0

  return (
    <section className={`pane pane-middle ${mobileStep === 'list' ? 'mobile-active' : ''}`} hidden={workspaceSection !== 'storage'}>
      <div className="pane-head">
        <button className="mobile-back-btn" onClick={() => setMobileStep('nav')}>
          <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
          Menu
        </button>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search storage title, tags, notes..." />
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
                <strong>
                  {entry.kind === 'storageItemSnapshot'
                    ? 'Deleted storage item'
                    : entry.kind === 'folderTreeSnapshot'
                      ? 'Deleted folder tree'
                      : 'Deleted credential'}
                </strong>
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
      ) : filteredStorage.length === 0 ? (
        <div className="detail-grid">
          <h3>Empty Storage</h3>
          <p className="muted">No storage items match this view yet.</p>
          {noStorageInVault && (
            <button className="solid" style={{ alignSelf: 'start' }} onClick={createStorageItem}>+ Create First Storage Item</button>
          )}
        </div>
      ) : (
        <ul className="item-list">
          {filteredStorage.map((item) => {
            const folderLabel = item.folderId ? (folderPathById.get(item.folderId) ?? item.folder) : 'Unfiled'
            const isLocalOnly = canManageCloudSyncExclusions && item.excludeFromCloudSync === true
            return (
              <li
                key={item.id}
                className={item.id === selectedStorageId ? 'active' : ''}
                onClick={() => {
                  setSelectedStorageId(item.id)
                  if (effectivePlatform === 'mobile') {
                    setMobileStep('detail')
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setStorageContextMenu({ itemId: item.id, x: event.clientX, y: event.clientY })
                }}
              >
                <div className="item-info">
                  <div className="item-inline-top">
                    <strong className="item-title">{item.title || 'Untitled'}</strong>
                    {isLocalOnly && <span className="item-local-badge">Local only</span>}
                  </div>
                  <p className="item-secondary">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      {kindIcon(item.kind)}
                      {kindLabel(item.kind)}
                    </span>
                    <span className="item-bullet" aria-hidden="true">&bull;</span>
                    <span>{item.blobRef?.fileName || (item.textValue ? 'Text value' : 'No file')}</span>
                  </p>
                </div>
                <div className="row-meta">
                  <div className="item-inline-actions">
                    <span className="item-action-btn" title={item.blobRef ? 'Has file attachment' : 'No file'}>
                      <Tag size={14} aria-hidden="true" />
                    </span>
                  </div>
                  <span className="folder-tag">{folderLabel}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
