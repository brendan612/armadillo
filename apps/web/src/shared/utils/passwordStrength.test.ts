/// <reference types="node" />

import test from 'node:test'
import assert from 'node:assert/strict'
import type { VaultItem } from '../../types/vault.ts'
import { computePasswordReuseCounts, recomputeItemRisks } from './passwordStrength.ts'

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

test('computePasswordReuseCounts ignores non-password credential kinds', () => {
  const counts = computePasswordReuseCounts([
    buildItem({ id: 'password', credentialKind: 'password', passwordMasked: 'shared' }),
    buildItem({ id: 'pin', credentialKind: 'pin', passwordMasked: 'shared' }),
    buildItem({ id: 'secret', credentialKind: 'secret', passwordMasked: 'shared' }),
  ])

  assert.equal(counts.get('shared'), 1)
})

test('recomputeItemRisks resets non-password credentials to safe', () => {
  const { nextItems } = recomputeItemRisks([
    buildItem({
      id: 'pin',
      credentialKind: 'pin',
      passwordMasked: '1234',
      risk: 'weak',
      passwordExpiryDate: '2026-04-01',
    }),
  ])

  assert.equal(nextItems[0]?.risk, 'safe')
  assert.equal(nextItems[0]?.passwordExpiryDate, null)
})
