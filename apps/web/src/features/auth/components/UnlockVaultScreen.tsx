import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Eye, EyeOff, Fingerprint } from 'lucide-react'
import { CloudAuthStatusCard } from './CloudAuthStatusCard'
import { LocalVaultPickerCard } from './LocalVaultPickerCard'
import { DesktopTitlebar } from '../../layout/components/DesktopTitlebar'
import { useVaultAppActions, useVaultAppDerived, useVaultAppRefs, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import logoSrc from '../../../assets/armadillo.webp'

const LAST_TYPED_REVEAL_MS = 850

function findLastChangedCharacterIndex(previousValue: string, nextValue: string) {
  if (!nextValue || nextValue === previousValue || nextValue.length < previousValue.length) return null

  let prefixLength = 0
  while (
    prefixLength < previousValue.length
    && prefixLength < nextValue.length
    && previousValue[prefixLength] === nextValue[prefixLength]
  ) {
    prefixLength += 1
  }

  let previousSuffixIndex = previousValue.length - 1
  let nextSuffixIndex = nextValue.length - 1
  while (
    previousSuffixIndex >= prefixLength
    && nextSuffixIndex >= prefixLength
    && previousValue[previousSuffixIndex] === nextValue[nextSuffixIndex]
  ) {
    previousSuffixIndex -= 1
    nextSuffixIndex -= 1
  }

  return nextSuffixIndex >= prefixLength ? nextSuffixIndex : null
}

function buildMaskedPasswordPreview(value: string, revealedIndex: number | null) {
  return Array.from(value, (character, index) => (index === revealedIndex ? character : '•')).join('')
}

export function UnlockVaultScreen() {
  const [showRecoveryKeyBox, setShowRecoveryKeyBox] = useState(false)
  const [showMasterPassword, setShowMasterPassword] = useState(false)
  const [revealedCharacterIndex, setRevealedCharacterIndex] = useState<number | null>(null)
  const { effectivePlatform, authStatus } = useVaultAppDerived()
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
    selectedUnlockSourceKind,
  } = useVaultAppState()
  const { selectedSharedVaultSummary, selectedOrgMembership } = useVaultAppDerived()
  const { importFileInputRef } = useVaultAppRefs()
  const { setUnlockPassword, setUnlockRecoveryKey, unlockVault, unlockVaultQuickUnlock, unlockVaultWithRecoveryKey, triggerImport, setPhase, onImportFileSelected } = useVaultAppActions()
  const passwordInputRef = useRef<HTMLInputElement | null>(null)
  const revealTimeoutRef = useRef<number | null>(null)
  const sharedVaultUnlock = selectedUnlockSourceKind === 'org_shared' && Boolean(selectedSharedVaultSummary)
  const showQuickUnlock = !sharedVaultUnlock && quickUnlockCapabilities.supported && quickUnlockEnabled && unlockSourceAvailable
  const showAuthMessage = Boolean(authMessage && authMessage !== authStatus)
  const showMaskedOverlay = !showMasterPassword && unlockPassword.length > 0
  const maskedPasswordPreview = useMemo(
    () => buildMaskedPasswordPreview(unlockPassword, revealedCharacterIndex),
    [unlockPassword, revealedCharacterIndex],
  )

  function clearRevealTimeout() {
    if (revealTimeoutRef.current === null) return
    window.clearTimeout(revealTimeoutRef.current)
    revealTimeoutRef.current = null
  }

  function queuePasswordMask() {
    clearRevealTimeout()
    revealTimeoutRef.current = window.setTimeout(() => {
      setRevealedCharacterIndex(null)
      revealTimeoutRef.current = null
    }, LAST_TYPED_REVEAL_MS)
  }

  function handleUnlockPasswordChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value
    setUnlockPassword(nextValue)

    if (showMasterPassword) return

    const nextRevealIndex = findLastChangedCharacterIndex(unlockPassword, nextValue)
    if (nextRevealIndex === null) {
      clearRevealTimeout()
      setRevealedCharacterIndex(null)
      return
    }

    setRevealedCharacterIndex(nextRevealIndex)
    queuePasswordMask()
  }

  useEffect(() => () => clearRevealTimeout(), [])

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
            {sharedVaultUnlock ? (
              <>
                <label htmlFor="armadillo_unlock_master_password">Org Vault Master Password</label>
                <div className="auth-recovery-panel auth-input-group" style={{ marginTop: 0 }}>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {selectedOrgMembership && selectedSharedVaultSummary
                      ? `Open ${selectedSharedVaultSummary.vaultId.slice(0, 8)} from ${selectedOrgMembership.orgName || selectedOrgMembership.orgId} with your org vault password.`
                      : 'Open the selected shared vault with your org vault password.'}
                  </p>
                  <p className="muted" style={{ marginTop: 0 }}>
                    If this is your first time opening this shared vault, the password you enter now will become your personal org vault password.
                  </p>
                  <div className="auth-input-shell">
                    <input
                      ref={passwordInputRef}
                      id="armadillo_unlock_master_password"
                      className={showMaskedOverlay ? 'auth-masked-input' : undefined}
                      type="text"
                      name="armadillo_unlock_master_password"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      placeholder="Enter or create org vault password"
                      value={unlockPassword}
                      onChange={handleUnlockPasswordChange}
                      onBlur={() => {
                        clearRevealTimeout()
                        setRevealedCharacterIndex(null)
                      }}
                      disabled={isUnlocking}
                    />
                    {showMaskedOverlay && (
                      <div className="auth-input-overlay" aria-hidden="true">
                        {maskedPasswordPreview}
                      </div>
                    )}
                    <button
                      className="auth-input-icon-btn"
                      type="button"
                      aria-label={showMasterPassword ? 'Hide master password' : 'Show master password'}
                      aria-pressed={showMasterPassword}
                      title={showMasterPassword ? 'Hide master password' : 'Show master password'}
                      disabled={isUnlocking}
                      onClick={() => {
                        setShowMasterPassword((current) => {
                          const nextValue = !current
                          if (nextValue) {
                            clearRevealTimeout()
                            setRevealedCharacterIndex(null)
                          }
                          return nextValue
                        })
                      }}
                    >
                      {showMasterPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <button className="solid unlock-submit-btn" type="submit" disabled={isUnlocking} aria-busy={isUnlocking}>
                    {isUnlocking ? (
                      <span className="unlock-btn-busy">
                        <span className="unlock-spinner" aria-hidden="true" />
                        Opening
                      </span>
                    ) : (
                      'Open Shared Vault'
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label htmlFor="armadillo_unlock_master_password">Master Password</label>
                <div className="auth-input-group">
                  <div className="auth-input-shell">
                    <input
                      ref={passwordInputRef}
                      id="armadillo_unlock_master_password"
                      className={showMaskedOverlay ? 'auth-masked-input' : undefined}
                      type="text"
                      name="armadillo_unlock_master_password"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      placeholder="Enter master password"
                      value={unlockPassword}
                      onChange={handleUnlockPasswordChange}
                      onBlur={() => {
                        clearRevealTimeout()
                        setRevealedCharacterIndex(null)
                      }}
                      disabled={isUnlocking}
                    />
                    {showMaskedOverlay && (
                      <div className="auth-input-overlay" aria-hidden="true">
                        {maskedPasswordPreview}
                      </div>
                    )}
                  </div>
                  <button
                    className="auth-input-icon-btn"
                    type="button"
                    aria-label={showMasterPassword ? 'Hide master password' : 'Show master password'}
                    aria-pressed={showMasterPassword}
                    title={showMasterPassword ? 'Hide master password' : 'Show master password'}
                    disabled={isUnlocking}
                    onClick={() => {
                      setShowMasterPassword((current) => {
                        const nextValue = !current
                        if (nextValue) {
                          clearRevealTimeout()
                          setRevealedCharacterIndex(null)
                        }
                        return nextValue
                      })
                      passwordInputRef.current?.focus()
                    }}
                  >
                    {showMasterPassword ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
                  </button>
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
              </>
            )}
            {isUnlocking && (
              <p className="auth-unlock-status" role="status" aria-live="polite">
                {sharedVaultUnlock ? 'Loading shared vault access and preparing workspace...' : 'Decrypting vault and preparing workspace...'}
              </p>
            )}
          </form>

          <div className="auth-utility-row">
            {!sharedVaultUnlock && (
              <button
                type="button"
                className="auth-link-btn"
                disabled={isUnlocking}
                onClick={() => setShowRecoveryKeyBox((prev) => !prev)}
              >
                {showRecoveryKeyBox ? 'Hide recovery key' : 'Use recovery key'}
              </button>
            )}
            <CloudAuthStatusCard variant="inline" />
          </div>

          {showRecoveryKeyBox && !sharedVaultUnlock && (
            <div className="auth-recovery-panel">
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
            </div>
          )}

          {vaultError && <p className="auth-error">{vaultError}</p>}

          {storageMode === 'local_file' && !unlockSourceAvailable && (
            <p className="auth-note">
              Select a vault to unlock.
            </p>
          )}
          <LocalVaultPickerCard mode="compact" />
          {showAuthMessage && <p className="auth-note">{authMessage}</p>}

          <div className="auth-divider" />

          <div className="auth-secondary auth-secondary-compact">
            <button className="ghost" onClick={triggerImport}>Import .armadillo File</button>
            {!unlockSourceAvailable && !sharedVaultUnlock && (
              <button className="ghost" onClick={() => setPhase('create')}>Create New Vault</button>
            )}
            {storageMode === 'cloud_only' && (
              <p className="muted" style={{ margin: 0 }}>
                {cloudCacheExpiresAt
                  ? `Cloud-only cache expires ${new Date(cloudCacheExpiresAt).toLocaleString()}`
                  : 'Cloud-only mode active. No local vault file is stored permanently.'}
              </p>
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
