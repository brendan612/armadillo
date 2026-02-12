import type { VaultItem } from '../../types/vault'

export function buildEmptyItem(
  folderName = '',
  categoryName = '',
  folderId: string | null = null,
  categoryId: string | null = null,
): VaultItem {
  return {
    id: crypto.randomUUID(),
    title: 'New Credential',
    username: '',
    passwordMasked: '',
    urls: [],
    category: categoryName,
    folder: folderName,
    categoryId,
    folderId,
    tags: [],
    risk: 'safe',
    updatedAt: new Date().toLocaleString(),
    note: '',
    securityQuestions: [],
  }
}
