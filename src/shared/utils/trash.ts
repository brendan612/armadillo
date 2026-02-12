import type { VaultTrashEntry } from '../../types/vault'

export function purgeExpiredTrash(entries: VaultTrashEntry[]) {
  const now = Date.now()
  return entries.filter((entry) => {
    const parsed = Date.parse(entry.purgeAt)
    if (!Number.isFinite(parsed)) return true
    return parsed > now
  })
}

export function getSafeRetentionDays(value: number) {
  if (!Number.isFinite(value)) return 30
  return Math.min(3650, Math.max(1, Math.round(value)))
}
