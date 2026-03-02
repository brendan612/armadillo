import { useMemo, useState } from 'react'
import type { ArmadilloVaultFile } from '../../../types/vault'
import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

function statusLabel(status: 'exists' | 'missing' | 'unknown') {
  if (status === 'exists') return 'Available'
  if (status === 'missing') return 'Missing'
  return 'Unknown'
}

function vaultFileLabel(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

function vaultFolderLabel(path: string) {
  const trimmed = path.trim()
  if (!trimmed) return ''
  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slashIndex < 0) return trimmed
  if (slashIndex === 0) return trimmed.slice(0, 1)
  return trimmed.slice(0, slashIndex)
}

export function LocalVaultPickerCard() {
  const {
    phase,
    storageMode,
    localVaultPath,
    selectedLocalVaultStatus,
    recentLocalVaultPaths,
    recentLocalVaultPathStatuses,
    cloudVaultCandidates,
    localVaultNameById,
  } = useVaultAppState()
  const {
    browseExistingLocalVault,
    chooseLocalVaultLocation,
    deleteVaultFromCloud,
    prepareNamedLocalVault,
    selectRecentLocalVaultPath,
    removeRecentLocalVaultPath,
    loadVaultFromCloud,
  } = useVaultAppActions()
  const hasLocal = window.armadilloShell?.isElectron && storageMode === 'local_file'
  const hasCloud = cloudVaultCandidates.length > 0
  const [preferredTab, setPreferredTab] = useState<'cloud' | 'local' | null>(null)
  const [selectedCloudSnapshotKey, setSelectedCloudSnapshotKey] = useState('')
  const [isDeletingCloudVault, setIsDeletingCloudVault] = useState(false)
  const [newVaultName, setNewVaultName] = useState('')
  const activeTab: 'cloud' | 'local' = useMemo(() => {
    if (preferredTab === 'cloud' && hasCloud) return 'cloud'
    if (preferredTab === 'local' && hasLocal) return 'local'
    return hasCloud ? 'cloud' : 'local'
  }, [preferredTab, hasCloud, hasLocal])

  const selectedCloudSnapshot = useMemo<ArmadilloVaultFile | null>(() => {
    if (!cloudVaultCandidates.length) return null
    return cloudVaultCandidates.find((entry) => `${entry.vaultId}:${entry.revision}:${entry.updatedAt}` === selectedCloudSnapshotKey)
      ?? cloudVaultCandidates[0]
  }, [cloudVaultCandidates, selectedCloudSnapshotKey])
  const selectedCloudSnapshotResolvedKey = selectedCloudSnapshot
    ? `${selectedCloudSnapshot.vaultId}:${selectedCloudSnapshot.revision}:${selectedCloudSnapshot.updatedAt}`
    : ''
  const selectedLocalStatusForDisplay = useMemo(() => {
    if (phase === 'create' && selectedLocalVaultStatus === 'missing' && localVaultPath.trim()) {
      return 'pending' as const
    }
    return selectedLocalVaultStatus
  }, [phase, selectedLocalVaultStatus, localVaultPath])
  const localVaultFileName = useMemo(() => (localVaultPath ? vaultFileLabel(localVaultPath) : ''), [localVaultPath])
  const localVaultFolder = useMemo(() => (localVaultPath ? vaultFolderLabel(localVaultPath) : ''), [localVaultPath])

  if (!hasLocal && !hasCloud) {
    return null
  }

  return (
    <section className="auth-status-card vault-picker-card">
      {(hasLocal || hasCloud) && (
        <div className="vault-tabs">
          {hasCloud && (
            <button
                className={activeTab === 'cloud' ? 'solid' : 'ghost'}
              onClick={() => setPreferredTab('cloud')}
            >
              Cloud
            </button>
          )}
          {hasLocal && (
            <button
                className={activeTab === 'local' ? 'solid' : 'ghost'}
              onClick={() => setPreferredTab('local')}
            >
              Local
            </button>
          )}
        </div>
      )}
      {activeTab === 'local' && hasLocal && (
        <>
          <div className="vault-picker-head">
            <p className="muted" style={{ margin: 0 }}>Local Vault</p>
            <span className={`vault-status-pill is-${selectedLocalStatusForDisplay}`}>
              {selectedLocalStatusForDisplay === 'pending' ? 'New' : statusLabel(selectedLocalStatusForDisplay)}
            </span>
          </div>
          <p className="muted vault-picker-path" style={{ margin: 0 }} title={localVaultPath}>
            {localVaultPath || 'No vault selected'}
          </p>
          {phase === 'create' && (
            <div className="vault-create-destination">
              <p className="vault-create-destination-label">Save location</p>
              {localVaultPath ? (
                <>
                  <p className="vault-create-destination-file" title={localVaultFileName}>
                    {localVaultFileName}
                  </p>
                  <p className="vault-create-destination-folder" title={localVaultFolder}>
                    {localVaultFolder}
                  </p>
                </>
              ) : (
                <p className="vault-create-destination-empty">Pick a location to create your new vault.</p>
              )}
            </div>
          )}
          <div className="vault-picker-actions">
            <button className="ghost" onClick={() => void browseExistingLocalVault()}>Browse</button>
            <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>New Location</button>
          </div>
          <div className="vault-picker-create-row">
            <input
              value={newVaultName}
              onChange={(event) => setNewVaultName(event.target.value)}
              placeholder="New vault name..."
              aria-label="New vault name"
            />
            <button
              className="solid vault-picker-remove"
              onClick={() => {
                prepareNamedLocalVault(newVaultName)
                setNewVaultName('')
              }}
            >
              Create New Vault
            </button>
          </div>
          {recentLocalVaultPaths.length > 0 && (
            <div className="vault-picker-recent">
              <div className="vault-picker-recent-row">
                <select
                  id="vault-picker-recent-select"
                  value={localVaultPath}
                  onChange={(event) => selectRecentLocalVaultPath(event.target.value)}
                >
                  {!localVaultPath && <option value="">Select saved vault...</option>}
                  {recentLocalVaultPaths.map((entry) => {
                    const rawStatus = recentLocalVaultPathStatuses[entry.path] ?? 'unknown'
                    const status = phase === 'create' && entry.path === localVaultPath && rawStatus === 'missing'
                      ? 'pending'
                      : rawStatus
                    const usedAt = new Date(entry.lastUsedAt).toLocaleString()
                    return (
                      <option key={entry.path} value={entry.path}>
                        {`${vaultFileLabel(entry.path)} - ${status === 'pending' ? 'New' : statusLabel(status)} - ${usedAt}`}
                      </option>
                    )
                  })}
                </select>
                <button
                  className="ghost danger vault-picker-remove"
                  onClick={() => removeRecentLocalVaultPath(localVaultPath)}
                  disabled={!localVaultPath}
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {activeTab === 'cloud' && hasCloud && (
        <>
          <div className="vault-picker-head">
            <p className="muted" style={{ margin: 0 }}>Cloud Snapshot</p>
            <span className="vault-status-pill is-exists">Latest by default</span>
          </div>
          <div className="vault-picker-recent">
            <div className="vault-picker-cloud-row">
              <select
                value={selectedCloudSnapshotResolvedKey}
                onChange={(event) => setSelectedCloudSnapshotKey(event.target.value)}
              >
                {cloudVaultCandidates.map((snapshot) => {
                  const key = `${snapshot.vaultId}:${snapshot.revision}:${snapshot.updatedAt}`
                  const localName = localVaultNameById[snapshot.vaultId]
                  const label = localName || `Vault ${snapshot.vaultId.slice(0, 8)}`
                  return (
                    <option key={key} value={key}>
                      {`${label} - r${snapshot.revision} - ${new Date(snapshot.updatedAt).toLocaleString()}`}
                    </option>
                  )
                })}
              </select>
              <button
                className="solid vault-picker-remove"
                onClick={() => {
                  if (selectedCloudSnapshot) {
                    loadVaultFromCloud(selectedCloudSnapshot)
                  }
                }}
                disabled={!selectedCloudSnapshot || isDeletingCloudVault}
              >
                Load
              </button>
              <button
                className="ghost danger vault-picker-remove"
                disabled={!selectedCloudSnapshot || isDeletingCloudVault}
                onClick={() => {
                  if (!selectedCloudSnapshot || isDeletingCloudVault) {
                    return
                  }
                  const label = localVaultNameById[selectedCloudSnapshot.vaultId] || `Vault ${selectedCloudSnapshot.vaultId.slice(0, 8)}`
                  const confirmed = window.confirm(
                    `Delete ${label} from cloud?\n\nThis removes the encrypted cloud copy and its synced files for this vault. Local vault files are not deleted.`,
                  )
                  if (!confirmed) {
                    return
                  }
                  setIsDeletingCloudVault(true)
                  void deleteVaultFromCloud(selectedCloudSnapshot).finally(() => setIsDeletingCloudVault(false))
                }}
              >
                {isDeletingCloudVault ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
