import { CloudAuthStatusCard } from './CloudAuthStatusCard'
import { CloudSnapshotsCard } from './CloudSnapshotsCard'
import { DesktopTitlebar } from '../../layout/components/DesktopTitlebar'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function CreateVaultScreen() {
  const { effectivePlatform } = useVaultAppDerived()
  const { createPassword, confirmPassword, vaultError, pendingVaultExists, authMessage, localVaultPath } = useVaultAppState()
  const { setCreatePassword, setConfirmPassword, createVault, setPhase, chooseLocalVaultLocation } = useVaultAppActions()

  return (
    <div className={`app-shell platform-${effectivePlatform}`}>
      <div className="shell-noise" aria-hidden="true" />
      <DesktopTitlebar />
      <main className="detail-grid auth-screen">
        <h1>Create Local Armadillo Vault</h1>
        <p className="muted">A local encrypted `.armadillo` vault file is the canonical database on this device.</p>
        <CloudAuthStatusCard />
        {authMessage && <p className="muted" style={{ margin: 0 }}>{authMessage}</p>}
        <CloudSnapshotsCard />
        {window.armadilloShell?.isElectron && (
          <>
            <p className="muted" style={{ margin: 0 }}>Vault file path: {localVaultPath || 'Not set'}</p>
            <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>Choose Vault Location</button>
          </>
        )}
        <label>
          Master Password
          <input
            type="password"
            name="armadillo_new_master_password"
            autoComplete="new-password"
            value={createPassword}
            onChange={(event) => setCreatePassword(event.target.value)}
          />
        </label>
        <label>
          Confirm Master Password
          <input
            type="password"
            name="armadillo_confirm_master_password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        {vaultError && <p style={{ color: '#d85f5f' }}>{vaultError}</p>}
        <button className="solid" onClick={() => void createVault()}>Create Encrypted Vault</button>
        {pendingVaultExists && <button className="ghost" onClick={() => setPhase('unlock')}>Unlock Existing Vault</button>}
      </main>
    </div>
  )
}
