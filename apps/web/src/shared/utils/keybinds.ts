import type { VaultKeybindAction, VaultKeybindSettings, VaultKeybindShortcut } from '../../types/vault'

export type KeybindDefinition = {
  id: VaultKeybindAction
  label: string
  description: string
  scope: 'global' | 'item_context_menu'
}

export const KEYBIND_DEFINITIONS: KeybindDefinition[] = [
  {
    id: 'lockVault',
    label: 'Lock Vault',
    description: 'Locks the current vault from anywhere in the workspace.',
    scope: 'global',
  },
  {
    id: 'copyUsername',
    label: 'Copy Username',
    description: 'Copies the selected item username while the item context menu is open.',
    scope: 'item_context_menu',
  },
  {
    id: 'copyPassword',
    label: 'Copy Password',
    description: 'Copies the selected item password while the item context menu is open.',
    scope: 'item_context_menu',
  },
  {
    id: 'autofillItem',
    label: 'Autofill Item',
    description: 'Runs autofill for the selected item while the item context menu is open.',
    scope: 'item_context_menu',
  },
] as const

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift'])

const DEFAULT_KEYBIND_SETTINGS: VaultKeybindSettings = {
  lockVault: { key: 'x', mod: true },
  copyUsername: { key: 'b', mod: true },
  copyPassword: { key: 'c', mod: true },
  autofillItem: { key: 'v', mod: true },
}

const DISPLAY_LABELS: Record<string, string> = {
  ' ': 'Space',
  escape: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  home: 'Home',
  end: 'End',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeShortcutKey(raw: unknown) {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed === ' ') return 'space'
  return trimmed.toLowerCase()
}

function normalizeShortcut(input: unknown) {
  if (input === null) return null
  if (!isRecord(input)) return null
  const key = normalizeShortcutKey(input.key)
  if (!key) return null
  return {
    key,
    mod: input.mod === true,
    alt: input.alt === true,
    shift: input.shift === true,
  } satisfies VaultKeybindShortcut
}

function shortcutFingerprint(shortcut: VaultKeybindShortcut | null) {
  if (!shortcut) return ''
  return [
    shortcut.mod ? 'mod' : '',
    shortcut.alt ? 'alt' : '',
    shortcut.shift ? 'shift' : '',
    shortcut.key,
  ].filter(Boolean).join('+')
}

function cloneShortcut(shortcut: VaultKeybindShortcut | null): VaultKeybindShortcut | null {
  return shortcut ? { ...shortcut } : null
}

export function defaultKeybindSettings(): VaultKeybindSettings {
  return {
    lockVault: cloneShortcut(DEFAULT_KEYBIND_SETTINGS.lockVault),
    copyUsername: cloneShortcut(DEFAULT_KEYBIND_SETTINGS.copyUsername),
    copyPassword: cloneShortcut(DEFAULT_KEYBIND_SETTINGS.copyPassword),
    autofillItem: cloneShortcut(DEFAULT_KEYBIND_SETTINGS.autofillItem),
  }
}

export function normalizeKeybindSettings(input: unknown): VaultKeybindSettings {
  const source = isRecord(input) ? input : {}
  const defaults = defaultKeybindSettings()
  const readShortcut = (action: VaultKeybindAction) => {
    if (!(action in source)) return defaults[action]
    const normalized = normalizeShortcut(source[action])
    return normalized === null && source[action] !== null ? defaults[action] : normalized
  }
  return {
    lockVault: readShortcut('lockVault'),
    copyUsername: readShortcut('copyUsername'),
    copyPassword: readShortcut('copyPassword'),
    autofillItem: readShortcut('autofillItem'),
  }
}

export function isApplePlatform() {
  const platform = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform) || navigator.platform || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

export function formatShortcutLabel(shortcut: VaultKeybindShortcut | null, applePlatform = isApplePlatform()) {
  if (!shortcut) return 'Disabled'
  const segments: string[] = []
  if (shortcut.mod) segments.push(applePlatform ? 'Cmd' : 'Ctrl')
  if (shortcut.alt) segments.push(applePlatform ? 'Option' : 'Alt')
  if (shortcut.shift) segments.push('Shift')

  const keyLabel = DISPLAY_LABELS[shortcut.key] ?? (
    shortcut.key.length === 1
      ? shortcut.key.toUpperCase()
      : shortcut.key
          .split(/[\s_-]+/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ')
  )
  segments.push(keyLabel)
  return segments.join('+')
}

export function matchShortcut(event: KeyboardEvent, shortcut: VaultKeybindShortcut | null) {
  if (!shortcut) return false
  const normalizedEventKey = normalizeShortcutKey(event.key)
  if (!normalizedEventKey) return false
  const modPressed = event.ctrlKey || event.metaKey
  return (
    normalizedEventKey === shortcut.key
    && modPressed === (shortcut.mod === true)
    && event.altKey === (shortcut.alt === true)
    && event.shiftKey === (shortcut.shift === true)
  )
}

export function eventToShortcut(event: KeyboardEvent): VaultKeybindShortcut | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const key = normalizeShortcutKey(event.key)
  if (!key) return null
  return {
    key,
    mod: event.ctrlKey || event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  }
}

export function findKeybindConflicts(settings: VaultKeybindSettings) {
  const conflicts = new Map<VaultKeybindAction, VaultKeybindAction[]>()
  const owners = new Map<string, VaultKeybindAction[]>()

  for (const definition of KEYBIND_DEFINITIONS) {
    const fingerprint = shortcutFingerprint(settings[definition.id])
    if (!fingerprint) continue
    const entries = owners.get(fingerprint) ?? []
    entries.push(definition.id)
    owners.set(fingerprint, entries)
  }

  for (const definition of KEYBIND_DEFINITIONS) {
    const fingerprint = shortcutFingerprint(settings[definition.id])
    const duplicates = fingerprint ? (owners.get(fingerprint) ?? []).filter((id) => id !== definition.id) : []
    if (duplicates.length > 0) {
      conflicts.set(definition.id, duplicates)
    }
  }

  return conflicts
}
