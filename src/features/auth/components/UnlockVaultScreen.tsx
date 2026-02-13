import { Fingerprint } from 'lucide-react'
import { biometricSupported } from '../../../lib/biometric'
import { CloudAuthStatusCard } from './CloudAuthStatusCard'
import { CloudSnapshotsCard } from './CloudSnapshotsCard'
import { DesktopTitlebar } from '../../layout/components/DesktopTitlebar'
import { useVaultAppActions, useVaultAppDerived, useVaultAppRefs, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import logoSrc from '../../../assets/armadillo.png'

export function UnlockVaultScreen() {
  const { effectivePlatform } = useVaultAppDerived()
  const { unlockPassword, vaultError, pendingVaultExists, authMessage, localVaultPath } = useVaultAppState()
  const { importFileInputRef } = useVaultAppRefs()
  const { setUnlockPassword, unlockVault, unlockVaultBiometric, triggerImport, setPhase, chooseLocalVaultLocation, onImportFileSelected } = useVaultAppActions()

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
              />
              <button className="solid" type="submit">Unlock</button>
              {biometricSupported() && pendingVaultExists && (
                <button
                  className="ghost biometric-inline-btn"
                  type="button"
                  aria-label="Unlock with Biometrics"
                  title="Unlock with Biometrics"
                  onClick={() => void unlockVaultBiometric()}
                >
                  <Fingerprint size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
          </form>

          {vaultError && <p className="auth-error">{vaultError}</p>}

          <CloudAuthStatusCard />
          {authMessage && <p className="muted" style={{ margin: 0, textAlign: 'center' }}>{authMessage}</p>}
          <CloudSnapshotsCard />

          <div className="auth-divider" />

          <div className="auth-secondary">
            {window.armadilloShell?.isElectron && (
              <>
                <p className="muted" style={{ margin: 0 }}>
                  {localVaultPath || 'No vault file selected'}
                </p>
                <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>Choose Vault Location</button>
              </>
            )}
            <button className="ghost" onClick={triggerImport}>Import .armadillo File</button>
            {!pendingVaultExists && (
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
