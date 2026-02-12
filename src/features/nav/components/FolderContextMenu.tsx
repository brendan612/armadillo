import { useEffect, useRef } from 'react'
import {
  FolderOpen,
  FolderPlus,
  Pencil,
  ArrowUpToLine,
  Copy,
  Trash2,
  SlidersHorizontal,
} from 'lucide-react'
import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function FolderContextMenu() {
  const { contextMenu, folders } = useVaultAppState()
  const {
    setSelectedNode,
    setMobileStep,
    startFolderInlineRename,
    openFolderEditor,
    createSubfolder,
    deleteFolderCascade,
    moveFolder,
    copyToClipboard,
    setContextMenu,
  } = useVaultAppActions()

  const menuRef = useRef<HTMLDivElement | null>(null)

  // Viewport-clamp the menu position after mount
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const pad = 8
    let x = contextMenu.x
    let y = contextMenu.y

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
  }, [contextMenu])

  if (!contextMenu) return null

  const folder = folders.find((f) => f.id === contextMenu.folderId)
  const isNested = folder?.parentId !== null

  function dismiss() {
    setContextMenu(null)
  }

  return (
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
  )
}
