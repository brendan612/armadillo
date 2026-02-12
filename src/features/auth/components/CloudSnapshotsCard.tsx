import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function CloudSnapshotsCard() {
  const { cloudVaultCandidates, showAllCloudSnapshots } = useVaultAppState()
  const { loadVaultFromCloud, setShowAllCloudSnapshots } = useVaultAppActions()

  if (cloudVaultCandidates.length === 0) {
    return null
  }

  const latest = cloudVaultCandidates[0]
  const olderSnapshots = cloudVaultCandidates.slice(1, 6)
  const hasOlder = cloudVaultCandidates.length > 1
  const olderCount = cloudVaultCandidates.length - 1

  return (
    <section className="auth-status-card">
      <p className="muted" style={{ margin: 0 }}>Cloud save available</p>
      <button className="solid" onClick={() => loadVaultFromCloud()}>
        Load Latest Cloud Save
      </button>
      <p className="muted" style={{ margin: 0 }}>
        {`Latest revision r${latest.revision} (${new Date(latest.updatedAt).toLocaleString()})`}
      </p>
      {hasOlder && (
        <>
          <button className="ghost" onClick={() => setShowAllCloudSnapshots((prev) => !prev)}>
            {showAllCloudSnapshots ? 'Hide Older Saves' : `Show Older Saves (${olderCount})`}
          </button>
          {showAllCloudSnapshots && (
            <div className="detail-grid" style={{ gap: '.35rem' }}>
              {olderSnapshots.map((snapshot) => (
                <button
                  key={`${snapshot.vaultId}-${snapshot.revision}-${snapshot.updatedAt}`}
                  className="ghost"
                  onClick={() => loadVaultFromCloud(snapshot)}
                >
                  {`${snapshot.vaultId.slice(0, 8)} - r${snapshot.revision} - ${new Date(snapshot.updatedAt).toLocaleString()}`}
                </button>
              ))}
              {olderCount > olderSnapshots.length && (
                <p className="muted" style={{ margin: 0 }}>
                  {`Showing ${olderSnapshots.length} of ${olderCount} older saves.`}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
