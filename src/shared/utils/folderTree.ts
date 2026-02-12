import type { VaultFolder } from '../../types/vault'

export function formatFolderPath(folderId: string | null, folderMap: Map<string, VaultFolder>): string {
  if (!folderId) return 'Unfiled'
  const chain: string[] = []
  let current = folderMap.get(folderId) ?? null
  let guard = 0
  while (current && guard < 32) {
    chain.unshift(current.name)
    current = current.parentId ? folderMap.get(current.parentId) ?? null : null
    guard += 1
  }
  return chain.join(' / ') || 'Unfiled'
}

export function collectDescendantIds(folderId: string, folders: VaultFolder[]): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const folder of folders) {
    if (!folder.parentId) continue
    const rows = childrenByParent.get(folder.parentId) ?? []
    rows.push(folder.id)
    childrenByParent.set(folder.parentId, rows)
  }
  const collected: string[] = []
  const queue = [folderId]
  while (queue.length) {
    const current = queue.shift() as string
    collected.push(current)
    for (const childId of childrenByParent.get(current) ?? []) {
      queue.push(childId)
    }
  }
  return collected
}
