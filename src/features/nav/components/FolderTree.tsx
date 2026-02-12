import type { VaultFolder } from '../../../types/vault'
import { useVaultAppActions, useVaultAppRefs, useVaultAppState } from '../../../app/contexts/VaultAppContext'

type FolderTreeProps = {
  parentId: string | null
  depth?: number
}

function FolderTreeNodes({ parentId, depth = 0 }: FolderTreeProps) {
  const { items, selectedNode } = useVaultAppState()
  const { folderLongPressTimerRef } = useVaultAppRefs()
  const { getChildrenFolders, setSelectedNode, setMobileStep, setContextMenu } = useVaultAppActions()

  const rows = getChildrenFolders(parentId)
  if (rows.length === 0) return null

  return (
    <ul className="folder-tree-list">
      {rows.map((folder: VaultFolder) => {
        const nodeKey = `folder:${folder.id}` as const
        const directCount = items.filter((item) => item.folderId === folder.id).length
        return (
          <li key={folder.id}>
            <button
              className={`folder-tree-node ${selectedNode === nodeKey ? 'active' : ''}`}
              style={{ paddingLeft: `${0.55 + depth * 0.7}rem` }}
              onClick={() => {
                setSelectedNode(nodeKey)
                setMobileStep('list')
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setContextMenu({ folderId: folder.id, x: event.clientX, y: event.clientY })
              }}
              onTouchStart={(event) => {
                if (folderLongPressTimerRef.current) {
                  window.clearTimeout(folderLongPressTimerRef.current)
                }
                const touch = event.touches[0]
                folderLongPressTimerRef.current = window.setTimeout(() => {
                  setContextMenu({ folderId: folder.id, x: touch.clientX, y: touch.clientY })
                }, 520)
              }}
              onTouchEnd={() => {
                if (folderLongPressTimerRef.current) {
                  window.clearTimeout(folderLongPressTimerRef.current)
                  folderLongPressTimerRef.current = null
                }
              }}
            >
              <span className="folder-tree-label">{folder.icon === 'folder' ? '[ ]' : folder.icon} {folder.name}</span>
              <span className="folder-tree-count">{directCount}</span>
            </button>
            <FolderTreeNodes parentId={folder.id} depth={depth + 1} />
          </li>
        )
      })}
    </ul>
  )
}

export function FolderTree({ parentId, depth = 0 }: FolderTreeProps) {
  return <FolderTreeNodes parentId={parentId} depth={depth} />
}
