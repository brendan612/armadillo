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

export function LocalVaultPickerCard() {
  const {
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
    selectRecentLocalVaultPath,
    removeRecentLocalVaultPath,
    loadVaultFromCloud,
  } = useVaultAppActions()
  const hasLocal = window.armadilloShell?.isElectron && storageMode === 'local_file'
  const hasCloud = cloudVaultCandidates.length > 0
  const [preferredTab, setPreferredTab] = useState<'cloud' | 'local' | null>(null)
  const [selectedCloudSnapshotKey, setSelectedCloudSnapshotKey] = useState('')
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
            <span className={`vault-status-pill is-${selectedLocalVaultStatus}`}>
              {statusLabel(selectedLocalVaultStatus)}
            </span>
          </div>
          <p className="muted vault-picker-path" style={{ margin: 0 }} title={localVaultPath}>
            {localVaultPath || 'No vault selected'}
          </p>
          <div className="vault-picker-actions">
            <button className="ghost" onClick={() => void browseExistingLocalVault()}>Browse</button>
            <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>New Location</button>
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
                    const status = recentLocalVaultPathStatuses[entry.path] ?? 'unknown'
                    const usedAt = new Date(entry.lastUsedAt).toLocaleString()
                    return (
                      <option key={entry.path} value={entry.path}>
                        {`${vaultFileLabel(entry.path)} - ${statusLabel(status)} - ${usedAt}`}
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
            <div className="vault-picker-recent-row">
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
                disabled={!selectedCloudSnapshot}
              >
                Load
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
