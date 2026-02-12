import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function EditFolderModal() {
  const { folderEditorOpen, folderEditor, folders } = useVaultAppState()
  const { folderPathById } = useVaultAppDerived()
  const { setFolderEditorOpen, setFolderEditor, saveFolderEditor } = useVaultAppActions()

  if (!folderEditorOpen || !folderEditor) return null

  return (
    <div className="settings-overlay">
      <div className="settings-backdrop" onClick={() => setFolderEditorOpen(false)} />
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Folder Properties</h2>
          <button className="icon-btn" onClick={() => setFolderEditorOpen(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="settings-body">
          <section className="settings-section">
            <label>
              Name
              <input
                value={folderEditor.name}
                onChange={(event) => setFolderEditor((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
              />
            </label>
            <label>
              Parent
              <select
                value={folderEditor.parentId ?? ''}
                onChange={(event) =>
                  setFolderEditor((prev) => (prev ? { ...prev, parentId: event.target.value || null } : prev))
                }
              >
                <option value="">(Root)</option>
                {folders
                  .filter((folder) => folder.id !== folderEditor.id)
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folderPathById.get(folder.id) ?? folder.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Color
              <input
                type="color"
                value={folderEditor.color}
                onChange={(event) => setFolderEditor((prev) => (prev ? { ...prev, color: event.target.value } : prev))}
              />
            </label>
            <label>
              Icon
              <input
                value={folderEditor.icon}
                onChange={(event) => setFolderEditor((prev) => (prev ? { ...prev, icon: event.target.value } : prev))}
              />
            </label>
            <label>
              Notes
              <textarea
                rows={3}
                value={folderEditor.notes}
                onChange={(event) => setFolderEditor((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
              />
            </label>
            <div className="settings-action-list">
              <button className="solid" onClick={() => void saveFolderEditor()}>Save Folder</button>
              <button className="ghost" onClick={() => setFolderEditorOpen(false)}>Cancel</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
