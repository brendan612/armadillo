const OWNER_KEY = 'armadillo.owner_hint'
const OWNER_MODE_KEY = 'armadillo.owner_mode'

type OwnerMode = 'anonymous' | 'passkey'

function normalizeOwnerHint(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64)
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const value of bytes) {
    binary += String.fromCharCode(value)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

export function getOwnerHint() {
  const existing = window.localStorage.getItem(OWNER_KEY)
  if (existing) {
    return existing
  }

  const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`
  const generated = `device_${normalizeOwnerHint(raw)}`
  window.localStorage.setItem(OWNER_KEY, generated)
  window.localStorage.setItem(OWNER_MODE_KEY, 'anonymous')
  return generated
}

export function getOwnerMode(): OwnerMode {
  return (window.localStorage.getItem(OWNER_MODE_KEY) as OwnerMode) || 'anonymous'
}

export async function bindPasskeyOwner() {
  if (!('credentials' in navigator) || !window.PublicKeyCredential) {
    throw new Error('Passkeys are not supported on this device/browser')
  }

  const challenge = randomBytes(32)
  const userId = randomBytes(16)

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: 'Armadillo',
      },
      user: {
        id: userId,
        name: 'armadillo-user',
        displayName: 'Armadillo User',
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Failed to create passkey credential')
  }

  const id = `passkey_${toBase64Url(new Uint8Array(credential.rawId))}`
  window.localStorage.setItem(OWNER_KEY, id)
  window.localStorage.setItem(OWNER_MODE_KEY, 'passkey')
  return id
}
