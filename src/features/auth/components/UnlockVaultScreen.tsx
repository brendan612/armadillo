import { Fingerprint } from 'lucide-react'
import { biometricSupported } from '../../../lib/biometric'
import { CloudAuthStatusCard } from './CloudAuthStatusCard'
import { CloudSnapshotsCard } from './CloudSnapshotsCard'
import { DesktopTitlebar } from '../../layout/components/DesktopTitlebar'
import { useVaultAppActions, useVaultAppDerived, useVaultAppRefs, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function UnlockVaultScreen() {
  const { effectivePlatform } = useVaultAppDerived()
  const { unlockPassword, vaultError, pendingVaultExists, authMessage, localVaultPath } = useVaultAppState()
  const { importFileInputRef } = useVaultAppRefs()
  const { setUnlockPassword, unlockVault, unlockVaultBiometric, triggerImport, setPhase, chooseLocalVaultLocation, onImportFileSelected } = useVaultAppActions()

  return (
    <div className={`app-shell platform-${effectivePlatform}`}>
      <div className="shell-noise" aria-hidden="true" />
      <DesktopTitlebar />
      <main className="detail-grid auth-screen">
        <h1>Unlock Armadillo Vault</h1>
        <p className="muted">Unlock your local encrypted `.armadillo` vault with your master password.</p>
        <CloudAuthStatusCard />
        {authMessage && <p className="muted" style={{ margin: 0 }}>{authMessage}</p>}
        {window.armadilloShell?.isElectron && (
          <>
            <p className="muted" style={{ margin: 0 }}>Vault file path: {localVaultPath || 'Not set'}</p>
            <button className="ghost" onClick={() => void chooseLocalVaultLocation()}>Choose Vault Location</button>
          </>
        )}
        <form
          autoComplete="off"
          data-lpignore="true"
          onSubmit={(event) => {
            event.preventDefault()
            void unlockVault()
          }}
        >
          <label htmlFor="armadillo_unlock_master_password">Master Password</label>
          <div className="inline-field">
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
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
            />
            <button className="solid" type="submit">Unlock Vault</button>
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
        {vaultError && <p style={{ color: '#d85f5f' }}>{vaultError}</p>}
        <CloudSnapshotsCard />
        <button className="ghost" onClick={triggerImport}>Import .armadillo Vault File</button>
        {!pendingVaultExists && <button className="ghost" onClick={() => setPhase('create')}>Create New Vault</button>}
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
