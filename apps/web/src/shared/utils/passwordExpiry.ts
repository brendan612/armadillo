export type PasswordExpiryStatus = 'expired' | 'expiring' | 'healthy' | 'none'

type PasswordExpiryStatusOptions = {
  now?: Date
  expiringWithinDays?: number
}

export function getPasswordExpiryStatus(
  passwordExpiryDate: string | null | undefined,
  options: PasswordExpiryStatusOptions = {},
): PasswordExpiryStatus {
  if (!passwordExpiryDate) return 'none'

  const expiry = new Date(passwordExpiryDate)
  if (isNaN(expiry.getTime())) return 'none'

  const expiringWithinDays = Math.max(1, Math.round(options.expiringWithinDays ?? 7))
  const now = options.now ? new Date(options.now) : new Date()
  now.setHours(0, 0, 0, 0)
  expiry.setHours(0, 0, 0, 0)

  if (expiry <= now) return 'expired'

  const soon = new Date(now)
  soon.setDate(soon.getDate() + expiringWithinDays)
  if (expiry <= soon) return 'expiring'

  return 'healthy'
}
