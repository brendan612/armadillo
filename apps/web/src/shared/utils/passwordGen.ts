export type GeneratorConfig = {
  length: number
  uppercase: boolean
  lowercase: boolean
  digits: boolean
  symbols: boolean
}

export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
}

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?'

export function generatePassword(config: GeneratorConfig): string {
  let pool = ''
  if (config.uppercase) pool += UPPERCASE
  if (config.lowercase) pool += LOWERCASE
  if (config.digits) pool += DIGITS
  if (config.symbols) pool += SYMBOLS

  // Fallback if nothing selected
  if (pool.length === 0) {
    pool = LOWERCASE + DIGITS
  }

  const length = Math.max(4, Math.min(256, config.length))
  const randomBytes = new Uint8Array(length)
  crypto.getRandomValues(randomBytes)
  return Array.from(randomBytes, (byte) => pool[byte % pool.length]).join('')
}
