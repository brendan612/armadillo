import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isNativeAndroid } from '../../../shared/utils/platform'
import { getSafeRetentionDays } from '../../../shared/utils/trash'
import AutofillBridge from '../../../plugins/autofillBridge'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import { defaultClipboardSettings } from '../../../lib/vaultFile'
import { BUILT_IN_THEME_PRESETS, THEME_COLOR_TOKEN_KEYS, resolveThemeTokens } from '../../../shared/utils/theme'
import { AI_EXCLUDED_FIELD_LABELS, AI_INCLUDED_FIELD_LABELS, defaultAiSettings } from '../../../shared/utils/copilot'
import { KEYBIND_DEFINITIONS, defaultKeybindSettings, eventToShortcut, findKeybindConflicts, formatShortcutLabel, normalizeKeybindSettings } from '../../../shared/utils/keybinds'
import type { ThemeEditableTokenKey, VaultKeybindAction, VaultKeybindSettings, VaultThemeSettings } from '../../../types/vault'
import type { CapabilityKey, DevFlagOverride, PlanTier } from '../../../types/entitlements'
import { ALL_CAPABILITIES, DEFAULT_ROLLOUT_FLAGS } from '../../../features/flags/registry'
import { GoogleSignInButton } from '../../auth/components/GoogleSignInButton'
import {
  Download, Upload, FolderTree as FolderTreeIcon, HardDrive, Trash2, Save, Clock, ArchiveRestore,
  Palette, User, LogOut, KeyRound, Package, RefreshCw, ExternalLink, Database, Cloud, CloudUpload,
  ShieldAlert, ShieldCheck, Search, LifeBuoy, RotateCcw, ShieldOff, Smartphone, AlertTriangle, ServerCrash, Keyboard,
  LockKeyhole, Clipboard,
} from 'lucide-react'
import armadilloLogo from '../../../assets/armadillo.webp'
import googleLogo from '../../../assets/other providers/google.png'
import lastpassLogo from '../../../assets/other providers/lastpass.png'

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
  'security.breach_scan': 'Compromised Password Scan',
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
  { id: 'security', label: 'Security', description: 'Quick unlock, recovery, and autofill controls' },
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

function vaultFileLabel(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function SettingsPage() {
  const {
    showSettings,
    settingsCategory,
    cloudAuthState,
    cloudSyncEnabled,
    storageMode,
    devicePrivacySettings,
    cloudCacheTtlHours,
    cloudCacheExpiresAt,
    syncProvider,
    quickUnlockEnabled,
    quickUnlockCapabilities,
    recoveryKeyDisplay,
    recoveryKitEnabled,
    recoveryKeyFingerprintSuffix,
    recoveryEnabledAt,
    recoveryRotatedAt,
    syncMessage,
    vaultSettings,
    themeSettings,
    themeSettingsDirty,
    cloudIdentity,
    localVaultPath,
    recentLocalVaultPaths,
    recentLocalVaultPathStatuses,
    orgMemberships,
    selectedOrgId,
    activeSharedVaultSource,
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
    breachScanRunning,
    breachScanProgress,
    breachScanSummary,
    isOrgMember,
    trash,
  } = useVaultAppState()
  const { cloudConnected, hasCapability, selectedOrgRole, canEditActiveVault } = useVaultAppDerived()
  const {
    closeSettings,
    setSettingsCategory,
    signInWithGoogle,
    signOutCloud,
    createPasskeyIdentity,
    setCloudSyncEnabled,
    setStorageMode,
    setDevicePrivacySettings,
    setCloudCacheTtlHours,
    pushVaultToCloudNow,
    setBreachCheckEnabled,
    runBreachScanAll,
    refreshEntitlements,
    checkForAppUpdates,
    applyManualEntitlementToken,
    clearManualEntitlementToken,
    applyDevFlagOverrides,
    clearDevFlagOverrides,
    enableQuickUnlock,
    disableQuickUnlock,
    enableRecoveryKit,
    rotateRecoveryKit,
    disableRecoveryKit,
    acknowledgeRecoveryKeyStored,
    emptyVaultForTesting,
    exportVaultFile,
    exportVaultBackupBundle,
    triggerImport,
    triggerBackupImport,
    triggerGooglePasswordImport,
    triggerLastPassImport,
    triggerKeePassImport,
    previewAutoFoldering,
    cancelAutoFolderingPreview,
    applyAutoFoldering,
    updateAutoFolderPreviewAssignment,
    excludeItemFromAutoFoldering,
    lockAutoFolderPath,
    saveAutoFolderPreferences,
    chooseLocalVaultLocation,
    selectRecentLocalVaultPath,
    removeRecentLocalVaultPath,
    clearRecentLocalVaultPaths,
    lockVault,
    setVaultSettings,
    selectThemePreset,
    updateThemeTokenOverride,
    resetThemeOverrides,
    saveThemeAsCustomPreset,
    deleteThemePreset,
    setThemeMotionLevel,
    persistThemeSettings,
    persistPayload,
    clearDismissedCopilotSuggestions,
    clearLocalVaultFile,
    clearCachedVaultSnapshot,
    shareCurrentVaultWithOrg,
    refreshCurrentVaultOrgAccess,
    unshareCurrentVaultFromOrg,
  } = useVaultAppActions()

  const [autofillEnabled, setAutofillEnabled] = useState(false)
  const [autofillSupported, setAutofillSupported] = useState(false)
  const [showAutoFolderItems, setShowAutoFolderItems] = useState(false)
  const [autoFolderSearch, setAutoFolderSearch] = useState('')
  const [themePresetName, setThemePresetName] = useState('')
  const [showThemeCustomizer, setShowThemeCustomizer] = useState(false)
  const [showImportWizard, setShowImportWizard] = useState(false)
  const [switchVaultPath, setSwitchVaultPath] = useState('')
  const [manualTokenInput, setManualTokenInput] = useState('')
  const [manualTokenBusy, setManualTokenBusy] = useState(false)
  const [devTier, setDevTier] = useState<PlanTier | ''>(devFlagOverrideState?.tier ?? '')
  const [devCapabilities, setDevCapabilities] = useState<Set<CapabilityKey>>(new Set(devFlagOverrideState?.capabilities ?? []))
  const [devFlags, setDevFlags] = useState<Record<string, boolean>>(() => ({ ...DEFAULT_ROLLOUT_FLAGS, ...(devFlagOverrideState?.flags ?? {}) }))
  const [keybindDraft, setKeybindDraft] = useState<VaultKeybindSettings>(() => normalizeKeybindSettings(vaultSettings.keybinds))
  const [capturingKeybind, setCapturingKeybind] = useState<VaultKeybindAction | null>(null)

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

  const updateAiSettings = useCallback((patch: Partial<ReturnType<typeof defaultAiSettings>>) => {
    const nextSettings = {
      ...vaultSettings,
      ai: {
        ...defaultAiSettings(),
        ...vaultSettings.ai,
        ...patch,
      },
    }
    setVaultSettings(nextSettings)
    void persistPayload({ settings: nextSettings })
  }, [persistPayload, setVaultSettings, vaultSettings])

  const updateClipboardSettings = useCallback((patch: Partial<ReturnType<typeof defaultClipboardSettings>>) => {
    const nextSettings = {
      ...vaultSettings,
      clipboard: {
        ...defaultClipboardSettings(),
        ...vaultSettings.clipboard,
        ...patch,
      },
    }
    setVaultSettings(nextSettings)
    void persistPayload({ settings: nextSettings })
  }, [persistPayload, setVaultSettings, vaultSettings])

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

  useEffect(() => {
    setKeybindDraft(normalizeKeybindSettings(vaultSettings.keybinds))
    setCapturingKeybind(null)
  }, [vaultSettings.keybinds])

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
  const breachScanLocked = !hasCapability('security.breach_scan')
  const selfHostedLocked = syncProvider === 'self_hosted' && !hasCapability('enterprise.self_hosted')
  const showCloudSignIn = syncProvider === 'convex'
    ? true
    : cloudSyncEnabled && !cloudSyncLocked && !selfHostedLocked
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
  const canSwitchLocalVault = storageMode === 'local_file' && recentLocalVaultPaths.length > 1
  const resolvedSwitchVaultPath = switchVaultPath.trim() || localVaultPath || recentLocalVaultPaths[0]?.path || ''
  const isSwitchTargetActive = resolvedSwitchVaultPath.trim() === localVaultPath.trim()
  const switchTargetStatus = recentLocalVaultPathStatuses[resolvedSwitchVaultPath] ?? 'unknown'
  const selectedOrgMembership = orgMemberships.find((membership) => membership.orgId === selectedOrgId) ?? null
  const canManageCurrentOrgShare = selectedOrgRole === 'owner'
  const sharedVaultInSelectedOrg = Boolean(activeSharedVaultSource && selectedOrgId && activeSharedVaultSource.scope.orgId === selectedOrgId)
  const isOrgSharedVault = Boolean(activeSharedVaultSource)
  const passwordClipboardSeconds = vaultSettings.clipboard?.passwordClearSeconds ?? defaultClipboardSettings().passwordClearSeconds
  const quickUnlockMethodLabel = quickUnlockCapabilities.method === 'android-native' ? 'Biometric' : 'Passkey / Windows Hello'
  const importProviderOptions = [
    {
      id: 'armadillo',
      label: '.armadillo File',
      meta: 'Native vault export',
      logo: armadilloLogo,
      initials: 'AR',
      onClick: triggerImport,
    },
    {
      id: 'backup',
      label: 'Full Backup (.zip)',
      meta: 'Vault + storage blobs',
      logo: null,
      initials: 'ZIP',
      onClick: triggerBackupImport,
    },
    {
      id: 'google',
      label: 'Google Passwords',
      meta: 'CSV export',
      logo: googleLogo,
      initials: 'G',
      onClick: triggerGooglePasswordImport,
    },
    {
      id: 'lastpass',
      label: 'LastPass',
      meta: 'CSV export',
      logo: lastpassLogo,
      initials: 'LP',
      onClick: triggerLastPassImport,
    },
    {
      id: 'keepass',
      label: 'KeePass',
      meta: 'CSV or XML export',
      logo: null,
      initials: 'KP',
      onClick: triggerKeePassImport,
    },
  ] as const

  useEffect(() => {
    if (!isVault) {
      setShowImportWizard(false)
    }
  }, [isVault])

  useEffect(() => {
    if (!isVault) return
    if (localVaultPath.trim()) {
      setSwitchVaultPath(localVaultPath)
      return
    }
    if (recentLocalVaultPaths[0]?.path) {
      setSwitchVaultPath(recentLocalVaultPaths[0].path)
    }
  }, [isVault, localVaultPath, recentLocalVaultPaths])

  const savedKeybinds = useMemo(() => normalizeKeybindSettings(vaultSettings.keybinds), [vaultSettings.keybinds])
  const keybindConflicts = useMemo(() => findKeybindConflicts(keybindDraft), [keybindDraft])
  const keybindsDirty = KEYBIND_DEFINITIONS.some((definition) => {
    const draftValue = keybindDraft[definition.id]
    const savedValue = savedKeybinds[definition.id]
    return JSON.stringify(draftValue) !== JSON.stringify(savedValue)
  })
  const keybindConflictLabels = useMemo(() => {
    const labels = new Map<VaultKeybindAction, string>()
    for (const definition of KEYBIND_DEFINITIONS) {
      const duplicates = keybindConflicts.get(definition.id) ?? []
      if (duplicates.length === 0) continue
      const related = duplicates
        .map((duplicateId) => KEYBIND_DEFINITIONS.find((entry) => entry.id === duplicateId)?.label ?? duplicateId)
        .join(', ')
      labels.set(definition.id, related)
    }
    return labels
  }, [keybindConflicts])

  const saveKeybinds = useCallback(async () => {
    if (keybindConflicts.size > 0) return
    const normalizedDraft = normalizeKeybindSettings(keybindDraft)
    const nextSettings = {
      ...vaultSettings,
      keybinds: normalizedDraft,
    }
    setVaultSettings(nextSettings)
    await persistPayload({ settings: nextSettings })
  }, [keybindConflicts.size, keybindDraft, persistPayload, setVaultSettings, vaultSettings])

  useEffect(() => {
    if (!capturingKeybind) return
    const actionId = capturingKeybind

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        setCapturingKeybind(null)
        return
      }

      if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        setKeybindDraft((current) => ({ ...current, [actionId]: null }))
        setCapturingKeybind(null)
        return
      }

      const nextShortcut = eventToShortcut(event)
      if (!nextShortcut) return

      setKeybindDraft((current) => ({ ...current, [actionId]: nextShortcut }))
      setCapturingKeybind(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturingKeybind])

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
            <button
              className={`vault-action-btn ${showThemeCustomizer ? 'solid' : 'ghost'}`}
              onClick={() => setShowThemeCustomizer((current) => !current)}
            >
              <Palette size={15} />
              {showThemeCustomizer ? 'Hide Appearance' : `Customize (${selectedThemeLabel})`}
            </button>

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
                  <div className="vault-btn-row" style={{ flexWrap: 'wrap' }}>
                    {selectedCustomPreset && (
                      <button className="vault-action-btn ghost" onClick={() => deleteThemePreset(selectedCustomPreset.id)}>
                        <Trash2 size={14} />
                        Delete Preset ({selectedCustomPreset.name})
                      </button>
                    )}
                    <button className="vault-action-btn ghost" onClick={resetThemeOverrides}>
                      <RotateCcw size={14} />
                      Reset to Base
                    </button>
                    <button
                      className={`vault-action-btn ${themeSettingsDirty ? 'solid' : 'ghost'}`}
                      disabled={!themeSettingsDirty}
                      onClick={() => void persistThemeSettings()}
                    >
                      <Save size={14} />
                      Save Theme
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
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-accent">
                  <User size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Account</h3>
                  <p className="muted">{cloudConnected ? cloudIdentity || 'Google connected' : 'Not signed in'}</p>
                </div>
                <span className={`feature-dot ${cloudConnected ? 'connected' : 'disconnected'}`} />
              </div>
              <div className="settings-feature-body">
                <div className="vault-btn-row">
                  {!cloudConnected ? (
                    showCloudSignIn ? (
                      syncProvider === 'self_hosted' ? (
                        <button
                          className="vault-action-btn ghost"
                          onClick={() => void signInWithGoogle()}
                          disabled={cloudAuthState === 'checking'}
                        >
                          <KeyRound size={15} />
                          {cloudAuthState === 'checking' ? 'Checking Session...' : 'Authenticate'}
                        </button>
                      ) : (
                        <GoogleSignInButton
                          onClick={() => void signInWithGoogle()}
                          disabled={cloudAuthState === 'checking'}
                          label={cloudAuthState === 'checking' ? 'Checking Session...' : 'Sign in with Google'}
                        />
                      )
                    ) : null
                  ) : (
                    <button className="vault-action-btn ghost" onClick={() => void signOutCloud()}>
                      <LogOut size={15} />
                      Sign out
                    </button>
                  )}
                  {syncProvider !== 'self_hosted' && (
                    <button className="vault-action-btn ghost" onClick={() => void createPasskeyIdentity()}>
                      <KeyRound size={15} />
                      Bind Cloud Passkey
                    </button>
                  )}
                </div>
                {syncProvider === 'self_hosted' && selfHostedLocked && (
                  <p className="settings-plan-hint muted">Available on Enterprise</p>
                )}
              </div>
            </div>
          </section>

          <div className="settings-divider" hidden={!isGeneral} />

          <section className="settings-section" hidden={!isGeneral}>
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-muted">
                  <Package size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>App & Updates</h3>
                  <p className="muted">{appBuildInfo.version} ({appBuildInfo.commit.slice(0, 8)}) &middot; {updateStatusLabel}</p>
                </div>
              </div>
              <div className="settings-feature-body">
                <dl className="settings-build-grid">
                  <dt>Channel</dt><dd>{appBuildInfo.channel}</dd>
                  <dt>Built</dt><dd>{formatDateTime(appBuildInfo.builtAt)}</dd>
                  <dt>Policy</dt><dd>{updateCheckResult.policy}</dd>
                  <dt>Latest</dt><dd>{updateCheckResult.latestVersion ?? 'n/a'}</dd>
                  <dt>Min supported</dt><dd>{updateCheckResult.minimumSupportedVersion ?? 'n/a'}</dd>
                  {updateCheckResult.forceBy && (<><dt>Force by</dt><dd>{formatDateTime(updateCheckResult.forceBy)}</dd></>)}
                </dl>
                {updateCheckResult.message && (
                  <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>{updateCheckResult.message}</p>
                )}
                <div className="vault-btn-row">
                  <button className="vault-action-btn ghost" onClick={() => void checkForAppUpdates()} disabled={isCheckingForUpdates}>
                    <RefreshCw size={15} />
                    {isCheckingForUpdates ? 'Checking...' : 'Check for Updates'}
                  </button>
                  <button className="vault-action-btn ghost" onClick={() => openExternalUrl(releaseNotesUrl)} disabled={!releaseNotesUrl}>
                    <ExternalLink size={15} />
                    Release Notes
                  </button>
                  <button className="vault-action-btn ghost" onClick={() => openExternalUrl(installUrl)} disabled={!installUrl}>
                    <ExternalLink size={15} />
                    Install Link
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section" hidden={!isCloud}>
            {orgMemberships.length > 0 && (
              <div className="settings-feature-card" style={{ marginBottom: '1rem' }}>
                <div className="settings-feature-head">
                  <div className="settings-feature-icon tint-accent">
                    <Cloud size={18} />
                  </div>
                  <div className="settings-feature-title">
                    <h3>Organization Sharing</h3>
                    <p className="muted">
                      {selectedOrgMembership
                        ? `${selectedOrgMembership.orgName || selectedOrgMembership.orgId} (${selectedOrgMembership.role})`
                        : 'Select an organization from the lock screen to manage sharing.'}
                    </p>
                  </div>
                </div>
                <div className="settings-feature-body">
                  {activeSharedVaultSource && !canEditActiveVault && (
                    <p className="muted" style={{ marginTop: 0 }}>
                      This shared vault is read-only for your org role.
                    </p>
                  )}
                  <div className="vault-btn-row">
                    <button
                      className="vault-action-btn ghost"
                      onClick={() => void shareCurrentVaultWithOrg()}
                      disabled={!selectedOrgId || !canManageCurrentOrgShare}
                    >
                      <CloudUpload size={15} />
                      Share Current Vault
                    </button>
                    <button
                      className="vault-action-btn ghost"
                      onClick={() => void refreshCurrentVaultOrgAccess()}
                      disabled={!selectedOrgId || !canManageCurrentOrgShare || !sharedVaultInSelectedOrg}
                    >
                      <RefreshCw size={15} />
                      Refresh Org Access
                    </button>
                    <button
                      className="vault-action-btn ghost trash-empty-btn"
                      onClick={() => void unshareCurrentVaultFromOrg()}
                      disabled={!selectedOrgId || !canManageCurrentOrgShare || !sharedVaultInSelectedOrg}
                    >
                      <Trash2 size={15} />
                      Unshare Vault
                    </button>
                  </div>
                  {!canManageCurrentOrgShare && selectedOrgMembership && (
                    <p className="muted" style={{ marginBottom: 0 }}>
                      Only org owners can share, refresh, or unshare vault access.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-accent">
                  <Database size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Storage Mode</h3>
                  <p className="muted">{storageMode === 'local_file' ? 'Using local encrypted file' : 'Cloud-only encrypted storage'}</p>
                </div>
              </div>
              <div className="settings-feature-body">
                <div className="settings-toggle-row">
                  <span>Vault Persistence</span>
                  <div className="vault-btn-row">
                    <button
                      className={`vault-action-btn ${storageMode === 'local_file' ? 'solid' : 'ghost'}`}
                      onClick={() => setStorageMode('local_file')}
                    >
                      <HardDrive size={14} />
                      Local File
                    </button>
                    <button
                      className={`vault-action-btn ${storageMode === 'cloud_only' ? 'solid' : 'ghost'}`}
                      disabled={cloudOnlyLocked || selfHostedLocked}
                      onClick={() => setStorageMode('cloud_only')}
                    >
                      <Cloud size={14} />
                      Cloud Only
                    </button>
                  </div>
                </div>
                {(cloudOnlyLocked || selfHostedLocked) && (
                  <p className="settings-plan-hint muted">Available on {selfHostedLocked ? 'Enterprise' : 'Premium'}</p>
                )}
                <label className="settings-inline-label">
                  <Clock size={14} />
                  <span>Cache TTL</span>
                  <input
                    className="trash-retention-input"
                    type="number"
                    min={1}
                    max={720}
                    disabled={devicePrivacySettings.disableCloudCache}
                    inputMode="numeric"
                    value={cloudCacheTtlHours}
                    onChange={(event) => setCloudCacheTtlHours(Math.max(1, Math.min(720, Math.round(Number(event.target.value) || 72))))}
                  />
                  <span className="trash-retention-unit">hours</span>
                </label>
                <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                  {devicePrivacySettings.disableCloudCache
                    ? 'Encrypted cache is disabled on this device'
                    : cloudCacheExpiresAt
                    ? `Cache expires ${new Date(cloudCacheExpiresAt).toLocaleString()}`
                    : 'No encrypted cache currently stored'}
                </p>
                <div className="settings-toggle-row">
                  <span>Disable Encrypted Cache</span>
                  <button
                    className={devicePrivacySettings.disableCloudCache ? 'solid' : 'ghost'}
                    onClick={() => setDevicePrivacySettings((current) => ({
                      ...current,
                      disableCloudCache: !current.disableCloudCache,
                    }))}
                  >
                    {devicePrivacySettings.disableCloudCache ? 'On' : 'Off'}
                  </button>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                  This device only. Turning this on clears the encrypted cache and skips future cached snapshots.
                </p>
                <div className="vault-btn-row">
                  <button
                    className="vault-action-btn ghost"
                    onClick={() => clearCachedVaultSnapshot('Encrypted cache cleared from this device')}
                  >
                    <Trash2 size={15} />
                    Clear Encrypted Cache Now
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section" hidden={!isCloud}>
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-accent">
                  <Cloud size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Cloud Sync</h3>
                  <p className="muted">Provider: {syncProvider === 'self_hosted' ? 'Self-hosted' : 'Convex'}</p>
                </div>
                <span className={`feature-dot ${cloudSyncEnabled && !cloudSyncLocked ? 'connected' : 'disconnected'}`} />
              </div>
              <div className="settings-feature-body">
                {(cloudSyncLocked || selfHostedLocked) && (
                  <p className="settings-plan-hint muted">Available on {selfHostedLocked ? 'Enterprise' : 'Premium'}</p>
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
                <button
                  className="vault-action-btn ghost"
                  onClick={() => void pushVaultToCloudNow()}
                  disabled={cloudSyncLocked || selfHostedLocked}
                >
                  <CloudUpload size={15} />
                  Push Vault to Cloud Now
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section" hidden={!isSecurity}>
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-safe">
                  <KeyRound size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Quick Unlock</h3>
                  <p className="muted">
                    {isOrgSharedVault
                      ? 'Unavailable for organization-shared vaults'
                      : quickUnlockCapabilities.supported
                      ? (quickUnlockEnabled
                        ? (quickUnlockCapabilities.method === 'android-native' ? 'Biometric unlock enabled' : 'Passkey unlock enabled')
                        : 'Set up fast unlock for this device')
                      : (quickUnlockCapabilities.unavailableReason || 'Not supported on this device')}
                  </p>
                </div>
                {quickUnlockCapabilities.supported && !isOrgSharedVault && (
                  <span className={`feature-dot ${quickUnlockEnabled ? 'connected' : 'disconnected'}`} />
                )}
              </div>
              {quickUnlockCapabilities.supported && !isOrgSharedVault && (
                <div className="settings-feature-body">
                  <div className="settings-toggle-row">
                    <span>Method</span>
                    <strong className="settings-inline-badge">{quickUnlockMethodLabel}</strong>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                    This device only.
                  </p>
                  <div className="vault-btn-row">
                    <button
                      className={`vault-action-btn ${quickUnlockEnabled ? 'solid' : 'ghost'}`}
                      onClick={() => void enableQuickUnlock()}
                    >
                      <KeyRound size={15} />
                      {quickUnlockEnabled ? `Re-enroll ${quickUnlockMethodLabel}` : quickUnlockCapabilities.enrollmentLabel}
                    </button>
                    {quickUnlockEnabled && (
                      <button className="vault-action-btn ghost" onClick={() => void disableQuickUnlock()}>
                        <ShieldOff size={15} />
                        Disable on This Device
                      </button>
                    )}
                  </div>
                  {(syncMessage.toLowerCase().includes('biometric') || syncMessage.toLowerCase().includes('passkey') || syncMessage.toLowerCase().includes('quick unlock')) && (
                    <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>{syncMessage}</p>
                  )}
                </div>
              )}
              {isOrgSharedVault && (
                <div className="settings-feature-body">
                  <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                    Organization-shared vaults stay cloud-only, so this device cannot keep a local quick-unlock copy.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="settings-section" hidden={!isSecurity}>
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-accent">
                  <LockKeyhole size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Auto-Lock</h3>
                  <p className="muted">
                    {devicePrivacySettings.autoLockMinutes > 0
                      ? `Locks after ${devicePrivacySettings.autoLockMinutes} minute${devicePrivacySettings.autoLockMinutes === 1 ? '' : 's'} idle`
                      : 'Idle auto-lock disabled'}
                  </p>
                </div>
              </div>
              <div className="settings-feature-body">
                <label className="settings-inline-label">
                  <Clock size={14} />
                  <span>Idle Lock</span>
                  <input
                    className="trash-retention-input"
                    type="number"
                    min={0}
                    max={240}
                    inputMode="numeric"
                    value={devicePrivacySettings.autoLockMinutes}
                    onChange={(event) => setDevicePrivacySettings((current) => ({
                      ...current,
                      autoLockMinutes: Math.max(0, Math.min(240, Math.round(Number(event.target.value) || 0))),
                    }))}
                    onWheel={(event) => event.currentTarget.blur()}
                  />
                  <span className="trash-retention-unit">minutes</span>
                </label>
                <div className="settings-toggle-row">
                  <span>Lock on Background</span>
                  <button
                    className={devicePrivacySettings.lockOnBackground ? 'solid' : 'ghost'}
                    onClick={() => setDevicePrivacySettings((current) => ({
                      ...current,
                      lockOnBackground: !current.lockOnBackground,
                    }))}
                  >
                    {devicePrivacySettings.lockOnBackground ? 'On' : 'Off'}
                  </button>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                  This device only. Background locking applies when the app is hidden or sent to the background.
                </p>
              </div>
            </div>
          </section>

          <section className="settings-section" hidden={!isSecurity}>
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-safe">
                  <Clipboard size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Clipboard Hygiene</h3>
                  <p className="muted">
                    {passwordClipboardSeconds > 0
                      ? `Copied passwords clear after ${passwordClipboardSeconds} second${passwordClipboardSeconds === 1 ? '' : 's'}`
                      : 'Copied passwords stay until you replace them'}
                  </p>
                </div>
              </div>
              <div className="settings-feature-body">
                <label className="settings-inline-label">
                  <Clock size={14} />
                  <span>Password Clear</span>
                  <input
                    className="trash-retention-input"
                    type="number"
                    min={0}
                    max={300}
                    inputMode="numeric"
                    value={passwordClipboardSeconds}
                    onChange={(event) => updateClipboardSettings({
                      passwordClearSeconds: Math.max(0, Math.min(300, Math.round(Number(event.target.value) || 0))),
                    })}
                    onWheel={(event) => event.currentTarget.blur()}
                  />
                  <span className="trash-retention-unit">seconds</span>
                </label>
                <div className="settings-toggle-row">
                  <span>Clear Tracked Secret on Lock</span>
                  <button
                    className={vaultSettings.clipboard?.clearOnLock !== false ? 'solid' : 'ghost'}
                    onClick={() => updateClipboardSettings({
                      clearOnLock: !(vaultSettings.clipboard?.clearOnLock !== false),
                    })}
                  >
                    {vaultSettings.clipboard?.clearOnLock !== false ? 'On' : 'Off'}
                  </button>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                  Syncs with this vault. This pass only applies cleanup to copied passwords and similar password-field secrets.
                </p>
              </div>
            </div>
          </section>

          <section className="settings-section" hidden={!isSecurity}>
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-accent">
                  <Keyboard size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Keybinds</h3>
                  <p className="muted">Edit the shortcuts currently used across the vault UI.</p>
                </div>
              </div>
              <div className="settings-feature-body">
                <p className="muted settings-keybind-caption">
                  Press a shortcut button, then type the combo you want. Press Backspace/Delete to clear, or Escape to cancel capture.
                </p>
                <div className="settings-keybind-list">
                  {KEYBIND_DEFINITIONS.map((definition) => {
                    const shortcut = keybindDraft[definition.id]
                    const conflictLabel = keybindConflictLabels.get(definition.id)
                    const scopeLabel = definition.scope === 'global' ? 'Global' : 'Item menu'
                    const isCapturing = capturingKeybind === definition.id
                    return (
                      <div key={definition.id} className={`settings-keybind-row${conflictLabel ? ' settings-keybind-row-conflict' : ''}`}>
                        <div className="settings-keybind-copy">
                          <div className="settings-keybind-headline">
                            <strong>{definition.label}</strong>
                            <span className="settings-inline-badge">{scopeLabel}</span>
                          </div>
                          <p>{definition.description}</p>
                          {conflictLabel && (
                            <p className="settings-keybind-conflict">
                              Conflicts with {conflictLabel}.
                            </p>
                          )}
                        </div>
                        <div className="settings-keybind-actions">
                          <kbd className="settings-keybind-display">{formatShortcutLabel(shortcut)}</kbd>
                          <button
                            className={`vault-action-btn ${isCapturing ? 'solid' : 'ghost'}`}
                            onClick={() => setCapturingKeybind((current) => current === definition.id ? null : definition.id)}
                          >
                            <Keyboard size={15} />
                            {isCapturing ? 'Listening...' : 'Change'}
                          </button>
                          <button
                            className="vault-action-btn ghost"
                            onClick={() => {
                              setKeybindDraft((current) => ({ ...current, [definition.id]: null }))
                              if (capturingKeybind === definition.id) setCapturingKeybind(null)
                            }}
                            disabled={!shortcut}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="vault-btn-row">
                  <button
                    className={`vault-action-btn ${keybindsDirty && keybindConflicts.size === 0 ? 'solid' : 'ghost'}`}
                    onClick={() => void saveKeybinds()}
                    disabled={!keybindsDirty || keybindConflicts.size > 0}
                  >
                    <Save size={15} />
                    Save Keybinds
                  </button>
                  <button
                    className="vault-action-btn ghost"
                    onClick={() => {
                      setKeybindDraft(defaultKeybindSettings())
                      setCapturingKeybind(null)
                    }}
                  >
                    <RotateCcw size={15} />
                    Reset Defaults
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section" hidden={!isSecurity}>
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-warn">
                  <ShieldAlert size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Compromised Passwords</h3>
                  <p className="muted">Uses k-anonymity. Only a hash prefix is sent.</p>
                </div>
              </div>
              <div className="settings-feature-body">
                {breachScanLocked && (
                  <p className="settings-plan-hint muted">Requires Premium plan</p>
                )}
                <div className="settings-toggle-row">
                  <span>Compromised Password Check</span>
                  <button
                    className={vaultSettings.breachCheck?.enabled ? 'solid' : 'ghost'}
                    onClick={() => void setBreachCheckEnabled(!(vaultSettings.breachCheck?.enabled === true))}
                    disabled={breachScanLocked || breachScanRunning}
                  >
                    {vaultSettings.breachCheck?.enabled ? 'On' : 'Off'}
                  </button>
                </div>
                <button
                  className="vault-action-btn ghost"
                  onClick={() => void runBreachScanAll()}
                  disabled={breachScanLocked || breachScanRunning}
                >
                  <Search size={15} />
                  {breachScanRunning ? 'Scanning All Entries...' : 'Scan All Entries Now'}
                </button>
                {breachScanRunning && (
                  <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                    Progress: {breachScanProgress.done}/{breachScanProgress.total}
                  </p>
                )}
                {breachScanSummary && (
                  <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                    Last scan: {breachScanSummary.compromised} compromised, {breachScanSummary.unavailable} unavailable, {breachScanSummary.scanned} passwords ({formatDateTime(breachScanSummary.finishedAt)})
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="settings-section" hidden={!isSecurity}>
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-safe">
                  <ShieldCheck size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>AI Security Copilot</h3>
                  <p className="muted">Local-only guidance layered on top of Armadillo risk signals.</p>
                </div>
              </div>
              <div className="settings-feature-body">
                <div className="settings-toggle-row">
                  <span>Copilot Suggestions</span>
                  <button
                    className={vaultSettings.ai?.enabled !== false ? 'solid' : 'ghost'}
                    onClick={() => updateAiSettings({ enabled: !(vaultSettings.ai?.enabled !== false) })}
                  >
                    {vaultSettings.ai?.enabled !== false ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="settings-toggle-row">
                  <span>Inference Mode</span>
                  <strong className="settings-inline-badge">Local only</strong>
                </div>
                <div className="settings-toggle-row">
                  <span>Allow Selected Note Analysis</span>
                  <button
                    className={vaultSettings.ai?.allowSelectedNoteAnalysis ? 'solid' : 'ghost'}
                    onClick={() => updateAiSettings({ allowSelectedNoteAnalysis: !(vaultSettings.ai?.allowSelectedNoteAnalysis === true) })}
                  >
                    {vaultSettings.ai?.allowSelectedNoteAnalysis ? 'On' : 'Off'}
                  </button>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                  Note analysis is opt-in and only applies to explicitly selected content. Nothing is sent to a remote model in this version.
                </p>
                <div className="settings-ai-grid">
                  <div className="settings-ai-list">
                    <h4>Included by default</h4>
                    <ul>
                      {AI_INCLUDED_FIELD_LABELS.map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="settings-ai-list">
                    <h4>Always excluded by default</h4>
                    <ul>
                      {AI_EXCLUDED_FIELD_LABELS.map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <button className="vault-action-btn ghost" onClick={clearDismissedCopilotSuggestions}>
                  <RotateCcw size={15} />
                  Reset Dismissed Copilot Actions
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section" hidden={!isSecurity}>
            <div className="settings-feature-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-accent">
                  <LifeBuoy size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Recovery Kit</h3>
                  <p className="muted">
                    {recoveryKitEnabled
                      ? `Enabled (${recoveryKeyFingerprintSuffix || 'fingerprint unavailable'})`
                      : 'Not enabled — set up offline recovery'}
                  </p>
                </div>
                <span className={`feature-dot ${recoveryKitEnabled ? 'connected' : 'disconnected'}`} />
              </div>
              <div className="settings-feature-body">
                {(recoveryEnabledAt || recoveryRotatedAt) && (
                  <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                    Enabled: {formatDateTime(recoveryEnabledAt)}{recoveryRotatedAt ? ` · Rotated: ${formatDateTime(recoveryRotatedAt)}` : ''}
                  </p>
                )}
                <div className="vault-btn-row">
                  {!recoveryKitEnabled ? (
                    <button className="vault-action-btn ghost" onClick={() => void enableRecoveryKit()}>
                      <ShieldCheck size={15} />
                      Enable Recovery Kit
                    </button>
                  ) : (
                    <>
                      <button className="vault-action-btn ghost" onClick={() => void rotateRecoveryKit()}>
                        <RotateCcw size={15} />
                        Rotate Key
                      </button>
                      <button className="vault-action-btn ghost" onClick={() => void disableRecoveryKit()}>
                        <ShieldOff size={15} />
                        Disable
                      </button>
                    </>
                  )}
                </div>
                {recoveryKeyDisplay && (
                  <div className="settings-recovery-reveal">
                    <p style={{ margin: '0 0 0.35rem', fontWeight: 600, fontSize: '0.8rem' }}>Store this recovery key offline now.</p>
                    <pre className="settings-recovery-key">{recoveryKeyDisplay}</pre>
                    <button className="vault-action-btn solid" onClick={acknowledgeRecoveryKeyStored}>
                      <Save size={15} />
                      I Stored This Offline
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {isNativeAndroid() && autofillSupported && (
            <section className="settings-section" hidden={!isSecurity}>
              <div className="settings-feature-card">
                <div className="settings-feature-head">
                  <div className="settings-feature-icon tint-safe">
                    <Smartphone size={18} />
                  </div>
                  <div className="settings-feature-title">
                    <h3>Autofill</h3>
                    <p className="muted">{autofillEnabled ? 'Armadillo is your autofill provider' : 'Autofill not enabled'}</p>
                  </div>
                  <span className={`feature-dot ${autofillEnabled ? 'connected' : 'disconnected'}`} />
                </div>
                <div className="settings-feature-body">
                  <button
                    className={`vault-action-btn ${autofillEnabled ? 'solid' : 'ghost'}`}
                    onClick={() => {
                      void AutofillBridge.openAutofillSettings().then(() => {
                        setTimeout(checkAutofillStatus, 1000)
                      })
                    }}
                  >
                    <Smartphone size={15} />
                    {autofillEnabled ? 'Autofill Settings' : 'Enable Autofill'}
                  </button>
                </div>
              </div>
            </section>
          )}

          <section className="settings-section" hidden={!isVault}>
            <h3>Vault</h3>
            <div className="vault-settings-grid">
              <div className="settings-vault-group">
                <p className="settings-vault-group-title">Import & Export</p>
                <div className="vault-btn-row">
                  <button className="vault-action-btn ghost" onClick={exportVaultFile} disabled={isOrgSharedVault}>
                    <Download size={15} />
                    Export Vault File
                  </button>
                  <button className="vault-action-btn ghost" onClick={() => void exportVaultBackupBundle()} disabled={isOrgSharedVault}>
                    <ArchiveRestore size={15} />
                    Export Full Backup
                  </button>
                </div>
                <p className="muted settings-io-note">
                  {isOrgSharedVault
                    ? 'Organization-shared vaults stay cloud-only and cannot be exported to this device.'
                    : 'Export requires master-password confirmation each time.'}
                </p>
                <button
                  className={`vault-action-btn ${showImportWizard ? 'solid' : 'ghost'}`}
                  onClick={() => setShowImportWizard((current) => !current)}
                >
                  <Upload size={15} />
                  {showImportWizard ? 'Close Import Wizard' : 'Open Import Wizard'}
                </button>
                {showImportWizard && (
                  <div className="import-wizard-card">
                    <div className="import-wizard-head">
                      <strong>Import Wizard</strong>
                      <span>Choose your source</span>
                    </div>
                    <div className="import-provider-grid">
                      {importProviderOptions.map((provider) => (
                        <button
                          key={provider.id}
                          className="import-provider-tile"
                          onClick={() => {
                            provider.onClick()
                            setShowImportWizard(false)
                          }}
                        >
                          {provider.logo ? (
                            <img src={provider.logo} alt={`${provider.label} logo`} className="import-provider-logo" />
                          ) : (
                            <span className="import-provider-fallback">{provider.initials}</span>
                          )}
                          <span className="import-provider-text">
                            <strong>{provider.label}</strong>
                            <small>{provider.meta}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="settings-vault-group">
                <p className="settings-vault-group-title">Vault Management</p>
                <div className="vault-btn-row">
                  <button className="vault-action-btn ghost" onClick={() => void previewAutoFoldering()} disabled={autoFolderBusy}>
                    <FolderTreeIcon size={15} />
                    {autoFolderBusy ? 'Building Plan...' : 'Auto-Folder Unfiled'}
                  </button>
                  {window.armadilloShell?.isElectron && storageMode === 'local_file' && (
                    <button className="vault-action-btn ghost" onClick={() => void chooseLocalVaultLocation()}>
                      <HardDrive size={15} />
                      Vault Location
                    </button>
                  )}
                </div>
                {recentLocalVaultPaths.length > 0 && (
                  <div className="vault-picker-recent">
                    <p className="muted settings-io-note" style={{ marginTop: 0 }}>
                      Recent Local Vaults
                    </p>
                    <div className="vault-picker-recent-row">
                      <select
                        value={resolvedSwitchVaultPath}
                        onChange={(event) => setSwitchVaultPath(event.target.value)}
                        aria-label="Local vault switch target"
                      >
                        {recentLocalVaultPaths.map((entry) => {
                          const status = recentLocalVaultPathStatuses[entry.path] ?? 'unknown'
                          return (
                            <option key={entry.path} value={entry.path}>
                              {`${vaultFileLabel(entry.path)} - ${status}`}
                            </option>
                          )
                        })}
                      </select>
                      <button
                        className="vault-action-btn ghost vault-picker-remove"
                        disabled={!canSwitchLocalVault || !resolvedSwitchVaultPath || isSwitchTargetActive}
                        onClick={() => {
                          if (!canSwitchLocalVault || !resolvedSwitchVaultPath || isSwitchTargetActive) return
                          lockVault()
                          selectRecentLocalVaultPath(resolvedSwitchVaultPath)
                        }}
                      >
                        Switch
                      </button>
                    </div>
                    <p className="muted settings-io-note" style={{ marginTop: 0 }}>
                      Selected: {vaultFileLabel(resolvedSwitchVaultPath || 'No vault selected')} ({switchTargetStatus}){localVaultPath ? ` · Active: ${vaultFileLabel(localVaultPath)}` : ''}
                    </p>
                  </div>
                )}
                {recentLocalVaultPaths.length > 0 && (
                  <>
                    <div className="settings-action-list">
                      <button
                        className="ghost"
                        disabled={!resolvedSwitchVaultPath}
                        onClick={() => removeRecentLocalVaultPath(resolvedSwitchVaultPath)}
                      >
                        Forget Selected Path
                      </button>
                      <button
                        className="ghost"
                        disabled={recentLocalVaultPaths.length === 0}
                        onClick={() => clearRecentLocalVaultPaths()}
                      >
                        Clear All Recent Paths
                      </button>
                    </div>
                    <p className="muted settings-io-note" style={{ marginTop: 0 }}>
                      This device only. Clearing path history does not delete any vault files.
                    </p>
                  </>
                )}
              </div>
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
            <div className="trash-settings-card">
              <div className="trash-settings-head">
                <div className="trash-settings-icon">
                  <Trash2 size={18} />
                </div>
                <div className="trash-settings-title">
                  <h3>Trash{trash.length > 0 && <span className="trash-count-badge">{trash.length}</span>}</h3>
                  <p className="muted">
                    {trash.length === 0
                      ? 'Trash is empty. Deleted items will appear here.'
                      : `${trash.length} item${trash.length === 1 ? '' : 's'} in trash. Items are removed after the retention period.`}
                  </p>
                </div>
              </div>
              <div className="trash-settings-body">
                <label className="trash-retention-field">
                  <Clock size={14} />
                  <span>Retention</span>
                  <input
                    className="trash-retention-input"
                    type="number"
                    min={1}
                    max={3650}
                    inputMode="numeric"
                    value={vaultSettings.trashRetentionDays}
                    onChange={(event) => {
                      const nextDays = getSafeRetentionDays(Number(event.target.value))
                      setVaultSettings((prev) => ({ ...prev, trashRetentionDays: nextDays }))
                    }}
                    onWheel={(event) => {
                      event.currentTarget.blur()
                    }}
                  />
                  <span className="trash-retention-unit">days</span>
                </label>
                <div className="trash-settings-actions">
                  <button
                    className="vault-action-btn ghost"
                    onClick={() => void persistPayload({ settings: vaultSettings })}
                  >
                    <Save size={14} />
                    Save
                  </button>
                  <button
                    className="vault-action-btn ghost trash-empty-btn"
                    disabled={trash.length === 0}
                    onClick={() => {
                      if (window.confirm(`Permanently delete all ${trash.length} item${trash.length === 1 ? '' : 's'} in trash? This cannot be undone.`)) {
                        void persistPayload({ trash: [] })
                      }
                    }}
                  >
                    <Trash2 size={14} />
                    Empty Trash
                  </button>
                </div>
              </div>
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
                    <button className={`vault-action-btn ${upgradeDisabled ? 'ghost' : 'solid'}`} onClick={openBillingUrl} disabled={upgradeDisabled}>
                      <ExternalLink size={15} />
                      {upgradeDisabled ? 'Upgrade URL Not Configured' : 'Upgrade to Premium'}
                    </button>
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
                    <div className="vault-btn-row">
                      <button className="vault-action-btn ghost" onClick={() => void refreshEntitlements()}>
                        <RefreshCw size={15} />
                        Refresh Entitlements
                      </button>
                      {billingUrl && (
                        <button className="vault-action-btn ghost" onClick={openBillingUrl}>
                          <ExternalLink size={15} />
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
                    <div className="vault-btn-row">
                      <button className="vault-action-btn ghost" onClick={() => void handleApplyManualToken()} disabled={manualTokenBusy}>
                        <KeyRound size={15} />
                        {manualTokenBusy ? 'Validating...' : 'Apply Signed Token'}
                      </button>
                      <button className="vault-action-btn ghost" onClick={clearManualEntitlementToken}>
                        <Trash2 size={15} />
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

                    <div className="vault-btn-row">
                      <button className="vault-action-btn ghost" onClick={handleApplyDevOverride}>
                        <Save size={15} />
                        Apply Overrides
                      </button>
                      <button className="vault-action-btn ghost" onClick={clearDevFlagOverrides}>
                        <Trash2 size={15} />
                        Clear All
                      </button>
                    </div>
                  </>
                )}
              </section>
            </>
          )}

          <section className="settings-section" hidden={!isDanger}>
            <div className="settings-feature-card settings-danger-card">
              <div className="settings-feature-head">
                <div className="settings-feature-icon tint-danger">
                  <AlertTriangle size={18} />
                </div>
                <div className="settings-feature-title">
                  <h3>Danger Zone</h3>
                  <p className="muted">Destructive actions for testing and recovery. These cannot be undone.</p>
                </div>
              </div>
              <div className="settings-feature-body">
                <div className="vault-btn-row">
                  <button
                    className="vault-action-btn ghost trash-empty-btn"
                    onClick={() => {
                      if (!window.confirm('Empty all vault items, folders, and trash for testing?')) return
                      void emptyVaultForTesting()
                    }}
                  >
                    <ServerCrash size={15} />
                    Empty Vault (Testing)
                  </button>
                  <button
                    className="vault-action-btn ghost trash-empty-btn"
                    onClick={() => {
                      if (!window.confirm('Delete local vault data and cached vault data from this device? This does NOT delete cloud saves. This cannot be undone.')) return
                      clearLocalVaultFile()
                      clearCachedVaultSnapshot()
                      window.location.reload()
                    }}
                  >
                    <AlertTriangle size={15} />
                    Reset Local Device Data
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
