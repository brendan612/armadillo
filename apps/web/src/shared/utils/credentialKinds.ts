import type { VaultCredentialKind, VaultItem } from '../../types/vault'

export const DEFAULT_CREDENTIAL_KIND: VaultCredentialKind = 'password'

export type CredentialKindMeta = {
  label: string
  shortLabel: string
  valueLabel: string
  usernameLabel: string
  usernamePlaceholder: string
  copyLabel: string
  copySuccessMessage: string
  emptyValueLabel: string
  defaultTitle: string
}

const credentialKindMeta: Record<VaultCredentialKind, CredentialKindMeta> = {
  password: {
    label: 'Password',
    shortLabel: 'Password',
    valueLabel: 'Password',
    usernameLabel: 'Username',
    usernamePlaceholder: 'name@example.com',
    copyLabel: 'Copy Password',
    copySuccessMessage: 'Password copied to clipboard',
    emptyValueLabel: 'No password',
    defaultTitle: 'New Credential',
  },
  pin: {
    label: 'PIN',
    shortLabel: 'PIN',
    valueLabel: 'PIN',
    usernameLabel: 'Label / Username',
    usernamePlaceholder: 'ATM card, voicemail, building entry...',
    copyLabel: 'Copy PIN',
    copySuccessMessage: 'PIN copied to clipboard',
    emptyValueLabel: 'No PIN',
    defaultTitle: 'New PIN',
  },
  secret: {
    label: 'Secret',
    shortLabel: 'Secret',
    valueLabel: 'Secret',
    usernameLabel: 'Label / Username',
    usernamePlaceholder: 'API user, account label, service name...',
    copyLabel: 'Copy Secret',
    copySuccessMessage: 'Secret copied to clipboard',
    emptyValueLabel: 'No secret',
    defaultTitle: 'New Secret',
  },
  number: {
    label: 'Secure Number',
    shortLabel: 'Number',
    valueLabel: 'Secure Number',
    usernameLabel: 'Label / Username',
    usernamePlaceholder: 'Account label, card label, reference...',
    copyLabel: 'Copy Number',
    copySuccessMessage: 'Number copied to clipboard',
    emptyValueLabel: 'No number',
    defaultTitle: 'New Secure Number',
  },
}

export function normalizeCredentialKind(input: unknown): VaultCredentialKind {
  if (input === 'pin' || input === 'secret' || input === 'number') {
    return input
  }
  return DEFAULT_CREDENTIAL_KIND
}

export function getCredentialKindMeta(kind: VaultCredentialKind | null | undefined) {
  return credentialKindMeta[normalizeCredentialKind(kind)]
}

export function isPasswordCredentialKind(kind: VaultCredentialKind | null | undefined) {
  return normalizeCredentialKind(kind) === 'password'
}

export function isPasswordCredential(item: Pick<VaultItem, 'credentialKind'>) {
  return isPasswordCredentialKind(item.credentialKind)
}
