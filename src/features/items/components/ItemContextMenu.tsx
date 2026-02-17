import { useEffect, useRef } from 'react'
import {
  Cloud,
  CloudOff,
  ExternalLink,
  KeyRound,
  UserRound,
  ClipboardPaste,
  CopyPlus,
  Trash2,
} from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function ItemContextMenu() {
  const { itemContextMenu, items, syncProvider } = useVaultAppState()
  const { hasCapability } = useVaultAppDerived()
  const {
    setSelectedId,
    setMobileStep,
    setItemContextMenu,
    duplicateItem,
    copyToClipboard,
    autofillItem,
    removeItemById,
    setItemCloudSyncExcluded,
  } = useVaultAppActions()

  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!itemContextMenu || !menuRef.current) return
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const pad = 8
    let x = itemContextMenu.x
    let y = itemContextMenu.y

    if (x + rect.width > window.innerWidth - pad) {
      x = window.innerWidth - rect.width - pad
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = window.innerHeight - rect.height - pad
    }
    if (x < pad) x = pad
    if (y < pad) y = pad

    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.opacity = '1'
  }, [itemContextMenu])

  if (!itemContextMenu) return null

  const item = items.find((row) => row.id === itemContextMenu.itemId)
  const isLocalOnly = item?.excludeFromCloudSync === true
  const canManageCloudSyncExclusions = hasCapability('cloud.sync')
    && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))

  function dismiss() {
    setItemContextMenu(null)
  }

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: itemContextMenu.x, top: itemContextMenu.y, opacity: 0 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="ctx-menu-item"
        onClick={() => {
          setSelectedId(itemContextMenu.itemId)
          setMobileStep('detail')
          dismiss()
        }}
      >
        <ExternalLink className="ctx-menu-icon" />
        <span className="ctx-menu-label">Open Item</span>
      </button>

      <button
        className="ctx-menu-item"
        onClick={() => {
          void duplicateItem(itemContextMenu.itemId)
          dismiss()
        }}
      >
        <CopyPlus className="ctx-menu-icon" />
        <span className="ctx-menu-label">Duplicate</span>
      </button>

      <div className="ctx-menu-divider" />

      <button
        className="ctx-menu-item"
        onClick={() => {
          if (item?.username) {
            void copyToClipboard(item.username, 'Username copied', 'Copy failed')
          }
          dismiss()
        }}
      >
        <UserRound className="ctx-menu-icon" />
        <span className="ctx-menu-label">Copy Username</span>
        <kbd className="ctx-menu-shortcut">Ctrl+U</kbd>
      </button>

      <button
        className="ctx-menu-item"
        onClick={() => {
          if (item?.passwordMasked) {
            void copyToClipboard(item.passwordMasked, 'Password copied', 'Copy failed')
          }
          dismiss()
        }}
      >
        <KeyRound className="ctx-menu-icon" />
        <span className="ctx-menu-label">Copy Password</span>
        <kbd className="ctx-menu-shortcut">Ctrl+P</kbd>
      </button>

      <button
        className="ctx-menu-item"
        onClick={() => {
          if (item) {
            void autofillItem(item)
          }
          dismiss()
        }}
      >
        <ClipboardPaste className="ctx-menu-icon" />
        <span className="ctx-menu-label">Autofill</span>
      </button>

      {canManageCloudSyncExclusions && (
        <button
          className="ctx-menu-item"
          onClick={() => {
            void setItemCloudSyncExcluded(itemContextMenu.itemId, !isLocalOnly)
            dismiss()
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
          void removeItemById(itemContextMenu.itemId)
          dismiss()
        }}
      >
        <Trash2 className="ctx-menu-icon" />
        <span className="ctx-menu-label">Delete Item</span>
      </button>
    </div>
  )
}
