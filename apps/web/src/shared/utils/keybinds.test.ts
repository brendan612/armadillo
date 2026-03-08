import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultKeybindSettings, findKeybindConflicts, formatShortcutLabel, normalizeKeybindSettings } from './keybinds.ts'

test('normalizeKeybindSettings falls back to defaults for invalid values', () => {
  const normalized = normalizeKeybindSettings({
    lockVault: { key: 'l', mod: true },
    copyUsername: { key: '' },
    copyPassword: { nope: true },
  })

  assert.deepEqual(normalized.lockVault, { key: 'l', mod: true, alt: false, shift: false })
  assert.deepEqual(normalized.copyUsername, defaultKeybindSettings().copyUsername)
  assert.deepEqual(normalized.copyPassword, defaultKeybindSettings().copyPassword)
  assert.deepEqual(normalized.autofillItem, defaultKeybindSettings().autofillItem)
})

test('findKeybindConflicts reports duplicate assignments', () => {
  const settings = defaultKeybindSettings()
  settings.copyPassword = { key: 'b', mod: true }

  const conflicts = findKeybindConflicts(settings)

  assert.deepEqual(conflicts.get('copyUsername'), ['copyPassword'])
  assert.deepEqual(conflicts.get('copyPassword'), ['copyUsername'])
  assert.equal(conflicts.has('lockVault'), false)
})

test('normalizeKeybindSettings preserves explicit null values as disabled shortcuts', () => {
  const normalized = normalizeKeybindSettings({
    lockVault: null,
  })

  assert.equal(normalized.lockVault, null)
  assert.deepEqual(normalized.copyUsername, defaultKeybindSettings().copyUsername)
})

test('formatShortcutLabel uses platform-aware modifier names', () => {
  const shortcut = { key: 'k', mod: true, alt: true, shift: true }

  assert.equal(formatShortcutLabel(shortcut, false), 'Ctrl+Alt+Shift+K')
  assert.equal(formatShortcutLabel(shortcut, true), 'Cmd+Option+Shift+K')
})
