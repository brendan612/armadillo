import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function CreateFolderModal() {
  const { createFolderModal, newFolderName } = useVaultAppState()
  const { setCreateFolderModal, setNewFolderName, submitCreateSubfolder } = useVaultAppActions()

  if (!createFolderModal) return null

  return (
    <div className="settings-overlay">
      <div className="settings-backdrop" onClick={() => setCreateFolderModal(null)} />
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Create Subfolder</h2>
          <button className="icon-btn" onClick={() => setCreateFolderModal(null)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="settings-body">
          <section className="settings-section">
            <label>
              Folder Name
              <input
                autoFocus
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="e.g. Banking"
              />
            </label>
            <div className="settings-action-list">
              <button className="solid" onClick={() => void submitCreateSubfolder()} disabled={!newFolderName.trim()}>
                Create Folder
              </button>
              <button className="ghost" onClick={() => setCreateFolderModal(null)}>Cancel</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
