import { useCallback, useEffect, useRef, useState } from 'react'
import { isNativeAndroid } from '../../../shared/utils/platform'
import { getSafeRetentionDays } from '../../../shared/utils/trash'
import AutofillBridge from '../../../plugins/autofillBridge'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function SettingsModal() {
  const {
    showSettings,
    cloudAuthState,
    cloudSyncEnabled,
    storageMode,
    cloudCacheTtlHours,
    cloudCacheExpiresAt,
    syncProvider,
    biometricEnabled,
    syncMessage,
    vaultSettings,
    cloudIdentity,
    autoFolderPreview,
    autoFolderPreviewDraft,
    showAutoFolderPreview,
    autoFolderBusy,
    autoFolderError,
    autoFolderPreferencesDirty,
    autoFolderWarnings,
  } = useVaultAppState()
  const { cloudConnected } = useVaultAppDerived()
  const {
    setShowSettings,
    signInWithGoogle,
    signOutCloud,
    createPasskeyIdentity,
    setCloudSyncEnabled,
    setStorageMode,
    setCloudCacheTtlHours,
    pushVaultToCloudNow,
    enableBiometricUnlock,
    exportVaultFile,
    triggerImport,
    triggerGooglePasswordImport,
    previewAutoFoldering,
    cancelAutoFolderingPreview,
    applyAutoFoldering,
    updateAutoFolderPreviewAssignment,
    excludeItemFromAutoFoldering,
    lockAutoFolderPath,
    saveAutoFolderPreferences,
    chooseLocalVaultLocation,
    setVaultSettings,
    persistPayload,
    clearLocalVaultFile,
    clearCachedVaultSnapshot,
  } = useVaultAppActions()

  const [autofillEnabled, setAutofillEnabled] = useState(false)
  const [autofillSupported, setAutofillSupported] = useState(false)
  const [showAutoFolderItems, setShowAutoFolderItems] = useState(false)
  const [autoFolderSearch, setAutoFolderSearch] = useState('')

  const checkAutofillStatus = useCallback(() => {
    if (!isNativeAndroid()) return
    AutofillBridge.isAutofillServiceEnabled()
      .then((result) => {
        setAutofillEnabled(result.enabled)
        setAutofillSupported(result.supported)
      })
      .catch(() => {
        setAutofillSupported(false)
      })
  }, [])

  useEffect(() => {
    if (showSettings) {
      checkAutofillStatus()
    }
  }, [showSettings, checkAutofillStatus])

  // Let the system back gesture (Android swipe / browser back) close the modal
  const closedByPopStateRef = useRef(false)
  useEffect(() => {
    if (!showSettings) return

    closedByPopStateRef.current = false
    window.history.pushState({ settingsOpen: true }, '')

    function onPopState() {
      closedByPopStateRef.current = true
      setShowSettings(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      // If closed by X / backdrop (not popstate), clean up the history entry we pushed
      if (!closedByPopStateRef.current) {
        window.history.back()
      }
    }
  }, [showSettings, setShowSettings])

  useEffect(() => {
    if (showAutoFolderPreview) return
    setShowAutoFolderItems(false)
    setAutoFolderSearch('')
  }, [showAutoFolderPreview])

  const previewPlan = autoFolderPreviewDraft ?? autoFolderPreview
  const filteredAssignments = (previewPlan?.assignments ?? []).filter((assignment) => {
    const query = autoFolderSearch.trim().toLowerCase()
    if (!query) return true
    return (
      assignment.itemTitle.toLowerCase().includes(query) ||
      assignment.primaryUrl.toLowerCase().includes(query) ||
      assignment.targetPath.toLowerCase().includes(query)
    )
  })
  const previewLockedPathSet = new Set((previewPlan?.lockedFolderPaths ?? []).map((path) => path.trim().toLowerCase()).filter(Boolean))

  if (!showSettings) return null

  return (
    <div className="settings-overlay">
      <div className="settings-backdrop" onClick={() => setShowSettings(false)} />
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={() => setShowSettings(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="settings-body">
          <section className="settings-section">
            <h3>Account</h3>
            <div className="settings-identity">
              <span className={`dot-status ${cloudConnected ? 'connected' : 'disconnected'}`} />
              <span>{cloudConnected ? cloudIdentity || 'Google connected' : 'Not signed in'}</span>
            </div>
            <div className="settings-action-list">
              {!cloudConnected ? (
                <button className="ghost" onClick={() => void signInWithGoogle()} disabled={cloudAuthState === 'checking'}>
                  {cloudAuthState === 'checking' ? 'Checking Session...' : (syncProvider === 'self_hosted' ? 'Authenticate' : 'Sign in with Google')}
                </button>
              ) : (
                <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
              )}
              {syncProvider !== 'self_hosted' && (
                <button className="ghost" onClick={() => void createPasskeyIdentity()}>Bind Passkey Identity</button>
              )}
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3>Storage Mode</h3>
            <div className="settings-toggle-row">
              <span>Vault Persistence</span>
              <div className="settings-action-list">
                <button
                  className={storageMode === 'local_file' ? 'solid' : 'ghost'}
                  onClick={() => setStorageMode('local_file')}
                >
                  Local File
                </button>
                <button
                  className={storageMode === 'cloud_only' ? 'solid' : 'ghost'}
                  onClick={() => setStorageMode('cloud_only')}
                >
                  Cloud Only
                </button>
              </div>
            </div>
            <label>
              Cloud Cache TTL (hours)
              <input
                type="number"
                min={1}
                max={720}
                value={cloudCacheTtlHours}
                onChange={(event) => setCloudCacheTtlHours(Math.max(1, Math.min(720, Math.round(Number(event.target.value) || 72))))}
              />
            </label>
            <p className="muted" style={{ marginBottom: 0 }}>
              {cloudCacheExpiresAt
                ? `Cache expires ${new Date(cloudCacheExpiresAt).toLocaleString()}`
                : 'No encrypted cache currently stored'}
            </p>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3>Cloud Sync</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Provider: {syncProvider === 'self_hosted' ? 'Self-hosted' : 'Convex'}
            </p>
            <div className="settings-toggle-row">
              <span>Auto Sync</span>
              <button className={cloudSyncEnabled ? 'solid' : 'ghost'} onClick={() => setCloudSyncEnabled((v) => !v)}>
                {cloudSyncEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="settings-action-list">
              <button className="ghost" onClick={() => void pushVaultToCloudNow()}>Push Vault to Cloud Now</button>
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3>Security</h3>
            <div className="settings-action-list">
              {isNativeAndroid() ? (
                <button className={biometricEnabled ? 'solid' : 'ghost'} onClick={() => void enableBiometricUnlock()}>
                  {biometricEnabled ? 'Biometric Enabled' : 'Enable Biometric'}
                </button>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Biometric quick unlock is available in the Android app.
                </p>
              )}
            </div>
            {isNativeAndroid() && syncMessage.toLowerCase().includes('biometric') && (
              <p className="muted" style={{ marginTop: '0.45rem', marginBottom: 0 }}>
                {syncMessage}
              </p>
            )}
          </section>

          {isNativeAndroid() && autofillSupported && (
            <>
              <div className="settings-divider" />
              <section className="settings-section">
                <h3>Autofill</h3>
                <div className="settings-identity">
                  <span className={`dot-status ${autofillEnabled ? 'connected' : 'disconnected'}`} />
                  <span>{autofillEnabled ? 'Armadillo is your autofill provider' : 'Autofill not enabled'}</span>
                </div>
                <div className="settings-action-list">
                  <button
                    className={autofillEnabled ? 'solid' : 'ghost'}
                    onClick={() => {
                      void AutofillBridge.openAutofillSettings().then(() => {
                        setTimeout(checkAutofillStatus, 1000)
                      })
                    }}
                  >
                    {autofillEnabled ? 'Autofill Settings' : 'Enable Autofill'}
                  </button>
                </div>
              </section>
            </>
          )}

          <div className="settings-divider" />

          <section className="settings-section">
            <h3>Vault</h3>
            <div className="settings-action-list">
              <button className="ghost" onClick={exportVaultFile}>Export .armadillo</button>
              <button className="ghost" onClick={triggerImport}>Import .armadillo</button>
              <button className="ghost" onClick={triggerGooglePasswordImport}>Import Google Passwords (.csv)</button>
              <button className="ghost" onClick={() => void previewAutoFoldering()} disabled={autoFolderBusy}>
                {autoFolderBusy ? 'Building Auto-Folder Plan...' : 'Auto-Folder Unfiled Items'}
              </button>
              {window.armadilloShell?.isElectron && storageMode === 'local_file' && (
                <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>Choose Vault Location</button>
              )}
            </div>
            {showAutoFolderPreview && previewPlan && (
              <div className="auto-folder-preview-card">
                <div className="auto-folder-preview-head">
                  <strong>Auto-Folder Preview</strong>
                  <span>
                    {previewPlan.moveCount} move(s)
                  </span>
                </div>
                <div className="auto-folder-preview-stats">
                  <span>{previewPlan.consideredCount} unfiled considered</span>
                  <span>{previewPlan.topLevelCount} top-level folder(s)</span>
                  <span>{previewPlan.subfolderCount} subfolder(s)</span>
                  <span>{previewPlan.lowConfidenceCount} low-confidence assignment(s)</span>
                  <span>{previewPlan.excludedCount} excluded item(s)</span>
                </div>
                {previewPlan.buckets.length > 0 ? (
                  <ul className="auto-folder-preview-list">
                    {previewPlan.buckets.map((bucket) => (
                      <li key={bucket.topLevel}>
                        <div className="auto-folder-preview-row">
                          <span>{bucket.topLevel}</span>
                          <span>{bucket.count}</span>
                        </div>
                        {bucket.subfolders.length > 0 && (
                          <p className="auto-folder-preview-subfolders">
                            {bucket.subfolders.map((subfolder) => `${subfolder.name} (${subfolder.count})`).join(', ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No eligible unfiled items were found.</p>
                )}
                {autoFolderWarnings.length > 0 && (
                  <ul className="auto-folder-warning-list">
                    {autoFolderWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
                <div className="settings-action-list">
                  <button className="ghost" onClick={() => setShowAutoFolderItems((current) => !current)}>
                    {showAutoFolderItems ? 'Hide Item-Level Review' : 'Show Item-Level Review'}
                  </button>
                </div>
                {showAutoFolderItems && (
                  <div className="auto-folder-review">
                    <input
                      value={autoFolderSearch}
                      onChange={(event) => setAutoFolderSearch(event.target.value)}
                      placeholder="Filter by title, URL, or target folder..."
                    />
                    <ul className="auto-folder-review-list">
                      {filteredAssignments.map((assignment) => {
                        const pathKey = assignment.targetPath.trim().toLowerCase()
                        const isLocked = previewLockedPathSet.has(pathKey)
                        return (
                          <li key={assignment.itemId}>
                            <div className="auto-folder-review-head">
                              <strong>{assignment.itemTitle || 'Untitled'}</strong>
                              <span className={`auto-folder-confidence auto-folder-confidence-${assignment.confidenceLevel}`}>
                                {assignment.confidenceLevel}
                              </span>
                            </div>
                            {assignment.primaryUrl && <p className="auto-folder-review-url">{assignment.primaryUrl}</p>}
                            <input
                              value={assignment.targetPath}
                              onChange={(event) => updateAutoFolderPreviewAssignment(assignment.itemId, event.target.value)}
                              placeholder="Target folder path"
                              disabled={assignment.excluded}
                            />
                            <div className="auto-folder-review-actions">
                              <label className="auto-folder-exclude-toggle">
                                <input
                                  type="checkbox"
                                  checked={Boolean(assignment.excluded)}
                                  onChange={(event) => excludeItemFromAutoFoldering(assignment.itemId, event.target.checked)}
                                />
                                Exclude
                              </label>
                              <button
                                className={isLocked ? 'solid' : 'ghost'}
                                onClick={() => lockAutoFolderPath(assignment.targetPath, !isLocked)}
                              >
                                {isLocked ? 'Locked' : 'Lock Path'}
                              </button>
                            </div>
                            <p className="auto-folder-reason-text">
                              {assignment.reasons.join(' · ')}
                            </p>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                {autoFolderError && <p className="password-mismatch-msg">{autoFolderError}</p>}
                <div className="settings-action-list">
                  <button
                    className={autoFolderPreferencesDirty ? 'solid' : 'ghost'}
                    disabled={autoFolderBusy}
                    onClick={() => void saveAutoFolderPreferences()}
                  >
                    Save Auto-Folder Preferences
                  </button>
                  <button
                    className="solid"
                    disabled={autoFolderBusy || previewPlan.moveCount === 0}
                    onClick={() => void applyAutoFoldering()}
                  >
                    {autoFolderBusy ? 'Applying...' : 'Apply Auto-Folder Plan'}
                  </button>
                  <button className="ghost" disabled={autoFolderBusy} onClick={cancelAutoFolderingPreview}>Cancel</button>
                </div>
              </div>
            )}
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3>Trash</h3>
            <label>
              Retention (days)
              <input
                type="number"
                min={1}
                max={3650}
                value={vaultSettings.trashRetentionDays}
                onChange={(event) => {
                  const nextDays = getSafeRetentionDays(Number(event.target.value))
                  setVaultSettings((prev) => ({ ...prev, trashRetentionDays: nextDays }))
                }}
              />
            </label>
            <div className="settings-action-list">
              <button
                className="ghost"
                onClick={() => void persistPayload({ settings: vaultSettings })}
              >
                Save Trash Settings
              </button>
              <button
                className="ghost"
                onClick={() => void persistPayload({ trash: [] })}
              >
                Empty Trash
              </button>
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3>Danger Zone</h3>
            <div className="settings-action-list">
              <button
                className="ghost"
                onClick={() => {
                  clearLocalVaultFile()
                  clearCachedVaultSnapshot()
                  window.location.reload()
                }}
              >
                Reset Local Cache + Vault
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
