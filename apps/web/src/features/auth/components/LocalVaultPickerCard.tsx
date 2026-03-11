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

function cloudSnapshotKey(snapshot: ArmadilloVaultFile) {
  return `${snapshot.vaultId}:${snapshot.revision}:${snapshot.updatedAt}`
}

function cloudSnapshotLabel(snapshot: ArmadilloVaultFile, localVaultNameById: Record<string, string>) {
  const localName = localVaultNameById[snapshot.vaultId]
  const label = localName || `Vault ${snapshot.vaultId.slice(0, 8)}`
  return `${label} - r${snapshot.revision} - ${new Date(snapshot.updatedAt).toLocaleString()}`
}

function orgLabel(orgName: string | null, orgId: string) {
  return orgName?.trim() || `Organization ${orgId.slice(0, 8)}`
}

function sharedVaultLabel(vaultId: string) {
  return `Shared vault ${vaultId.slice(0, 8)}`
}

type LocalVaultPickerCardProps = {
  mode?: 'full' | 'compact'
}

export function LocalVaultPickerCard({ mode = 'full' }: LocalVaultPickerCardProps) {
  const {
    phase,
    storageMode,
    localVaultPath,
    selectedLocalVaultStatus,
    recentLocalVaultPaths,
    recentLocalVaultPathStatuses,
    cloudVaultCandidates,
    selectedCloudVaultSnapshot,
    localVaultNameById,
    orgMemberships,
    selectedOrgId,
    orgSharedVaultCandidates,
    selectedOrgSharedVaultId,
    selectedUnlockSourceKind,
  } = useVaultAppState()
  const {
    browseExistingLocalVault,
    chooseLocalVaultLocation,
    deleteVaultFromCloud,
    prepareNamedLocalVault,
    selectRecentLocalVaultPath,
    removeRecentLocalVaultPath,
    loadVaultFromCloud,
    selectCloudVaultSnapshot,
    setSelectedOrgId,
    selectOrgSharedVaultSummary,
    useLocalUnlockSource: selectLocalUnlockSource,
  } = useVaultAppActions()
  const isCompact = mode === 'compact'
  const hasLocal = window.armadilloShell?.isElectron && storageMode === 'local_file'
  const hasCloud = cloudVaultCandidates.length > 0
  const hasOrgMemberships = orgMemberships.length > 0
  const hasCloudTab = hasCloud || hasOrgMemberships
  const [preferredTab, setPreferredTab] = useState<'cloud' | 'local' | null>(null)
  const [showSelector, setShowSelector] = useState(false)
  const [selectedCloudSnapshotKey, setSelectedCloudSnapshotKey] = useState('')
  const [isDeletingCloudVault, setIsDeletingCloudVault] = useState(false)
  const [newVaultName, setNewVaultName] = useState('')
  const selectedOrgMembership = useMemo(
    () => orgMemberships.find((membership) => membership.orgId === selectedOrgId) ?? orgMemberships[0] ?? null,
    [orgMemberships, selectedOrgId],
  )
  const selectedSharedVault = useMemo(
    () => orgSharedVaultCandidates.find((entry) => entry.vaultId === selectedOrgSharedVaultId) ?? orgSharedVaultCandidates[0] ?? null,
    [orgSharedVaultCandidates, selectedOrgSharedVaultId],
  )

  const selectedCloudSnapshot = useMemo<ArmadilloVaultFile | null>(() => {
    if (!cloudVaultCandidates.length) return selectedCloudVaultSnapshot ?? null
    return cloudVaultCandidates.find((entry) => cloudSnapshotKey(entry) === selectedCloudSnapshotKey)
      ?? (selectedCloudVaultSnapshot
        ? cloudVaultCandidates.find((entry) => cloudSnapshotKey(entry) === cloudSnapshotKey(selectedCloudVaultSnapshot)) ?? null
        : null)
      ?? cloudVaultCandidates[0]
  }, [cloudVaultCandidates, selectedCloudSnapshotKey, selectedCloudVaultSnapshot])

  const activeTab: 'cloud' | 'local' = useMemo(() => {
    if (preferredTab === 'cloud' && hasCloudTab) return 'cloud'
    if (preferredTab === 'local' && hasLocal) return 'local'
    if (isCompact && (selectedUnlockSourceKind === 'org_shared' || selectedCloudVaultSnapshot) && hasCloudTab) return 'cloud'
    return hasCloudTab && !hasLocal ? 'cloud' : 'local'
  }, [preferredTab, hasCloudTab, hasLocal, isCompact, selectedCloudVaultSnapshot, selectedUnlockSourceKind])

  const selectedCloudSnapshotResolvedKey = selectedCloudSnapshot
    ? cloudSnapshotKey(selectedCloudSnapshot)
    : ''
  const selectedLocalStatusForDisplay = useMemo(() => {
    if (phase === 'create' && selectedLocalVaultStatus === 'missing' && localVaultPath.trim()) {
      return 'pending' as const
    }
    return selectedLocalVaultStatus
  }, [phase, selectedLocalVaultStatus, localVaultPath])
  const localVaultFileName = useMemo(() => (localVaultPath ? vaultFileLabel(localVaultPath) : ''), [localVaultPath])
  const localVaultFolder = useMemo(() => (localVaultPath ? vaultFolderLabel(localVaultPath) : ''), [localVaultPath])
  const compactSummaryText = useMemo(() => {
    if (selectedUnlockSourceKind === 'org_shared' && selectedSharedVault && selectedOrgMembership) {
      return `Using ${sharedVaultLabel(selectedSharedVault.vaultId)} from ${orgLabel(selectedOrgMembership.orgName, selectedOrgMembership.orgId)}`
    }
    if (selectedCloudVaultSnapshot) {
      const localName = localVaultNameById[selectedCloudVaultSnapshot.vaultId]
      return localName
        ? `Using latest version of ${localName}`
        : `Using latest version from vault ${selectedCloudVaultSnapshot.vaultId.slice(0, 8)}`
    }
    if (localVaultFileName) {
      return `Using local vault ${localVaultFileName}`
    }
    if (hasCloudTab) {
      return hasOrgMemberships ? 'Choose a personal or shared cloud vault' : 'Using latest cloud version'
    }
    return 'Choose a vault to unlock'
  }, [selectedCloudVaultSnapshot, localVaultNameById, localVaultFileName, hasCloudTab, hasOrgMemberships, selectedOrgMembership, selectedSharedVault, selectedUnlockSourceKind])
  const compactSummaryMeta = useMemo(() => {
    if (selectedUnlockSourceKind === 'org_shared' && selectedSharedVault && selectedOrgMembership) {
      return `${selectedOrgMembership.role} - r${selectedSharedVault.revision} - ${new Date(selectedSharedVault.updatedAt).toLocaleString()}`
    }
    if (selectedCloudVaultSnapshot) {
      return `Cloud - r${selectedCloudVaultSnapshot.revision} - ${new Date(selectedCloudVaultSnapshot.updatedAt).toLocaleString()}`
    }
    if (localVaultPath) {
      return localVaultPath
    }
    if (hasOrgMemberships) {
      return 'Org-shared vaults are available from the cloud tab'
    }
    return hasLocal ? 'Local file' : ''
  }, [selectedCloudVaultSnapshot, localVaultPath, hasLocal, hasOrgMemberships, selectedOrgMembership, selectedSharedVault, selectedUnlockSourceKind])

  if (!hasLocal && !hasCloudTab && !selectedCloudVaultSnapshot) {
    return null
  }

  if (isCompact) {
    return (
      <section className="vault-picker-inline">
        <div className="vault-picker-summary">
          <div className="vault-picker-summary-copy">
            <p className="vault-picker-summary-label">Vault version</p>
            <p className="vault-picker-summary-text">{compactSummaryText}</p>
            {compactSummaryMeta && <p className="vault-picker-summary-meta" title={compactSummaryMeta}>{compactSummaryMeta}</p>}
          </div>
          {(hasLocal || hasCloudTab) && (
            <button
              className="auth-link-btn"
              type="button"
              onClick={() => setShowSelector((prev) => !prev)}
            >
              {showSelector ? 'Hide' : 'Change'}
            </button>
          )}
        </div>

        {showSelector && (
          <div className="vault-picker-change-panel">
            {hasLocal && hasCloudTab && (
              <div className="vault-tabs">
                <button
                  className={activeTab === 'cloud' ? 'solid' : 'ghost'}
                  type="button"
                  onClick={() => {
                    setPreferredTab('cloud')
                    if (selectedCloudSnapshot) {
                      selectCloudVaultSnapshot(selectedCloudSnapshot)
                    }
                  }}
                >
                  Cloud
                </button>
                <button
                  className={activeTab === 'local' ? 'solid' : 'ghost'}
                  type="button"
                  onClick={() => {
                    setPreferredTab('local')
                    selectLocalUnlockSource()
                  }}
                >
                  Local
                </button>
              </div>
            )}

            {activeTab === 'cloud' && hasCloudTab && (
              <div className="vault-picker-recent" style={{ gap: '0.85rem' }}>
                {hasCloud && (
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    <p className="muted" style={{ margin: 0 }}>Personal cloud vault</p>
                    <select
                      className="vault-picker-select"
                      value={selectedCloudSnapshotResolvedKey}
                      onChange={(event) => {
                        const nextSnapshot = cloudVaultCandidates.find((snapshot) => cloudSnapshotKey(snapshot) === event.target.value) ?? null
                        setSelectedCloudSnapshotKey(event.target.value)
                        if (nextSnapshot) {
                          selectCloudVaultSnapshot(nextSnapshot)
                        }
                      }}
                    >
                      {cloudVaultCandidates.map((snapshot) => (
                        <option key={cloudSnapshotKey(snapshot)} value={cloudSnapshotKey(snapshot)}>
                          {cloudSnapshotLabel(snapshot, localVaultNameById)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {hasOrgMemberships && (
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    <p className="muted" style={{ margin: 0 }}>Organization shared vault</p>
                    <select
                      className="vault-picker-select"
                      value={selectedOrgMembership?.orgId ?? ''}
                      onChange={(event) => setSelectedOrgId(event.target.value)}
                    >
                      {orgMemberships.map((membership) => (
                        <option key={membership.orgId} value={membership.orgId}>
                          {`${orgLabel(membership.orgName, membership.orgId)} - ${membership.role}`}
                        </option>
                      ))}
                    </select>
                    <select
                      className="vault-picker-select"
                      value={selectedSharedVault?.vaultId ?? ''}
                      onChange={(event) => selectOrgSharedVaultSummary(event.target.value)}
                      disabled={!selectedOrgMembership || orgSharedVaultCandidates.length === 0}
                    >
                      {orgSharedVaultCandidates.length === 0 ? (
                        <option value="">No shared vaults available yet</option>
                      ) : (
                        orgSharedVaultCandidates.map((vault) => (
                          <option key={vault.vaultId} value={vault.vaultId}>
                            {`${sharedVaultLabel(vault.vaultId)} - r${vault.revision} - ${new Date(vault.updatedAt).toLocaleString()}`}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'local' && hasLocal && (
              <div className="vault-picker-recent">
                <p className="muted" style={{ margin: 0 }}>Choose a local vault file.</p>
                {recentLocalVaultPaths.length > 0 && (
                  <select
                    className="vault-picker-select"
                    value={localVaultPath}
                    onChange={(event) => {
                      selectLocalUnlockSource()
                      selectRecentLocalVaultPath(event.target.value)
                    }}
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
                )}
                <div className="vault-picker-actions vault-picker-actions-single">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      selectLocalUnlockSource()
                      void browseExistingLocalVault()
                    }}
                  >
                    Browse Local Vault
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="auth-status-card vault-picker-card">
      {(hasLocal || hasCloudTab) && (
        <div className="vault-tabs">
          {hasCloudTab && (
            <button
              className={activeTab === 'cloud' ? 'solid' : 'ghost'}
              type="button"
              onClick={() => setPreferredTab('cloud')}
            >
              Cloud
            </button>
          )}
          {hasLocal && (
            <button
              className={activeTab === 'local' ? 'solid' : 'ghost'}
              type="button"
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
            <button className="ghost" type="button" onClick={() => void browseExistingLocalVault()}>Browse</button>
            <button className="ghost" type="button" onClick={() => void chooseLocalVaultLocation()}>New Location</button>
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
              type="button"
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
                  type="button"
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
      {activeTab === 'cloud' && hasCloudTab && (
        <>
          <div className="vault-picker-head">
            <p className="muted" style={{ margin: 0 }}>Cloud Vaults</p>
            <span className="vault-status-pill is-exists">Personal and shared</span>
          </div>
          <div className="vault-picker-recent" style={{ gap: '1rem' }}>
            {hasCloud && (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <p className="muted" style={{ margin: 0 }}>Personal cloud vault</p>
                <div className="vault-picker-cloud-row">
                  <select
                    value={selectedCloudSnapshotResolvedKey}
                    onChange={(event) => {
                      setSelectedCloudSnapshotKey(event.target.value)
                      const nextSnapshot = cloudVaultCandidates.find((snapshot) => cloudSnapshotKey(snapshot) === event.target.value) ?? null
                      if (nextSnapshot) {
                        selectCloudVaultSnapshot(nextSnapshot)
                      }
                    }}
                  >
                    {cloudVaultCandidates.map((snapshot) => {
                      const key = cloudSnapshotKey(snapshot)
                      return (
                        <option key={key} value={key}>
                          {cloudSnapshotLabel(snapshot, localVaultNameById)}
                        </option>
                      )
                    })}
                  </select>
                  <button
                    className="solid vault-picker-remove"
                    type="button"
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
                    type="button"
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
            )}

            {hasOrgMemberships && (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <p className="muted" style={{ margin: 0 }}>Shared organization vault</p>
                <select
                  className="vault-picker-select"
                  value={selectedOrgMembership?.orgId ?? ''}
                  onChange={(event) => setSelectedOrgId(event.target.value)}
                >
                  {orgMemberships.map((membership) => (
                    <option key={membership.orgId} value={membership.orgId}>
                      {`${orgLabel(membership.orgName, membership.orgId)} - ${membership.role}`}
                    </option>
                  ))}
                </select>
                <select
                  className="vault-picker-select"
                  value={selectedSharedVault?.vaultId ?? ''}
                  onChange={(event) => selectOrgSharedVaultSummary(event.target.value)}
                  disabled={!selectedOrgMembership || orgSharedVaultCandidates.length === 0}
                >
                  {orgSharedVaultCandidates.length === 0 ? (
                    <option value="">No shared vaults available yet</option>
                  ) : (
                    orgSharedVaultCandidates.map((vault) => (
                      <option key={vault.vaultId} value={vault.vaultId}>
                        {`${sharedVaultLabel(vault.vaultId)} - r${vault.revision} - ${new Date(vault.updatedAt).toLocaleString()}`}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
