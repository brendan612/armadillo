import { useEffect, useRef } from 'react'
import { Cloud, CloudOff, Download, ExternalLink, Trash2 } from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function StorageContextMenu() {
  const { storageContextMenu, storageItems, syncProvider } = useVaultAppState()
  const { hasCapability } = useVaultAppDerived()
  const {
    setSelectedStorageId,
    setMobileStep,
    setStorageContextMenu,
    removeStorageItemById,
    setStorageItemCloudSyncExcluded,
    downloadStorageFile,
    openStorageWorkspace,
  } = useVaultAppActions()

  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!storageContextMenu || !menuRef.current) return
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const pad = 8
    let x = storageContextMenu.x
    let y = storageContextMenu.y

    if (x + rect.width > window.innerWidth - pad) x = window.innerWidth - rect.width - pad
    if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad
    if (x < pad) x = pad
    if (y < pad) y = pad

    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.opacity = '1'
  }, [storageContextMenu])

  if (!storageContextMenu) return null

  const item = storageItems.find((row) => row.id === storageContextMenu.itemId)
  const isLocalOnly = item?.excludeFromCloudSync === true
  const canManageCloudSyncExclusions = hasCapability('cloud.sync')
    && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: storageContextMenu.x, top: storageContextMenu.y, opacity: 0 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className="ctx-menu-item"
        onClick={() => {
          openStorageWorkspace()
          setSelectedStorageId(storageContextMenu.itemId)
          setMobileStep('detail')
          setStorageContextMenu(null)
        }}
      >
        <ExternalLink className="ctx-menu-icon" />
        <span className="ctx-menu-label">Open Storage Item</span>
      </button>

      <button
        className="ctx-menu-item"
        disabled={!item?.blobRef}
        onClick={() => {
          void downloadStorageFile(storageContextMenu.itemId)
          setStorageContextMenu(null)
        }}
      >
        <Download className="ctx-menu-icon" />
        <span className="ctx-menu-label">Download File</span>
      </button>

      {canManageCloudSyncExclusions && (
        <button
          className="ctx-menu-item"
          onClick={() => {
            void setStorageItemCloudSyncExcluded(storageContextMenu.itemId, !isLocalOnly)
            setStorageContextMenu(null)
          }}
        >
          {isLocalOnly ? <Cloud className="ctx-menu-icon" /> : <CloudOff className="ctx-menu-icon" />}
          <span className="ctx-menu-label">{isLocalOnly ? 'Include in Cloud Sync' : 'Exclude from Cloud Sync'}</span>
        </button>
      )}

      <div className="ctx-menu-divider" />

      <button
        className="ctx-menu-item danger"
        onClick={() => {
          void removeStorageItemById(storageContextMenu.itemId)
          setStorageContextMenu(null)
        }}
      >
        <Trash2 className="ctx-menu-icon" />
        <span className="ctx-menu-label">Delete Storage Item</span>
      </button>
    </div>
  )
}
