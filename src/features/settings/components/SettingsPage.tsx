import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isNativeAndroid } from '../../../shared/utils/platform'
import { getSafeRetentionDays } from '../../../shared/utils/trash'
import AutofillBridge from '../../../plugins/autofillBridge'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import { BUILT_IN_THEME_PRESETS, THEME_COLOR_TOKEN_KEYS, resolveThemeTokens } from '../../../shared/utils/theme'
import type { ThemeEditableTokenKey, VaultThemeSettings } from '../../../types/vault'
import type { CapabilityKey, DevFlagOverride, PlanTier } from '../../../types/entitlements'
import { ALL_CAPABILITIES, DEFAULT_ROLLOUT_FLAGS } from '../../../features/flags/registry'

const THEME_TOKEN_LABELS: Record<ThemeEditableTokenKey, string> = {
  accent: 'Accent',
  'bg-0': 'Background 0',
  'bg-1': 'Background 1',
  'bg-2': 'Background 2',
  'bg-3': 'Background 3',
  'surface-solid': 'Surface Solid',
  ink: 'Text Primary',
  'ink-secondary': 'Text Secondary',
  'ink-muted': 'Text Muted',
  'line-strong': 'Borders Strong',
  safe: 'Safe',
  weak: 'Weak',
  reused: 'Reused',
  exposed: 'Exposed',
  stale: 'Stale',
  blur: 'Blur',
  'noise-opacity': 'Noise',
}

const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  'cloud.sync': 'Cloud Sync',
  'cloud.cloud_only': 'Cloud-Only Storage',
  'vault.storage': 'Storage Vault',
  'vault.storage.blobs': 'Storage Blob Sync',
  'enterprise.self_hosted': 'Self-Hosted Sync',
  'enterprise.org_admin': 'Org Admin',
}

const FLAG_LABELS: Record<string, string> = {
  'billing.plans_section': 'Plans Section',
  'billing.manual_token_entry': 'Manual Token Entry',
  'experiments.enterprise_team_ui': 'Enterprise Team UI',
  'experiments.storage_tab': 'Storage Tab',
}

const TIER_OPTIONS: PlanTier[] = ['free', 'premium', 'enterprise']

const SETTINGS_CATEGORIES = [
  { id: 'general', label: 'General', description: 'Appearance, account, and updates' },
  { id: 'cloud', label: 'Cloud', description: 'Storage and sync options' },
  { id: 'security', label: 'Security', description: 'Biometric and autofill controls' },
  { id: 'vault', label: 'Vault', description: 'Import, export, and trash settings' },
  { id: 'billing', label: 'Plans & Billing', description: 'Manage your subscription and entitlements' },
  { id: 'danger', label: 'Danger Zone', description: 'Testing and reset actions' },
] as const

function isHexColor(value: string) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
}

function normalizeColorInput(value: string) {
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return '#000000'
}

function buildPresetThemeView(baseTheme: VaultThemeSettings, presetId: string) {
  const builtin = BUILT_IN_THEME_PRESETS.find((preset) => preset.id === presetId)
  if (builtin) {
    return resolveThemeTokens({
      ...baseTheme,
      activeBaseThemeId: builtin.id,
      activeOverrides: {},
      selectedPresetId: builtin.id,
    })
  }

  const custom = baseTheme.customPresets.find((preset) => preset.id === presetId)
  if (!custom) {
    return resolveThemeTokens(baseTheme)
  }

  return resolveThemeTokens({
    ...baseTheme,
    activeBaseThemeId: custom.baseThemeId,
    activeOverrides: custom.overrides,
    selectedPresetId: custom.id,
  })
}

function formatDateTime(value: string | null) {
  if (!value) return 'n/a'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleString()
}

export function SettingsPage() {
  const {
    showSettings,
    settingsCategory,
    cloudAuthState,
    cloudSyncEnabled,
    storageMode,
    cloudCacheTtlHours,
    cloudCacheExpiresAt,
    syncProvider,
    biometricEnabled,
    syncMessage,
    vaultSettings,
    themeSettings,
    themeSettingsDirty,
    cloudIdentity,
    entitlementState,
    effectiveTier,
    entitlementStatusMessage,
    billingUrl,
    appBuildInfo,
    updateCheckResult,
    isCheckingForUpdates,
    devFlagOverrideState,
    autoFolderPreview,
    autoFolderPreviewDraft,
    showAutoFolderPreview,
    autoFolderBusy,
    autoFolderError,
    autoFolderPreferencesDirty,
    autoFolderWarnings,
    isOrgMember,
  } = useVaultAppState()
  const { cloudConnected, hasCapability } = useVaultAppDerived()
  const {
    closeSettings,
    setSettingsCategory,
    signInWithGoogle,
    signOutCloud,
    createPasskeyIdentity,
    setCloudSyncEnabled,
    setStorageMode,
    setCloudCacheTtlHours,
    pushVaultToCloudNow,
    refreshEntitlements,
    checkForAppUpdates,
    applyManualEntitlementToken,
    clearManualEntitlementToken,
    applyDevFlagOverrides,
    clearDevFlagOverrides,
    enableBiometricUnlock,
    emptyVaultForTesting,
    exportVaultFile,
    exportVaultBackupBundle,
    triggerImport,
    triggerBackupImport,
    triggerGooglePasswordImport,
    triggerKeePassImport,
    previewAutoFoldering,
    cancelAutoFolderingPreview,
    applyAutoFoldering,
    updateAutoFolderPreviewAssignment,
    excludeItemFromAutoFoldering,
    lockAutoFolderPath,
    saveAutoFolderPreferences,
    chooseLocalVaultLocation,
    setVaultSettings,
    selectThemePreset,
    updateThemeTokenOverride,
    resetThemeOverrides,
    saveThemeAsCustomPreset,
    deleteThemePreset,
    setThemeMotionLevel,
    persistThemeSettings,
    persistPayload,
    clearLocalVaultFile,
    clearCachedVaultSnapshot,
  } = useVaultAppActions()

  const [autofillEnabled, setAutofillEnabled] = useState(false)
  const [autofillSupported, setAutofillSupported] = useState(false)
  const [showAutoFolderItems, setShowAutoFolderItems] = useState(false)
  const [autoFolderSearch, setAutoFolderSearch] = useState('')
  const [themePresetName, setThemePresetName] = useState('')
  const [showThemeCustomizer, setShowThemeCustomizer] = useState(false)
  const [manualTokenInput, setManualTokenInput] = useState('')
  const [manualTokenBusy, setManualTokenBusy] = useState(false)
  const [devTier, setDevTier] = useState<PlanTier | ''>(devFlagOverrideState?.tier ?? '')
  const [devCapabilities, setDevCapabilities] = useState<Set<CapabilityKey>>(new Set(devFlagOverrideState?.capabilities ?? []))
  const [devFlags, setDevFlags] = useState<Record<string, boolean>>(() => ({ ...DEFAULT_ROLLOUT_FLAGS, ...(devFlagOverrideState?.flags ?? {}) }))

  function closeSettingsView() {
    setShowThemeCustomizer(false)
    closeSettings()
  }

  const openBillingUrl = useCallback(() => {
    if (!billingUrl) return
    window.open(billingUrl, '_blank', 'noopener,noreferrer')
  }, [billingUrl])

  const openExternalUrl = useCallback((url: string | null | undefined) => {
    const normalized = (url || '').trim()
    if (!normalized) return
    window.open(normalized, '_blank', 'noopener,noreferrer')
  }, [])

  const handleApplyManualToken = useCallback(async () => {
    setManualTokenBusy(true)
    try {
      await applyManualEntitlementToken(manualTokenInput)
    } finally {
      setManualTokenBusy(false)
    }
  }, [applyManualEntitlementToken, manualTokenInput])

  const handleApplyDevOverride = useCallback(() => {
    if (!import.meta.env.DEV) return
    const override: DevFlagOverride = {}
    if (devTier) override.tier = devTier
    if (devCapabilities.size > 0) override.capabilities = [...devCapabilities]
    const changedFlags: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(devFlags)) {
      if (DEFAULT_ROLLOUT_FLAGS[key] !== value) changedFlags[key] = value
    }
    if (Object.keys(changedFlags).length > 0) override.flags = changedFlags
    applyDevFlagOverrides(Object.keys(override).length > 0 ? override : null)
  }, [applyDevFlagOverrides, devTier, devCapabilities, devFlags])

  const toggleDevCapability = useCallback((cap: CapabilityKey) => {
    setDevCapabilities((prev) => {
      const next = new Set(prev)
      if (next.has(cap)) next.delete(cap)
      else next.add(cap)
      return next
    })
  }, [])

  const toggleDevFlag = useCallback((flag: string) => {
    setDevFlags((prev) => ({ ...prev, [flag]: !prev[flag] }))
  }, [])

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
      void refreshEntitlements()
    }
  }, [showSettings, checkAutofillStatus, refreshEntitlements])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    setDevTier(devFlagOverrideState?.tier ?? '')
    setDevCapabilities(new Set(devFlagOverrideState?.capabilities ?? []))
    setDevFlags({ ...DEFAULT_ROLLOUT_FLAGS, ...(devFlagOverrideState?.flags ?? {}) })
  }, [devFlagOverrideState])

  const closeSettingsRef = useRef(closeSettings)
  useEffect(() => {
    closeSettingsRef.current = closeSettings
  }, [closeSettings])

  // Let the system back gesture (Android swipe / browser back) close settings
  const closedByPopStateRef = useRef(false)
  useEffect(() => {
    if (!showSettings) return

    closedByPopStateRef.current = false
    window.history.pushState({ settingsOpen: true }, '')

    function onPopState() {
      closedByPopStateRef.current = true
      setShowThemeCustomizer(false)
      closeSettingsRef.current()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      // If closed by a UI action (not popstate), clean up the history entry we pushed.
      if (!closedByPopStateRef.current) {
        window.history.back()
      }
    }
  }, [showSettings])

  useEffect(() => {
    if (showAutoFolderPreview) return
    setShowAutoFolderItems(false)
    setAutoFolderSearch('')
  }, [showAutoFolderPreview])

  const previewPlan = autoFolderPreviewDraft ?? autoFolderPreview
  const cloudSyncLocked = !hasCapability('cloud.sync')
  const cloudOnlyLocked = !hasCapability('cloud.cloud_only')
  const selfHostedLocked = syncProvider === 'self_hosted' && !hasCapability('enterprise.self_hosted')
  const upgradeDisabled = !billingUrl
  const resolvedThemeTokens = useMemo(() => resolveThemeTokens(themeSettings), [themeSettings])
  const selectedCustomPreset = themeSettings.customPresets.find((preset) => preset.id === themeSettings.selectedPresetId) ?? null
  const selectedBuiltInPreset = BUILT_IN_THEME_PRESETS.find((preset) => preset.id === themeSettings.selectedPresetId) ?? null
  const selectedThemeLabel = selectedBuiltInPreset?.label ?? selectedCustomPreset?.name ?? 'Theme'
  const blurValue = Number.parseFloat((themeSettings.activeOverrides.blur ?? resolvedThemeTokens.blur ?? '20').toString().replace(/px$/i, ''))
  const noiseValue = Number.parseFloat((themeSettings.activeOverrides['noise-opacity'] ?? resolvedThemeTokens['noise-opacity'] ?? '0.025').toString())
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
  const visibleCategories = isOrgMember
    ? SETTINGS_CATEGORIES.filter((c) => c.id !== 'billing')
    : SETTINGS_CATEGORIES
  const activeCategory = visibleCategories.find((category) => category.id === settingsCategory) ?? visibleCategories[0]
  const isGeneral = settingsCategory === 'general'
  const isCloud = settingsCategory === 'cloud'
  const isSecurity = settingsCategory === 'security'
  const isVault = settingsCategory === 'vault'
  const isBilling = settingsCategory === 'billing'
  const isDanger = settingsCategory === 'danger'
  const showManualTokenEntry = import.meta.env.DEV || hasCapability('enterprise.org_admin')
  const updateStatusLabel = updateCheckResult.status === 'required'
    ? 'Update Required'
    : updateCheckResult.status === 'available'
      ? 'Update Available'
      : updateCheckResult.status === 'up_to_date'
        ? 'Up to Date'
        : 'Unavailable'
  const releaseNotesUrl = (updateCheckResult.releaseNotesUrl || '').trim()
  const installUrl = (updateCheckResult.installUrl || '').trim()

  if (!showSettings) return null

  return (
    <section className="settings-page-workspace" aria-label="Settings">
      <aside className="settings-page-nav pane">
        <div className="settings-page-nav-head">
          <h2>Settings</h2>
          <p className="muted">Choose a category to update your vault preferences.</p>
        </div>

        <nav className="settings-page-nav-list" aria-label="Settings categories">
          {visibleCategories.map((category) => (
            <button
              key={category.id}
              className={`settings-page-nav-item${settingsCategory === category.id ? ' active' : ''}`}
              onClick={() => setSettingsCategory(category.id)}
            >
              <span>{category.label}</span>
              <small>{category.description}</small>
            </button>
          ))}
        </nav>
      </aside>

      <div className="settings-page-detail pane">
        <div className="settings-page-detail-head">
          <div>
            <p className="kicker">Settings</p>
            <h2>{activeCategory.label}</h2>
            <p className="muted">{activeCategory.description}</p>
            <div className="settings-mobile-picker-inline">
              <label>
                Category
                <select
                  value={settingsCategory}
                  onChange={(event) => setSettingsCategory(event.target.value as typeof settingsCategory)}
                >
                  {visibleCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <button className="ghost settings-page-close-btn" onClick={closeSettingsView}>Back to Vault</button>
        </div>
        <div className="settings-body settings-page-content">
          <section className="settings-section" hidden={!isGeneral}>
            <h3>Appearance</h3>
            <div className="settings-action-list">
              <button
                className={showThemeCustomizer ? 'solid' : 'ghost'}
                onClick={() => setShowThemeCustomizer((current) => !current)}
              >
                {showThemeCustomizer ? 'Hide Appearance Customization' : `Customize Appearance (${selectedThemeLabel})`}
              </button>
            </div>

            {showThemeCustomizer && (
              <>
                <div className="theme-grid">
                  {BUILT_IN_THEME_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`theme-card${themeSettings.selectedPresetId === preset.id ? ' active' : ''}`}
                      onClick={() => selectThemePreset(preset.id)}
                      title={preset.description}
                    >
                      <span className="theme-swatch" aria-hidden="true">
                        <span style={{ background: preset.swatch[0] }} />
                        <span style={{ background: preset.swatch[1] }} />
                        <span style={{ background: preset.swatch[2] }} />
                        <span style={{ background: preset.swatch[3] }} />
                      </span>
                      <span className="theme-label">{preset.label}</span>
                    </button>
                  ))}
                  {themeSettings.customPresets.map((preset) => {
                    const tokens = buildPresetThemeView(themeSettings, preset.id)
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`theme-card${themeSettings.selectedPresetId === preset.id ? ' active' : ''}`}
                        onClick={() => selectThemePreset(preset.id)}
                        title={`Custom: ${preset.name}`}
                      >
                        <span className="theme-swatch" aria-hidden="true">
                          <span style={{ background: tokens['bg-0'] }} />
                          <span style={{ background: tokens['bg-2'] }} />
                          <span style={{ background: tokens.accent }} />
                          <span style={{ background: tokens.ink }} />
                        </span>
                        <span className="theme-label">{preset.name}</span>
                      </button>
                    )
                  })}
                </div>

                <div className="theme-editor-card">
                  <p className="muted" style={{ marginTop: 0, marginBottom: '0.55rem' }}>
                    Customize your active theme. Changes preview instantly and sync only when saved.
                  </p>
                  <div className="theme-token-grid">
                    {THEME_COLOR_TOKEN_KEYS.map((token) => {
                      const hasOverride = Object.prototype.hasOwnProperty.call(themeSettings.activeOverrides, token)
                      const tokenValue = String(themeSettings.activeOverrides[token] ?? resolvedThemeTokens[token] ?? '')
                      const showColorPicker = isHexColor(tokenValue)
                      return (
                        <label key={token} className="theme-token-row">
                          <span>{THEME_TOKEN_LABELS[token]}</span>
                          <div className="theme-token-controls">
                            {showColorPicker && (
                              <input
                                type="color"
                                value={normalizeColorInput(tokenValue)}
                                onChange={(event) => updateThemeTokenOverride(token, event.target.value)}
                              />
                            )}
                            <input
                              value={tokenValue}
                              onChange={(event) => updateThemeTokenOverride(token, event.target.value)}
                              placeholder="CSS color value"
                            />
                            <button
                              type="button"
                              className="ghost"
                              disabled={!hasOverride}
                              onClick={() => updateThemeTokenOverride(token, '')}
                            >
                              Reset
                            </button>
                          </div>
                        </label>
                      )
                    })}
                  </div>

                  <div className="theme-slider-grid">
                    <label className="theme-token-row">
                      <span>{THEME_TOKEN_LABELS.blur} ({Math.round(Number.isFinite(blurValue) ? blurValue : 20)}px)</span>
                      <div className="theme-token-controls">
                        <input
                          type="range"
                          min={0}
                          max={40}
                          step={1}
                          value={Math.round(Number.isFinite(blurValue) ? blurValue : 20)}
                          onChange={(event) => updateThemeTokenOverride('blur', `${event.target.value}px`)}
                        />
                        <button
                          type="button"
                          className="ghost"
                          disabled={!Object.prototype.hasOwnProperty.call(themeSettings.activeOverrides, 'blur')}
                          onClick={() => updateThemeTokenOverride('blur', '')}
                        >
                          Reset
                        </button>
                      </div>
                    </label>
                    <label className="theme-token-row">
                      <span>{THEME_TOKEN_LABELS['noise-opacity']} ({(Number.isFinite(noiseValue) ? noiseValue : 0.025).toFixed(3)})</span>
                      <div className="theme-token-controls">
                        <input
                          type="range"
                          min={0}
                          max={0.12}
                          step={0.001}
                          value={Number.isFinite(noiseValue) ? noiseValue : 0.025}
                          onChange={(event) => updateThemeTokenOverride('noise-opacity', event.target.value)}
                        />
                        <button
                          type="button"
                          className="ghost"
                          disabled={!Object.prototype.hasOwnProperty.call(themeSettings.activeOverrides, 'noise-opacity')}
                          onClick={() => updateThemeTokenOverride('noise-opacity', '')}
                        >
                          Reset
                        </button>
                      </div>
                    </label>
                  </div>

                  <div className="settings-toggle-row">
                    <span>Motion</span>
                    <div className="platform-grid">
                      <button
                        className={themeSettings.motionLevel === 'normal' ? 'active' : ''}
                        onClick={() => setThemeMotionLevel('normal')}
                      >
                        Normal
                      </button>
                      <button
                        className={themeSettings.motionLevel === 'reduced' ? 'active' : ''}
                        onClick={() => setThemeMotionLevel('reduced')}
                      >
                        Reduced
                      </button>
                    </div>
                  </div>

                  <div className="theme-save-row">
                    <input
                      value={themePresetName}
                      onChange={(event) => setThemePresetName(event.target.value)}
                      placeholder="Preset name"
                      maxLength={40}
                    />
                    <button
                      className="ghost"
                      onClick={() => {
                        const name = themePresetName.trim()
                        if (!name) return
                        saveThemeAsCustomPreset(name)
                        setThemePresetName('')
                      }}
                    >
                      Save as Preset
                    </button>
                  </div>
                  <div className="settings-action-list">
                    {selectedCustomPreset && (
                      <button className="ghost" onClick={() => deleteThemePreset(selectedCustomPreset.id)}>
                        Delete Preset ({selectedCustomPreset.name})
                      </button>
                    )}
                    <button className="ghost" onClick={resetThemeOverrides}>Reset to Base Theme</button>
                    <button
                      className={themeSettingsDirty ? 'solid' : 'ghost'}
                      disabled={!themeSettingsDirty}
                      onClick={() => void persistThemeSettings()}
                    >
                      Save Theme Settings
                    </button>
                  </div>
                  {themeSettingsDirty && (
                    <p className="muted" style={{ marginTop: '0.45rem', marginBottom: 0 }}>
                      Unsaved appearance changes.
                    </p>
                  )}
                </div>
              </>
            )}
          </section>

          <div className="settings-divider" hidden={!isGeneral} />

          <section className="settings-section" hidden={!isGeneral}>
            <h3>Account</h3>
            <div className="settings-identity">
              <span className={`dot-status ${cloudConnected ? 'connected' : 'disconnected'}`} />
              <span>{cloudConnected ? cloudIdentity || 'Google connected' : 'Not signed in'}</span>
            </div>
            <div className="settings-action-list">
              {!cloudConnected ? (
                <button
                  className="ghost"
                  onClick={() => void signInWithGoogle()}
                  disabled={cloudAuthState === 'checking' || (syncProvider === 'self_hosted' && selfHostedLocked)}
                >
                  {syncProvider === 'self_hosted' && selfHostedLocked
                    ? 'Authenticate (Locked)'
                    : (cloudAuthState === 'checking' ? 'Checking Session...' : (syncProvider === 'self_hosted' ? 'Authenticate' : 'Sign in with Google'))}
                </button>
              ) : (
                <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
              )}
              {syncProvider !== 'self_hosted' && (
                <button className="ghost" onClick={() => void createPasskeyIdentity()}>Bind Passkey Identity</button>
              )}
            </div>
            {syncProvider === 'self_hosted' && selfHostedLocked && (
              <p className="settings-plan-hint muted" style={{ marginTop: '0.45rem', marginBottom: 0 }}>
                Available on Enterprise
              </p>
            )}
          </section>

          <div className="settings-divider" hidden={!isGeneral} />

          <section className="settings-section" hidden={!isGeneral}>
            <h3>App & Updates</h3>
            <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
              Channel: {appBuildInfo.channel}
            </p>
            <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
              Build: {appBuildInfo.version} ({appBuildInfo.commit.slice(0, 8)})
            </p>
            <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
              Built at: {formatDateTime(appBuildInfo.builtAt)}
            </p>
            <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
              Policy: {updateCheckResult.policy}
            </p>
            <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
              Status: {updateStatusLabel}
            </p>
            <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
              Latest: {updateCheckResult.latestVersion ?? 'n/a'}
            </p>
            <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
              Minimum supported: {updateCheckResult.minimumSupportedVersion ?? 'n/a'}
            </p>
            {updateCheckResult.forceBy && (
              <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
                Force by: {formatDateTime(updateCheckResult.forceBy)}
              </p>
            )}
            <p className="muted" style={{ marginTop: 0 }}>
              {updateCheckResult.message}
            </p>
            <div className="settings-action-list">
              <button className="ghost" onClick={() => void checkForAppUpdates()} disabled={isCheckingForUpdates}>
                {isCheckingForUpdates ? 'Checking...' : 'Check for Updates'}
              </button>
              <button className="ghost" onClick={() => openExternalUrl(releaseNotesUrl)} disabled={!releaseNotesUrl}>
                Open Release Notes
              </button>
              <button className="ghost" onClick={() => openExternalUrl(installUrl)} disabled={!installUrl}>
                Open Install Link
              </button>
            </div>
          </section>

          <section className="settings-section" hidden={!isCloud}>
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
                  disabled={cloudOnlyLocked || selfHostedLocked}
                  onClick={() => setStorageMode('cloud_only')}
                >
                  Cloud Only
                </button>
              </div>
            </div>
            {(cloudOnlyLocked || selfHostedLocked) && (
              <p className="settings-plan-hint muted" style={{ marginTop: '0.45rem' }}>
                Available on {selfHostedLocked ? 'Enterprise' : 'Premium'}
              </p>
            )}
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

          <div className="settings-divider" hidden={!isCloud} />

          <section className="settings-section" hidden={!isCloud}>
            <h3>Cloud Sync</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Provider: {syncProvider === 'self_hosted' ? 'Self-hosted' : 'Convex'}
            </p>
            {(cloudSyncLocked || selfHostedLocked) && (
              <p className="settings-plan-hint muted" style={{ marginTop: 0 }}>
                Available on {selfHostedLocked ? 'Enterprise' : 'Premium'}
              </p>
            )}
            <div className="settings-toggle-row">
              <span>Auto Sync</span>
              <button
                className={cloudSyncEnabled ? 'solid' : 'ghost'}
                onClick={() => setCloudSyncEnabled((v) => !v)}
                disabled={cloudSyncLocked || selfHostedLocked}
              >
                {cloudSyncEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="settings-action-list">
              <button
                className="ghost"
                onClick={() => void pushVaultToCloudNow()}
                disabled={cloudSyncLocked || selfHostedLocked}
              >
                Push Vault to Cloud Now
              </button>
            </div>
          </section>

          <section className="settings-section" hidden={!isSecurity}>
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
              <div className="settings-divider" hidden={!isSecurity} />
              <section className="settings-section" hidden={!isSecurity}>
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

          <section className="settings-section" hidden={!isVault}>
            <h3>Vault</h3>
            <div className="settings-action-list">
              <button className="ghost" onClick={exportVaultFile}>Export .armadillo</button>
              <button className="ghost" onClick={() => void exportVaultBackupBundle()}>Export Full Backup (.zip)</button>
              <button className="ghost" onClick={triggerImport}>Import .armadillo</button>
              <button className="ghost" onClick={triggerBackupImport}>Import Full Backup (.zip)</button>
              <button className="ghost" onClick={triggerGooglePasswordImport}>Import Google Passwords (.csv)</button>
              <button className="ghost" onClick={triggerKeePassImport}>Import KeePass Export (.xml/.csv)</button>
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

          <div className="settings-divider" hidden={!isVault} />

          <section className="settings-section" hidden={!isVault}>
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

          {isBilling && isOrgMember && (
            <section className="settings-section">
              <p className="muted">Your plan is managed by your organization.</p>
            </section>
          )}

          {isBilling && !isOrgMember && (
            <>
              <section className="settings-section">
                {effectiveTier === 'free' ? (
                  <div className="settings-plan-card settings-plan-card--upgrade">
                    <div className="settings-plan-card-badge">Free</div>
                    <h3 className="settings-plan-card-title">Get Premium</h3>
                    <p className="muted" style={{ marginTop: 0, marginBottom: '0.6rem' }}>
                      Unlock the full power of Armadillo with a Premium plan.
                    </p>
                    <ul className="settings-plan-card-features">
                      <li>Cloud sync across all your devices</li>
                      <li>Cloud-only encrypted storage</li>
                      <li>Priority support</li>
                    </ul>
                    <div className="settings-action-list">
                      <button className={upgradeDisabled ? 'ghost' : 'solid'} onClick={openBillingUrl} disabled={upgradeDisabled}>
                        {upgradeDisabled ? 'Upgrade URL Not Configured' : 'Upgrade to Premium'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="settings-plan-card">
                    <div className="settings-plan-card-badge settings-plan-card-badge--active">
                      {effectiveTier === 'enterprise' ? 'Enterprise' : 'Premium'}
                    </div>
                    <h3 className="settings-plan-card-title">Current Plan</h3>
                    <div className="settings-plan-card-details">
                      <p className="muted" style={{ margin: 0 }}>
                        Status: {entitlementState.status}
                      </p>
                      {entitlementState.expiresAt && (
                        <p className="muted" style={{ margin: 0 }}>
                          Expires: {formatDateTime(entitlementState.expiresAt)}
                        </p>
                      )}
                      {entitlementState.lastRefreshAt && (
                        <p className="muted" style={{ margin: 0 }}>
                          Last refresh: {formatDateTime(entitlementState.lastRefreshAt)}
                        </p>
                      )}
                    </div>
                    <div className="settings-action-list">
                      <button className="ghost" onClick={() => void refreshEntitlements()}>
                        Refresh Entitlements
                      </button>
                      {billingUrl && (
                        <button className="ghost" onClick={openBillingUrl}>
                          Manage Subscription
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <div className="settings-divider" />

              <section className="settings-section">
                <h3>Entitlement Details</h3>
                <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
                  {entitlementStatusMessage}
                </p>
                <p className="muted" style={{ marginTop: 0, marginBottom: '0.35rem' }}>
                  Source: {entitlementState.source}
                </p>
                {showManualTokenEntry ? (
                  <>
                    <div className="settings-divider" />
                    <p className="muted" style={{ marginBottom: '0.35rem' }}>
                      Break-glass admin override.
                    </p>
                    <label>
                      Manual Signed Entitlement Token
                      <textarea
                        value={manualTokenInput}
                        onChange={(event) => setManualTokenInput(event.target.value)}
                        placeholder="Paste signed JWT entitlement token"
                        rows={4}
                      />
                    </label>
                    <div className="settings-action-list">
                      <button className="ghost" onClick={() => void handleApplyManualToken()} disabled={manualTokenBusy}>
                        {manualTokenBusy ? 'Validating...' : 'Apply Signed Token'}
                      </button>
                      <button className="ghost" onClick={clearManualEntitlementToken}>
                        Clear Manual Token
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ marginTop: 0 }}>
                    Entitlements are managed by your organization administrator.
                  </p>
                )}
                {import.meta.env.DEV && (
                  <>
                    <div className="settings-divider" />
                    <h3 style={{ marginTop: 0 }}>Dev Overrides</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Override tier, capabilities, and flags for local QA testing.
                    </p>

                    <div className="dev-override-group">
                      <span className="dev-override-label">Tier</span>
                      <div className="dev-override-tier-row">
                        <button
                          className={devTier === '' ? 'solid' : 'ghost'}
                          onClick={() => setDevTier('')}
                        >
                          Default
                        </button>
                        {TIER_OPTIONS.map((t) => (
                          <button
                            key={t}
                            className={devTier === t ? 'solid' : 'ghost'}
                            onClick={() => setDevTier(t)}
                          >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="dev-override-group">
                      <span className="dev-override-label">Capabilities</span>
                      {ALL_CAPABILITIES.map((cap) => (
                        <label key={cap} className="dev-override-toggle">
                          <input
                            type="checkbox"
                            checked={devCapabilities.has(cap)}
                            onChange={() => toggleDevCapability(cap)}
                          />
                          <span>{CAPABILITY_LABELS[cap] || cap}</span>
                        </label>
                      ))}
                    </div>

                    <div className="dev-override-group">
                      <span className="dev-override-label">Flags</span>
                      {Object.keys(DEFAULT_ROLLOUT_FLAGS).map((flag) => (
                        <label key={flag} className="dev-override-toggle">
                          <input
                            type="checkbox"
                            checked={devFlags[flag] ?? false}
                            onChange={() => toggleDevFlag(flag)}
                          />
                          <span>{FLAG_LABELS[flag] || flag}</span>
                        </label>
                      ))}
                    </div>

                    <div className="settings-action-list">
                      <button className="ghost" onClick={handleApplyDevOverride}>Apply Overrides</button>
                      <button className="ghost" onClick={clearDevFlagOverrides}>Clear All</button>
                    </div>
                  </>
                )}
              </section>
            </>
          )}

          <section className="settings-section" hidden={!isDanger}>
            <h3>Danger Zone</h3>
            <div className="settings-action-list">
              <button
                className="ghost"
                onClick={() => {
                  if (!window.confirm('Empty all vault items, folders, and trash for testing?')) {
                    return
                  }
                  void emptyVaultForTesting()
                }}
              >
                Empty Vault (Testing)
              </button>
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
    </section>
  )
}
