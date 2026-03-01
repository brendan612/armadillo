const HIBP_RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range/'
const DEFAULT_TIMEOUT_MS = 3500
const PREFIX_LENGTH = 5
const encoder = new TextEncoder()

export type BreachCheckStatus = 'compromised' | 'clear' | 'unavailable'

export type BreachCheckResult = {
  status: BreachCheckStatus
  count?: number
  checkedAt: string
}

export type BreachScanResult = {
  status: BreachCheckStatus
  count?: number
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function sanitizeTimeout(timeoutMs: number | undefined) {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS
  return Math.min(15000, Math.max(500, Math.round(timeoutMs as number)))
}

function parseRangeResponse(body: string) {
  const suffixCounts = new Map<string, number>()
  const lines = body.split(/\r?\n/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [suffix, countRaw] = trimmed.split(':')
    if (!suffix || !countRaw) continue
    const normalizedSuffix = suffix.trim().toUpperCase()
    if (!/^[A-F0-9]{35}$/.test(normalizedSuffix)) continue
    const count = Number.parseInt(countRaw.trim(), 10)
    if (!Number.isFinite(count) || count < 0) continue
    suffixCounts.set(normalizedSuffix, count)
  }
  return suffixCounts
}

function requireSubtleCrypto() {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('crypto.subtle is unavailable')
  }
  return crypto.subtle
}

async function fetchRange(prefix: string, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${HIBP_RANGE_ENDPOINT}${prefix}`, {
      method: 'GET',
      headers: {
        'Add-Padding': 'true',
      },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return parseRangeResponse(await response.text())
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function hashPassword(password: string) {
  const digest = await requireSubtleCrypto().digest('SHA-1', encoder.encode(password))
  const hashHex = bytesToHex(new Uint8Array(digest))
  const prefix = hashHex.slice(0, PREFIX_LENGTH)
  const suffix = hashHex.slice(PREFIX_LENGTH)
  return { prefix, suffix }
}

export async function checkPasswordCompromised(password: string, options?: { timeoutMs?: number }): Promise<BreachCheckResult> {
  const checkedAt = new Date().toISOString()
  if (!password) {
    return { status: 'clear', checkedAt }
  }

  let prefix = ''
  let suffix = ''
  try {
    const hashed = await hashPassword(password)
    prefix = hashed.prefix
    suffix = hashed.suffix
  } catch {
    return { status: 'unavailable', checkedAt }
  }
  const suffixCounts = await fetchRange(prefix, sanitizeTimeout(options?.timeoutMs))
  if (!suffixCounts) {
    return { status: 'unavailable', checkedAt }
  }

  const count = suffixCounts.get(suffix)
  if (typeof count === 'number' && count > 0) {
    return { status: 'compromised', count, checkedAt }
  }
  return { status: 'clear', checkedAt }
}

export async function scanPasswords(
  passwords: string[],
  options?: { timeoutMs?: number; onProgress?: (done: number, total: number) => void },
): Promise<Map<string, BreachScanResult>> {
  const timeoutMs = sanitizeTimeout(options?.timeoutMs)
  const uniquePasswords = Array.from(new Set(passwords.filter((password) => password.length > 0)))
  const total = uniquePasswords.length
  const results = new Map<string, BreachScanResult>()
  options?.onProgress?.(0, total)

  let done = 0
  for (const password of uniquePasswords) {
    const checked = await checkPasswordCompromised(password, { timeoutMs })
    results.set(password, checked.status === 'compromised'
      ? { status: checked.status, count: checked.count }
      : { status: checked.status })
    done += 1
    options?.onProgress?.(done, total)
  }

  return results
}
