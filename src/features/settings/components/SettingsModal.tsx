import { useCallback, useEffect, useRef, useState } from 'react'
import { biometricSupported } from '../../../lib/biometric'
import { isNativeAndroid } from '../../../shared/utils/platform'
import { getSafeRetentionDays } from '../../../shared/utils/trash'
import AutofillBridge from '../../../plugins/autofillBridge'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function SettingsModal() {
  const {
    showSettings,
    cloudAuthState,
    cloudSyncEnabled,
    biometricEnabled,
    vaultSettings,
    cloudIdentity,
  } = useVaultAppState()
  const { cloudConnected } = useVaultAppDerived()
  const {
    setShowSettings,
    signInWithGoogle,
    signOutCloud,
    createPasskeyIdentity,
    setCloudSyncEnabled,
    pushVaultToCloudNow,
    enableBiometricUnlock,
    exportVaultFile,
    triggerImport,
    chooseLocalVaultLocation,
    setVaultSettings,
    persistPayload,
    clearLocalVaultFile,
  } = useVaultAppActions()

  const [autofillEnabled, setAutofillEnabled] = useState(false)
  const [autofillSupported, setAutofillSupported] = useState(false)

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
                  {cloudAuthState === 'checking' ? 'Checking Session...' : 'Sign in with Google'}
                </button>
              ) : (
                <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
              )}
              <button className="ghost" onClick={() => void createPasskeyIdentity()}>Bind Passkey Identity</button>
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3>Cloud Sync</h3>
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
              {biometricSupported() && (
                <button className={biometricEnabled ? 'solid' : 'ghost'} onClick={() => void enableBiometricUnlock()}>
                  {biometricEnabled ? 'Biometric Enabled' : 'Enable Biometric'}
                </button>
              )}
            </div>
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
              {window.armadilloShell?.isElectron && (
                <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>Choose Vault Location</button>
              )}
            </div>
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
              <button className="ghost" onClick={() => { clearLocalVaultFile(); window.location.reload() }}>Reset Local Vault</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
