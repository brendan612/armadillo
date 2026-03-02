import type {
  BuiltInThemeId,
  ThemeCustomPreset,
  ThemeEditableTokenKey,
  ThemeMotionLevel,
  ThemeTokenOverrides,
  VaultThemeSettings,
} from '../../types/vault'

type BuiltInThemePreset = {
  id: BuiltInThemeId
  label: string
  description: string
  swatch: [string, string, string, string]
  tokens: Record<string, string>
}

type ThemeMirrorPayload = {
  theme: VaultThemeSettings
}

const MAX_CUSTOM_PRESETS = 24
const MAX_PRESET_NAME_LENGTH = 40
const MAX_BLUR_PX = 40
const MIN_BLUR_PX = 0
const MIN_NOISE_OPACITY = 0
const MAX_NOISE_OPACITY = 0.12
const DEFAULT_NOISE_OPACITY = 0.025
const DEFAULT_BLUR_PX = 20

const BUILT_IN_THEME_PRESET_MAP: Record<BuiltInThemeId, BuiltInThemePreset> = {
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    description: 'Default',
    swatch: ['#0b0d13', '#171b27', '#d4854a', '#e4e7f2'],
    tokens: {
      'bg-0': '#0b0d13',
      'bg-1': '#10131c',
      'bg-2': '#171b27',
      'bg-3': '#1d2235',
      surface: 'rgba(23, 27, 39, 0.78)',
      'surface-solid': '#171b27',
      ink: '#e4e7f2',
      'ink-secondary': '#949bb5',
      'ink-muted': '#575e78',
      line: 'rgba(255, 255, 255, 0.07)',
      'line-strong': 'rgba(255, 255, 255, 0.13)',
      accent: '#d4854a',
      'accent-soft': 'rgba(212, 133, 74, 0.12)',
      'accent-glow': 'rgba(212, 133, 74, 0.22)',
      'accent-contrast': '#000000',
      safe: '#34d399',
      weak: '#fbbf24',
      reused: '#fb923c',
      exposed: '#f87171',
      stale: '#94a3b8',
      'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)',
      'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.35)',
      'shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.4)',
      'orb-1': 'rgba(212, 133, 74, 0.045)',
      'orb-2': 'rgba(160, 100, 50, 0.03)',
      'noise-opacity': '0.025',
      blur: '20px',
    },
  },
  daylight: {
    id: 'daylight',
    label: 'Daylight',
    description: 'Clean Light',
    swatch: ['#f3f4f7', '#ffffff', '#14b8a6', '#1a1e2d'],
    tokens: {
      'bg-0': '#f3f4f7',
      'bg-1': '#eaecf1',
      'bg-2': '#ffffff',
      'bg-3': '#f0f1f5',
      surface: 'rgba(255, 255, 255, 0.82)',
      'surface-solid': '#ffffff',
      ink: '#1a1e2d',
      'ink-secondary': '#585e72',
      'ink-muted': '#9198a8',
      line: 'rgba(0, 0, 0, 0.08)',
      'line-strong': 'rgba(0, 0, 0, 0.14)',
      accent: '#14b8a6',
      'accent-soft': 'rgba(20, 184, 166, 0.15)',
      'accent-glow': 'rgba(20, 184, 166, 0.24)',
      'accent-contrast': '#0b0d13',
      safe: '#16a34a',
      weak: '#d97706',
      reused: '#ea580c',
      exposed: '#dc2626',
      stale: '#64748b',
      'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.05)',
      'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.07)',
      'shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.09)',
      'orb-1': 'rgba(20, 184, 166, 0.08)',
      'orb-2': 'rgba(99, 102, 241, 0.05)',
      'noise-opacity': '0.012',
      blur: '16px',
    },
  },
  void: {
    id: 'void',
    label: 'Void',
    description: 'OLED Black',
    swatch: ['#000000', '#0a0a14', '#00d4aa', '#d4d8e8'],
    tokens: {
      'bg-0': '#000000',
      'bg-1': '#04040a',
      'bg-2': '#0a0a14',
      'bg-3': '#10101c',
      surface: 'rgba(10, 10, 20, 0.88)',
      'surface-solid': '#0a0a14',
      ink: '#d4d8e8',
      'ink-secondary': '#7880a0',
      'ink-muted': '#464c68',
      line: 'rgba(255, 255, 255, 0.05)',
      'line-strong': 'rgba(255, 255, 255, 0.09)',
      accent: '#00d4aa',
      'accent-soft': 'rgba(0, 212, 170, 0.12)',
      'accent-glow': 'rgba(0, 212, 170, 0.24)',
      'accent-contrast': '#001a15',
      safe: '#34d399',
      weak: '#fbbf24',
      reused: '#fb923c',
      exposed: '#f87171',
      stale: '#94a3b8',
      'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.6)',
      'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.6)',
      'shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.7)',
      'orb-1': 'rgba(0, 255, 204, 0.03)',
      'orb-2': 'rgba(80, 80, 255, 0.02)',
      'noise-opacity': '0.018',
      blur: '24px',
    },
  },
  ember: {
    id: 'ember',
    label: 'Ember',
    description: 'Warm Dark',
    swatch: ['#0e0a06', '#1e160e', '#e8824a', '#f0e6d8'],
    tokens: {
      'bg-0': '#0e0a06',
      'bg-1': '#161008',
      'bg-2': '#1e160e',
      'bg-3': '#281e14',
      surface: 'rgba(30, 22, 14, 0.82)',
      'surface-solid': '#1e160e',
      ink: '#f0e6d8',
      'ink-secondary': '#aa9880',
      'ink-muted': '#6e5e4a',
      line: 'rgba(255, 200, 140, 0.09)',
      'line-strong': 'rgba(255, 200, 140, 0.16)',
      accent: '#e8824a',
      'accent-soft': 'rgba(232, 130, 74, 0.14)',
      'accent-glow': 'rgba(232, 130, 74, 0.25)',
      'accent-contrast': '#1f1209',
      safe: '#4ade80',
      weak: '#fbbf24',
      reused: '#fb923c',
      exposed: '#f87171',
      stale: '#a8a29e',
      'shadow-sm': '0 1px 2px rgba(14, 10, 6, 0.5)',
      'shadow-md': '0 4px 12px rgba(14, 10, 6, 0.5)',
      'shadow-lg': '0 8px 32px rgba(14, 10, 6, 0.6)',
      'orb-1': 'rgba(232, 130, 74, 0.045)',
      'orb-2': 'rgba(180, 120, 60, 0.032)',
      'noise-opacity': '0.028',
      blur: '18px',
    },
  },
}

export const BUILT_IN_THEME_PRESETS = Object.values(BUILT_IN_THEME_PRESET_MAP)

export const THEME_MIRROR_STORAGE_KEY = 'armadillo.ui.theme.mirror'

export const THEME_EDITABLE_TOKEN_KEYS: ThemeEditableTokenKey[] = [
  'accent',
  'bg-0',
  'bg-1',
  'bg-2',
  'bg-3',
  'surface-solid',
  'ink',
  'ink-secondary',
  'ink-muted',
  'line-strong',
  'safe',
  'weak',
  'reused',
  'exposed',
  'stale',
  'blur',
  'noise-opacity',
]

export const THEME_COLOR_TOKEN_KEYS: Exclude<ThemeEditableTokenKey, 'blur' | 'noise-opacity'>[] = [
  'accent',
  'bg-0',
  'bg-1',
  'bg-2',
  'bg-3',
  'surface-solid',
  'ink',
  'ink-secondary',
  'ink-muted',
  'line-strong',
  'safe',
  'weak',
  'reused',
  'exposed',
  'stale',
]

export function defaultThemeSettings(): VaultThemeSettings {
  return {
    activeBaseThemeId: 'midnight',
    activeOverrides: {},
    selectedPresetId: 'midnight',
    customPresets: [],
    motionLevel: 'normal',
  }
}

export function getBuiltInThemePreset(themeId: BuiltInThemeId) {
  return BUILT_IN_THEME_PRESET_MAP[themeId]
}

function isBuiltInThemeId(value: unknown): value is BuiltInThemeId {
  return value === 'midnight' || value === 'daylight' || value === 'void' || value === 'ember'
}

function normalizeMotionLevel(value: unknown): ThemeMotionLevel {
  return value === 'reduced' ? 'reduced' : 'normal'
}

function normalizeBlurValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const clamped = Math.min(MAX_BLUR_PX, Math.max(MIN_BLUR_PX, value))
    return `${Math.round(clamped)}px`
  }
  if (typeof value !== 'string') {
    return `${DEFAULT_BLUR_PX}px`
  }
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) {
    return `${DEFAULT_BLUR_PX}px`
  }
  const numeric = Number.parseFloat(trimmed.replace(/px$/i, ''))
  if (!Number.isFinite(numeric)) {
    return `${DEFAULT_BLUR_PX}px`
  }
  const clamped = Math.min(MAX_BLUR_PX, Math.max(MIN_BLUR_PX, numeric))
  return `${Math.round(clamped)}px`
}

function normalizeNoiseOpacityValue(value: unknown) {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value.trim())
      : Number.NaN
  if (!Number.isFinite(numeric)) {
    return String(DEFAULT_NOISE_OPACITY)
  }
  const clamped = Math.min(MAX_NOISE_OPACITY, Math.max(MIN_NOISE_OPACITY, numeric))
  return String(Number(clamped.toFixed(3)))
}

function looksSafeCssValue(value: string) {
  if (!value) return false
  if (value.length > 64) return false
  return !/[;{}<>]/.test(value)
}

function normalizeColorLikeValue(value: unknown) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!looksSafeCssValue(trimmed)) return ''
  return trimmed
}

export function normalizeThemeTokenOverrides(value: unknown): ThemeTokenOverrides {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const input = value as Record<string, unknown>
  const next: ThemeTokenOverrides = {}
  for (const key of THEME_EDITABLE_TOKEN_KEYS) {
    if (!(key in input)) continue
    if (key === 'blur') {
      next[key] = normalizeBlurValue(input[key])
      continue
    }
    if (key === 'noise-opacity') {
      next[key] = normalizeNoiseOpacityValue(input[key])
      continue
    }
    const normalized = normalizeColorLikeValue(input[key])
    if (!normalized) continue
    next[key] = normalized
  }
  return next
}

function normalizePresetName(value: unknown) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.slice(0, MAX_PRESET_NAME_LENGTH)
}

function normalizeCustomPreset(value: unknown): ThemeCustomPreset | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const name = normalizePresetName(source.name)
  if (!name) return null
  const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : new Date().toISOString()
  const updatedAt = typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : createdAt
  return {
    id: typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID(),
    name,
    baseThemeId: isBuiltInThemeId(source.baseThemeId) ? source.baseThemeId : 'midnight',
    overrides: normalizeThemeTokenOverrides(source.overrides),
    createdAt,
    updatedAt,
  }
}

export function normalizeThemeSettings(value: unknown): VaultThemeSettings {
  if (!value || typeof value !== 'object') {
    return defaultThemeSettings()
  }

  const source = value as Record<string, unknown>
  const customPresets: ThemeCustomPreset[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  if (Array.isArray(source.customPresets)) {
    for (const row of source.customPresets) {
      if (customPresets.length >= MAX_CUSTOM_PRESETS) break
      const preset = normalizeCustomPreset(row)
      if (!preset) continue
      const nameKey = preset.name.toLowerCase()
      if (seenIds.has(preset.id) || seenNames.has(nameKey)) continue
      seenIds.add(preset.id)
      seenNames.add(nameKey)
      customPresets.push(preset)
    }
  }

  const activeBaseThemeId = isBuiltInThemeId(source.activeBaseThemeId) ? source.activeBaseThemeId : 'midnight'
  const activeOverrides = normalizeThemeTokenOverrides(source.activeOverrides)
  const motionLevel = normalizeMotionLevel(source.motionLevel)
  const requestedSelection = typeof source.selectedPresetId === 'string' ? source.selectedPresetId.trim() : ''

  if (requestedSelection && isBuiltInThemeId(requestedSelection)) {
    return {
      activeBaseThemeId: requestedSelection,
      activeOverrides,
      selectedPresetId: requestedSelection,
      customPresets,
      motionLevel,
    }
  }

  if (requestedSelection) {
    const selectedCustomPreset = customPresets.find((preset) => preset.id === requestedSelection)
    if (selectedCustomPreset) {
      return {
        activeBaseThemeId: selectedCustomPreset.baseThemeId,
        activeOverrides: { ...selectedCustomPreset.overrides },
        selectedPresetId: selectedCustomPreset.id,
        customPresets,
        motionLevel,
      }
    }
  }

  return {
    activeBaseThemeId,
    activeOverrides,
    selectedPresetId: activeBaseThemeId,
    customPresets,
    motionLevel,
  }
}

function parseHexToRgb(hexColor: string) {
  const value = hexColor.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) {
    return null
  }
  const expanded = value.length === 3
    ? value.split('').map((char) => `${char}${char}`).join('')
    : value
  const parsed = Number.parseInt(expanded, 16)
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  }
}

function withAlpha(hexColor: string, alpha: number) {
  const rgb = parseHexToRgb(hexColor)
  if (!rgb) return ''
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

function colorLuminance(hexColor: string) {
  const rgb = parseHexToRgb(hexColor)
  if (!rgb) return null
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

export function resolveThemeTokens(themeSettings: VaultThemeSettings) {
  const normalized = normalizeThemeSettings(themeSettings)
  const basePreset = getBuiltInThemePreset(normalized.activeBaseThemeId)
  const tokens: Record<string, string> = { ...basePreset.tokens, ...normalized.activeOverrides }

  const accent = tokens.accent
  if (accent) {
    const soft = withAlpha(accent, 0.12)
    const glow = withAlpha(accent, 0.22)
    const orb1 = withAlpha(accent, 0.05)
    const orb2 = withAlpha(accent, 0.03)
    if (soft) tokens['accent-soft'] = soft
    if (glow) tokens['accent-glow'] = glow
    if (orb1) tokens['orb-1'] = orb1
    if (orb2) tokens['orb-2'] = orb2
    const luminance = colorLuminance(accent)
    if (luminance !== null) {
      tokens['accent-contrast'] = luminance >= 0.5 ? '#0b0d13' : '#ffffff'
    }
  }

  const blur = normalizeBlurValue(tokens.blur)
  const noiseOpacity = normalizeNoiseOpacityValue(tokens['noise-opacity'])
  tokens.blur = blur
  tokens['noise-opacity'] = noiseOpacity
  return tokens
}

export function applyPresetSelection(themeSettings: VaultThemeSettings, presetId: string) {
  const normalized = normalizeThemeSettings(themeSettings)
  if (isBuiltInThemeId(presetId)) {
    return normalizeThemeSettings({
      ...normalized,
      activeBaseThemeId: presetId,
      activeOverrides: {},
      selectedPresetId: presetId,
    })
  }

  const selected = normalized.customPresets.find((preset) => preset.id === presetId)
  if (!selected) {
    return normalized
  }

  return normalizeThemeSettings({
    ...normalized,
    activeBaseThemeId: selected.baseThemeId,
    activeOverrides: selected.overrides,
    selectedPresetId: selected.id,
  })
}

export function upsertCustomThemePreset(themeSettings: VaultThemeSettings, nameInput: string) {
  const normalized = normalizeThemeSettings(themeSettings)
  const name = normalizePresetName(nameInput)
  if (!name) {
    return { themeSettings: normalized, savedPresetId: '' }
  }

  const now = new Date().toISOString()
  const existingByName = normalized.customPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase())
  const nextPreset: ThemeCustomPreset = existingByName
    ? {
        ...existingByName,
        name,
        baseThemeId: normalized.activeBaseThemeId,
        overrides: normalizeThemeTokenOverrides(normalized.activeOverrides),
        updatedAt: now,
      }
    : {
        id: crypto.randomUUID(),
        name,
        baseThemeId: normalized.activeBaseThemeId,
        overrides: normalizeThemeTokenOverrides(normalized.activeOverrides),
        createdAt: now,
        updatedAt: now,
      }

  const withoutExisting = normalized.customPresets.filter((preset) => preset.id !== nextPreset.id && preset.name.toLowerCase() !== name.toLowerCase())
  const nextCustomPresets = [nextPreset, ...withoutExisting].slice(0, MAX_CUSTOM_PRESETS)
  return {
    themeSettings: normalizeThemeSettings({
      ...normalized,
      selectedPresetId: nextPreset.id,
      activeBaseThemeId: nextPreset.baseThemeId,
      activeOverrides: nextPreset.overrides,
      customPresets: nextCustomPresets,
    }),
    savedPresetId: nextPreset.id,
  }
}

export function deleteCustomThemePreset(themeSettings: VaultThemeSettings, presetId: string) {
  const normalized = normalizeThemeSettings(themeSettings)
  const removed = normalized.customPresets.find((preset) => preset.id === presetId)
  if (!removed) return normalized

  const nextCustomPresets = normalized.customPresets.filter((preset) => preset.id !== presetId)
  if (normalized.selectedPresetId !== presetId) {
    return normalizeThemeSettings({
      ...normalized,
      customPresets: nextCustomPresets,
    })
  }

  return normalizeThemeSettings({
    ...normalized,
    customPresets: nextCustomPresets,
    selectedPresetId: removed.baseThemeId,
    activeBaseThemeId: removed.baseThemeId,
    activeOverrides: {},
  })
}

function stableThemeSettingsSnapshot(themeSettings: VaultThemeSettings) {
  const normalized = normalizeThemeSettings(themeSettings)
  const sortedOverrides = Object.fromEntries(
    Object.entries(normalized.activeOverrides).sort(([a], [b]) => a.localeCompare(b)),
  )
  const sortedCustomPresets = normalized.customPresets.map((preset) => ({
    ...preset,
    overrides: Object.fromEntries(
      Object.entries(normalizeThemeTokenOverrides(preset.overrides)).sort(([a], [b]) => a.localeCompare(b)),
    ),
  }))

  return JSON.stringify({
    ...normalized,
    activeOverrides: sortedOverrides,
    customPresets: sortedCustomPresets,
  })
}

export function areThemeSettingsEqual(left: VaultThemeSettings, right: VaultThemeSettings) {
  return stableThemeSettingsSnapshot(left) === stableThemeSettingsSnapshot(right)
}

export function loadThemeSettingsFromMirror() {
  try {
    const raw = localStorage.getItem(THEME_MIRROR_STORAGE_KEY)
    if (!raw) return defaultThemeSettings()
    const parsed = JSON.parse(raw) as ThemeMirrorPayload
    return normalizeThemeSettings(parsed.theme)
  } catch {
    return defaultThemeSettings()
  }
}

export function saveThemeSettingsToMirror(themeSettings: VaultThemeSettings) {
  const payload: ThemeMirrorPayload = { theme: normalizeThemeSettings(themeSettings) }
  localStorage.setItem(THEME_MIRROR_STORAGE_KEY, JSON.stringify(payload))
}
