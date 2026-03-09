/// <reference types="node" />

import test from 'node:test'
import assert from 'node:assert/strict'
import { AI_EXCLUDED_FIELD_LABELS, buildCopilotModel, buildItemAiInputSnapshot, defaultAiSettings } from './copilot.ts'
import type { VaultItem } from '../../types/vault.ts'

function buildItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? 'New Credential',
    credentialKind: overrides.credentialKind ?? 'password',
    username: overrides.username ?? '',
    passwordMasked: overrides.passwordMasked ?? '',
    urls: overrides.urls ?? [],
    linkedAndroidPackages: overrides.linkedAndroidPackages ?? [],
    folder: overrides.folder ?? '',
    folderId: overrides.folderId ?? null,
    tags: overrides.tags ?? [],
    risk: overrides.risk ?? 'safe',
    updatedAt: overrides.updatedAt ?? new Date('2025-01-01T00:00:00.000Z').toISOString(),
    note: overrides.note ?? '',
    securityQuestions: overrides.securityQuestions ?? [],
    passwordExpiryDate: overrides.passwordExpiryDate ?? null,
    excludeFromCloudSync: overrides.excludeFromCloudSync ?? false,
  }
}

test('buildItemAiInputSnapshot excludes secret fields by default', () => {
  const input = buildItemAiInputSnapshot(buildItem({
    title: 'GitHub',
    username: 'bren',
    passwordMasked: 'SuperSecret123!',
    urls: ['https://github.com/login'],
    note: 'top secret',
    securityQuestions: [{ question: 'Pet', answer: 'Otter' }],
  }))

  assert.equal(input.title, 'GitHub')
  assert.equal(input.username, 'bren')
  assert.deepEqual(input.urlHosts, ['github.com'])
  assert.equal('passwordMasked' in input, false)
  assert.equal('note' in input, false)
  assert.equal('securityQuestions' in input, false)
})

test('excluded AI fields explicitly call out secrets and recovery material', () => {
  assert.ok(AI_EXCLUDED_FIELD_LABELS.includes('password value'))
  assert.ok(AI_EXCLUDED_FIELD_LABELS.includes('secure note contents'))
  assert.ok(AI_EXCLUDED_FIELD_LABELS.includes('security question answers'))
  assert.ok(AI_EXCLUDED_FIELD_LABELS.includes('wrapped vault keys'))
})

test('buildCopilotModel surfaces reused and weak password actions', () => {
  const sharedPassword = 'repeat-password'
  const items = [
    buildItem({
      id: 'one',
      title: 'GitHub',
      username: 'bren',
      urls: ['https://github.com'],
      passwordMasked: sharedPassword,
      risk: 'reused',
    }),
    buildItem({
      id: 'two',
      title: 'GitHub Copy',
      username: 'bren',
      urls: ['https://github.com/login'],
      passwordMasked: sharedPassword,
      risk: 'reused',
    }),
    buildItem({
      id: 'three',
      title: 'Old Forum',
      username: 'bren',
      urls: ['https://forum.example.com'],
      passwordMasked: 'password123',
      risk: 'weak',
    }),
  ]

  const model = buildCopilotModel({
    items,
    folders: [],
    folderPathById: new Map(),
    aiSettings: defaultAiSettings(),
    now: new Date('2026-03-01T00:00:00.000Z'),
  })

  assert.ok(model.vaultSuggestions.some((suggestion) => suggestion.kind === 'review_reused_password'))
  assert.ok(model.vaultSuggestions.some((suggestion) => suggestion.kind === 'review_weak_password'))
  assert.ok((model.itemSuggestionsById.get('one') ?? []).some((suggestion) => suggestion.kind === 'rotate_password'))
  assert.ok((model.itemSuggestionsById.get('three') ?? []).some((suggestion) => suggestion.kind === 'review_weak_password'))
})

test('buildCopilotModel surfaces stale, folder, tag, title, and duplicate cleanup suggestions', () => {
  const items = [
    buildItem({
      id: 'import-one',
      title: 'New Credential',
      username: 'bren',
      urls: ['https://linear.app/login'],
      updatedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    }),
    buildItem({
      id: 'import-two',
      title: 'Linear',
      username: 'bren',
      urls: ['https://linear.app/settings'],
      updatedAt: new Date('2025-01-05T00:00:00.000Z').toISOString(),
    }),
  ]

  const model = buildCopilotModel({
    items,
    folders: [],
    folderPathById: new Map(),
    aiSettings: defaultAiSettings(),
    now: new Date('2026-03-01T00:00:00.000Z'),
  })

  const importOneSuggestions = model.itemSuggestionsById.get('import-one') ?? []
  assert.ok(importOneSuggestions.some((suggestion) => suggestion.kind === 'review_stale_entry'))
  assert.ok(importOneSuggestions.some((suggestion) => suggestion.kind === 'move_to_folder'))
  assert.ok(importOneSuggestions.some((suggestion) => suggestion.kind === 'add_tags'))
  assert.ok(importOneSuggestions.some((suggestion) => suggestion.kind === 'normalize_title'))
  assert.ok(importOneSuggestions.some((suggestion) => suggestion.kind === 'review_duplicates'))
})

test('buildCopilotModel returns no suggestions when AI is disabled', () => {
  const model = buildCopilotModel({
    items: [buildItem({ title: 'New Credential', urls: ['https://github.com'] })],
    folders: [],
    folderPathById: new Map(),
    aiSettings: { ...defaultAiSettings(), enabled: false },
  })

  assert.equal(model.vaultSuggestions.length, 0)
  assert.equal(model.itemSuggestionsById.size, 0)
  assert.equal(model.aiInputsByItemId.size, 1)
})

test('buildCopilotModel ignores non-password credentials for password-specific suggestions', () => {
  const items = [
    buildItem({
      id: 'pin-one',
      credentialKind: 'pin',
      title: 'Debit Card PIN',
      passwordMasked: '1234',
      risk: 'weak',
    }),
    buildItem({
      id: 'secret-one',
      credentialKind: 'secret',
      title: 'API Secret',
      passwordMasked: 'repeat-me',
      risk: 'reused',
    }),
    buildItem({
      id: 'password-one',
      credentialKind: 'password',
      title: 'GitHub',
      passwordMasked: 'repeat-me',
      risk: 'reused',
    }),
    buildItem({
      id: 'password-two',
      credentialKind: 'password',
      title: 'GitLab',
      passwordMasked: 'repeat-me',
      risk: 'reused',
    }),
  ]

  const model = buildCopilotModel({
    items,
    folders: [],
    folderPathById: new Map(),
    aiSettings: defaultAiSettings(),
  })

  assert.equal((model.itemSuggestionsById.get('pin-one') ?? []).some((suggestion) => suggestion.kind === 'review_weak_password'), false)
  assert.equal((model.itemSuggestionsById.get('secret-one') ?? []).some((suggestion) => suggestion.kind === 'review_reused_password'), false)
  assert.ok((model.itemSuggestionsById.get('password-one') ?? []).some((suggestion) => suggestion.kind === 'review_reused_password'))
})
