import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function FolderContextMenu() {
  const { contextMenu, folders } = useVaultAppState()
  const { openFolderEditor, createSubfolder, deleteFolderCascade } = useVaultAppActions()

  if (!contextMenu) return null

  return (
    <div
      className="folder-context-menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className="ghost"
        onClick={() => {
          const target = folders.find((folder) => folder.id === contextMenu.folderId)
          if (target) {
            openFolderEditor(target)
          }
        }}
      >
        Edit Properties
      </button>
      <button className="ghost" onClick={() => createSubfolder(contextMenu.folderId)}>Add Subfolder</button>
      <button className="ghost" onClick={() => void deleteFolderCascade(contextMenu.folderId)}>Delete Folder</button>
    </div>
  )
}
