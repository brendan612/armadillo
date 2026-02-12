export function generatePassword(length: number, includeSymbols: boolean, excludeAmbiguous: boolean) {
  const chars = `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789${includeSymbols ? '!@#$%^&*()-_=+[]{}' : ''}`
  const safeChars = excludeAmbiguous ? chars.replace(/[O0Il|`~]/g, '') : chars
  const randomBytes = new Uint8Array(length)
  crypto.getRandomValues(randomBytes)
  return Array.from(randomBytes, (byte) => safeChars[byte % safeChars.length]).join('')
}
