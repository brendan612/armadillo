import type { VaultItem } from '../../types/vault'

export function buildEmptyItem(
  folderName = '',
  folderId: string | null = null,
): VaultItem {
  return {
    id: crypto.randomUUID(),
    title: 'New Credential',
    username: '',
    passwordMasked: '',
    urls: [],
    folder: folderName,
    folderId,
    tags: [],
    risk: 'safe',
    updatedAt: new Date().toLocaleString(),
    note: '',
    securityQuestions: [],
  }
}
