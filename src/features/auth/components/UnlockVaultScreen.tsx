import { Fingerprint } from 'lucide-react'
import { biometricSupported } from '../../../lib/biometric'
import { isNativeAndroid } from '../../../shared/utils/platform'
import { CloudAuthStatusCard } from './CloudAuthStatusCard'
import { LocalVaultPickerCard } from './LocalVaultPickerCard'
import { DesktopTitlebar } from '../../layout/components/DesktopTitlebar'
import { useVaultAppActions, useVaultAppDerived, useVaultAppRefs, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import logoSrc from '../../../assets/armadillo.png'

export function UnlockVaultScreen() {
  const { effectivePlatform } = useVaultAppDerived()
  const { unlockPassword, isUnlocking, vaultError, authMessage, biometricEnabled, storageMode, cloudCacheExpiresAt, unlockSourceAvailable } = useVaultAppState()
  const { importFileInputRef } = useVaultAppRefs()
  const { setUnlockPassword, unlockVault, unlockVaultBiometric, triggerImport, setPhase, onImportFileSelected } = useVaultAppActions()

  return (
    <div className={`app-shell platform-${effectivePlatform}`}>
      <div className="shell-noise" aria-hidden="true" />
      <DesktopTitlebar />
      <main className="auth-screen">
        <div className="auth-card">
          <div className="auth-hero">
            <img className="auth-icon" src={logoSrc} alt="Armadillo" />
            <h1>Armadillo</h1>
            <p className="auth-tagline">Unlock your encrypted vault</p>
          </div>

          <form
            className="auth-form-section"
            autoComplete="off"
            data-lpignore="true"
            onSubmit={(event) => {
              event.preventDefault()
              if (isUnlocking) return
              void unlockVault()
            }}
          >
            <label htmlFor="armadillo_unlock_master_password">Master Password</label>
            <div className="auth-input-group">
              <input
                id="armadillo_unlock_master_password"
                type="password"
                name="armadillo_unlock_master_password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                placeholder="Enter master password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
                disabled={isUnlocking}
              />
              <button className="solid unlock-submit-btn" type="submit" disabled={isUnlocking} aria-busy={isUnlocking}>
                {isUnlocking ? (
                  <span className="unlock-btn-busy">
                    <span className="unlock-spinner" aria-hidden="true" />
                    Unlocking
                  </span>
                ) : (
                  'Unlock'
                )}
              </button>
              {isNativeAndroid() && biometricSupported() && biometricEnabled && unlockSourceAvailable && (
                <button
                  className="ghost biometric-inline-btn"
                  type="button"
                  aria-label="Unlock with Biometrics"
                  title="Unlock with Biometrics"
                  disabled={isUnlocking}
                  onClick={() => void unlockVaultBiometric()}
                >
                  <Fingerprint size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
            {isUnlocking && (
              <p className="auth-unlock-status" role="status" aria-live="polite">
                Decrypting vault and preparing workspace...
              </p>
            )}
          </form>

          {vaultError && <p className="auth-error">{vaultError}</p>}

          <CloudAuthStatusCard />
          {authMessage && <p className="muted" style={{ margin: 0, textAlign: 'center' }}>{authMessage}</p>}
          {storageMode === 'local_file' && !unlockSourceAvailable && (
            <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
              Select a vault to unlock.
            </p>
          )}
          <LocalVaultPickerCard />

          <div className="auth-divider" />

          <div className="auth-secondary">
            {storageMode === 'cloud_only' && (
              <p className="muted" style={{ margin: 0 }}>
                {cloudCacheExpiresAt
                  ? `Cloud-only cache expires ${new Date(cloudCacheExpiresAt).toLocaleString()}`
                  : 'Cloud-only mode active. No local vault file is stored permanently.'}
              </p>
            )}
            <button className="ghost" onClick={triggerImport}>Import .armadillo File</button>
            {!unlockSourceAvailable && (
              <button className="ghost" onClick={() => setPhase('create')}>Create New Vault</button>
            )}
          </div>
        </div>
      </main>
      <input
        ref={importFileInputRef}
        type="file"
        accept=".armadillo,application/octet-stream,application/json"
        style={{ display: 'none' }}
        onChange={(event) => void onImportFileSelected(event)}
      />
    </div>
  )
}
