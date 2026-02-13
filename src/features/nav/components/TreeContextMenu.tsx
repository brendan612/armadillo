import { useEffect, useRef } from 'react'
import { FolderPlus, FilePlus } from 'lucide-react'
import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function TreeContextMenu() {
  const { treeContextMenu } = useVaultAppState()
  const { setTreeContextMenu, createSubfolder, createItem } = useVaultAppActions()

  const menuRef = useRef<HTMLDivElement | null>(null)

  // Viewport-clamp the menu position after mount
  useEffect(() => {
    if (!treeContextMenu || !menuRef.current) return
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const pad = 8
    let x = treeContextMenu.x
    let y = treeContextMenu.y

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
  }, [treeContextMenu])

  if (!treeContextMenu) return null

  function dismiss() {
    setTreeContextMenu(null)
  }

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: treeContextMenu.x, top: treeContextMenu.y, opacity: 0 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="ctx-menu-item"
        onClick={() => {
          createSubfolder(null)
          dismiss()
        }}
      >
        <FolderPlus className="ctx-menu-icon" />
        <span className="ctx-menu-label">New Folder</span>
      </button>

      <button
        className="ctx-menu-item"
        onClick={() => {
          createItem()
          dismiss()
        }}
      >
        <FilePlus className="ctx-menu-icon" />
        <span className="ctx-menu-label">New Item</span>
      </button>
    </div>
  )
}
