import { CloudAuthStatusCard } from './CloudAuthStatusCard'
import { CloudSnapshotsCard } from './CloudSnapshotsCard'
import { DesktopTitlebar } from '../../layout/components/DesktopTitlebar'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import logoSrc from '../../../assets/armadillo.png'

export function CreateVaultScreen() {
  const { effectivePlatform } = useVaultAppDerived()
  const { createPassword, confirmPassword, vaultError, pendingVaultExists, authMessage, localVaultPath, storageMode, cloudCacheExpiresAt } = useVaultAppState()
  const { setCreatePassword, setConfirmPassword, createVault, setPhase, chooseLocalVaultLocation } = useVaultAppActions()

  return (
    <div className={`app-shell platform-${effectivePlatform}`}>
      <div className="shell-noise" aria-hidden="true" />
      <DesktopTitlebar />
      <main className="auth-screen">
        <div className="auth-card">
          <div className="auth-hero">
            <img className="auth-icon" src={logoSrc} alt="Armadillo" />
            <h1>Armadillo</h1>
            <p className="auth-tagline">Create a new encrypted vault</p>
          </div>

          <CloudAuthStatusCard />
          {authMessage && <p className="muted" style={{ margin: 0, textAlign: 'center' }}>{authMessage}</p>}
          <CloudSnapshotsCard />

          {window.armadilloShell?.isElectron && storageMode === 'local_file' && (
            <div className="auth-secondary">
              <p className="muted" style={{ margin: 0 }}>
                {localVaultPath || 'No vault file location set'}
              </p>
              <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>Choose Vault Location</button>
            </div>
          )}
          {storageMode === 'cloud_only' && (
            <div className="auth-secondary">
              <p className="muted" style={{ margin: 0 }}>
                {cloudCacheExpiresAt
                  ? `Cloud-only cache expires ${new Date(cloudCacheExpiresAt).toLocaleString()}`
                  : 'Cloud-only mode active. Vault data will be cached locally without a permanent file.'}
              </p>
            </div>
          )}

          <div className="auth-form-section">
            <label>
              Master Password
              <input
                type="password"
                name="armadillo_new_master_password"
                autoComplete="new-password"
                placeholder="Choose a strong master password"
                value={createPassword}
                onChange={(event) => setCreatePassword(event.target.value)}
              />
            </label>
            <label>
              Confirm Password
              <input
                type="password"
                name="armadillo_confirm_master_password"
                autoComplete="new-password"
                placeholder="Re-enter master password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          </div>

          {vaultError && <p className="auth-error">{vaultError}</p>}

          <button className="solid auth-primary-btn" onClick={() => void createVault()}>Create Encrypted Vault</button>

          {pendingVaultExists && (
            <>
              <div className="auth-divider" />
              <div className="auth-secondary">
                <button className="ghost" onClick={() => setPhase('unlock')}>Unlock Existing Vault</button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
