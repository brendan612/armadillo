import { useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { CloudAuthStatusCard } from './CloudAuthStatusCard'
import { LocalVaultPickerCard } from './LocalVaultPickerCard'
import { DesktopTitlebar } from '../../layout/components/DesktopTitlebar'
import { useVaultAppActions, useVaultAppDerived, useVaultAppRefs, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import logoSrc from '../../../assets/armadillo.png'

export function UnlockVaultScreen() {
  const [showRecoveryKeyBox, setShowRecoveryKeyBox] = useState(false)
  const { effectivePlatform } = useVaultAppDerived()
  const {
    unlockPassword,
    unlockRecoveryKey,
    isUnlocking,
    vaultError,
    authMessage,
    quickUnlockEnabled,
    quickUnlockCapabilities,
    storageMode,
    cloudCacheExpiresAt,
    unlockSourceAvailable,
  } = useVaultAppState()
  const { importFileInputRef } = useVaultAppRefs()
  const { setUnlockPassword, setUnlockRecoveryKey, unlockVault, unlockVaultQuickUnlock, unlockVaultWithRecoveryKey, triggerImport, setPhase, onImportFileSelected } = useVaultAppActions()
  const showQuickUnlock = quickUnlockCapabilities.supported && quickUnlockEnabled && unlockSourceAvailable

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
              {showQuickUnlock && quickUnlockCapabilities.method === 'android-native' && (
                <button
                  className="ghost quick-unlock-inline-btn"
                  type="button"
                  aria-label={quickUnlockCapabilities.unlockLabel}
                  title={quickUnlockCapabilities.unlockLabel}
                  disabled={isUnlocking}
                  onClick={() => void unlockVaultQuickUnlock()}
                >
                  <Fingerprint size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
            {showQuickUnlock && quickUnlockCapabilities.method === 'webauthn-platform' && (
              <button className="ghost" type="button" disabled={isUnlocking} onClick={() => void unlockVaultQuickUnlock()}>
                {quickUnlockCapabilities.unlockLabel}
              </button>
            )}
            {isUnlocking && (
              <p className="auth-unlock-status" role="status" aria-live="polite">
                Decrypting vault and preparing workspace...
              </p>
            )}
          </form>

          <div className="auth-form-section" style={{ paddingTop: 0, marginTop: '-0.7rem' }}>
            {!showRecoveryKeyBox ? (
              <button
                type="button"
                disabled={isUnlocking}
                onClick={() => setShowRecoveryKeyBox(true)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  margin: 0,
                  fontSize: '0.78rem',
                  color: 'var(--ink-muted)',
                  textDecoration: 'underline',
                  cursor: isUnlocking ? 'default' : 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                Use recovery key
              </button>
            ) : (
              <>
                <label htmlFor="armadillo_unlock_recovery_key">Recovery Key</label>
                <div className="auth-input-group">
                  <input
                    id="armadillo_unlock_recovery_key"
                    type="text"
                    name="armadillo_unlock_recovery_key"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="XXXX-XXXX-... recovery key"
                    value={unlockRecoveryKey}
                    onChange={(event) => setUnlockRecoveryKey(event.target.value)}
                    disabled={isUnlocking}
                  />
                  <button className="ghost unlock-submit-btn" type="button" disabled={isUnlocking} onClick={() => void unlockVaultWithRecoveryKey()}>
                    Unlock
                  </button>
                </div>
              </>
            )}
          </div>

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
