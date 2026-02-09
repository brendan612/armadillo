const OWNER_KEY = 'armadillo.owner_hint'

function normalizeOwnerHint(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64)
}

export function getOwnerHint() {
  const existing = window.localStorage.getItem(OWNER_KEY)
  if (existing) {
    return existing
  }

  const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`
  const generated = `device_${normalizeOwnerHint(raw)}`
  window.localStorage.setItem(OWNER_KEY, generated)
  return generated
}
