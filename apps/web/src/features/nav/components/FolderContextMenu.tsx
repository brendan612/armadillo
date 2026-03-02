import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Cloud,
  CloudOff,
  FolderOpen,
  FolderPlus,
  Pencil,
  ArrowUpToLine,
  Copy,
  Trash2,
  SlidersHorizontal,
} from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function FolderContextMenu() {
  const { contextMenu, folders, syncProvider } = useVaultAppState()
  const { hasCapability } = useVaultAppDerived()
  const {
    setSelectedNode,
    setMobileStep,
    startFolderInlineRename,
    openFolderEditor,
    setFolderCloudSyncExcluded,
    createSubfolder,
    deleteFolderCascade,
    moveFolder,
    copyToClipboard,
    setContextMenu,
  } = useVaultAppActions()

  const menuRef = useRef<HTMLDivElement | null>(null)
  const folder = contextMenu ? folders.find((f) => f.id === contextMenu.folderId) : undefined
  const isNested = folder?.parentId !== null
  const isLocalOnly = folder?.excludeFromCloudSync === true
  const canManageCloudSyncExclusions = hasCapability('cloud.sync')
    && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))

  // Viewport-clamp the menu position after mount
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const el = menuRef.current
    const pad = 8

    const positionMenu = () => {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const maxHeight = Math.max(120, viewportHeight - pad * 2)
      el.style.maxHeight = `${maxHeight}px`
      const menuWidth = el.offsetWidth
      const menuHeight = Math.min(el.scrollHeight, maxHeight)
      let x = contextMenu.x
      let y = contextMenu.y

      if (x + menuWidth > viewportWidth - pad) {
        x = viewportWidth - menuWidth - pad
      }
      if (y + menuHeight > viewportHeight - pad) {
        // Prefer opening upward when near the viewport bottom.
        y = contextMenu.y - menuHeight
      }
      if (x < pad) x = pad
      if (y < pad) {
        y = viewportHeight - menuHeight - pad
      }
      if (y < pad) y = pad

      el.style.left = `${Math.round(x)}px`
      el.style.top = `${Math.round(y)}px`
      el.style.opacity = '1'
    }

    const rafId = window.requestAnimationFrame(positionMenu)
    const rafId2 = window.requestAnimationFrame(positionMenu)
    const handleResize = () => positionMenu()
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.cancelAnimationFrame(rafId2)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize, true)
    }
  }, [contextMenu, isNested, isLocalOnly])

  if (!contextMenu) return null

  function dismiss() {
    setContextMenu(null)
  }

  return createPortal(
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: contextMenu.x, top: contextMenu.y, opacity: 0 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* --- Navigation --- */}
      <button
        className="ctx-menu-item"
        onClick={() => {
          setSelectedNode(`folder:${contextMenu.folderId}`)
          setMobileStep('list')
          dismiss()
        }}
      >
        <FolderOpen className="ctx-menu-icon" />
        <span className="ctx-menu-label">Open</span>
      </button>

      <div className="ctx-menu-divider" />

      {/* --- Edit --- */}
      <button
        className="ctx-menu-item"
        onClick={() => {
          createSubfolder(contextMenu.folderId)
          dismiss()
        }}
      >
        <FolderPlus className="ctx-menu-icon" />
        <span className="ctx-menu-label">New Subfolder</span>
      </button>

      <button
        className="ctx-menu-item"
        onClick={() => {
          startFolderInlineRename(contextMenu.folderId)
        }}
      >
        <Pencil className="ctx-menu-icon" />
        <span className="ctx-menu-label">Rename</span>
        <kbd className="ctx-menu-shortcut">F2</kbd>
      </button>

      <div className="ctx-menu-divider" />

      {/* --- Organise --- */}
      {isNested && (
        <button
          className="ctx-menu-item"
          onClick={() => {
            void moveFolder(contextMenu.folderId, null)
            dismiss()
          }}
        >
          <ArrowUpToLine className="ctx-menu-icon" />
          <span className="ctx-menu-label">Move to Root</span>
        </button>
      )}

      <button
        className="ctx-menu-item"
        onClick={() => {
          if (folder) {
            openFolderEditor(folder)
          }
        }}
      >
        <SlidersHorizontal className="ctx-menu-icon" />
        <span className="ctx-menu-label">Properties</span>
      </button>

      {canManageCloudSyncExclusions && (
        <button
          className="ctx-menu-item"
          onClick={() => {
            void setFolderCloudSyncExcluded(contextMenu.folderId, !isLocalOnly)
            dismiss()
          }}
        >
          {isLocalOnly ? <Cloud className="ctx-menu-icon" /> : <CloudOff className="ctx-menu-icon" />}
          <span className="ctx-menu-label">{isLocalOnly ? 'Include in Cloud Sync' : 'Exclude from Cloud Sync'}</span>
        </button>
      )}

      <button
        className="ctx-menu-item"
        onClick={() => {
          if (folder) {
            void copyToClipboard(folder.name, 'Folder name copied', 'Copy failed')
          }
          dismiss()
        }}
      >
        <Copy className="ctx-menu-icon" />
        <span className="ctx-menu-label">Copy Name</span>
      </button>

      <div className="ctx-menu-divider" />

      {/* --- Danger --- */}
      <button
        className="ctx-menu-item danger"
        onClick={() => {
          void deleteFolderCascade(contextMenu.folderId)
          dismiss()
        }}
      >
        <Trash2 className="ctx-menu-icon" />
        <span className="ctx-menu-label">Delete Folder</span>
      </button>
    </div>
    ,
    document.body,
  )
}
