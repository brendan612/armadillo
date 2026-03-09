import type { VaultItem } from '../../types/vault'
import { DEFAULT_CREDENTIAL_KIND, getCredentialKindMeta, type CredentialKindMeta } from './credentialKinds.ts'

export function buildEmptyItem(
  folderName = '',
  folderId: string | null = null,
  kind = DEFAULT_CREDENTIAL_KIND,
): VaultItem {
  const kindMeta: CredentialKindMeta = getCredentialKindMeta(kind)
  return {
    id: crypto.randomUUID(),
    title: kindMeta.defaultTitle,
    credentialKind: kind,
    username: '',
    passwordMasked: '',
    urls: [],
    linkedAndroidPackages: [],
    folder: folderName,
    folderId,
    tags: [],
    risk: 'safe',
    updatedAt: new Date().toLocaleString(),
    note: '',
    securityQuestions: [],
    passwordExpiryDate: null,
    excludeFromCloudSync: false,
  }
}
