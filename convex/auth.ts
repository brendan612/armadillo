import Google from '@auth/core/providers/google'
import { convexAuth } from '@convex-dev/auth/server'

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [Google],
  callbacks: {
    async redirect({ redirectTo }) {
      if (redirectTo.startsWith('armadillo://')) {
        return redirectTo
      }
      if (redirectTo.startsWith('http://127.0.0.1:') || redirectTo.startsWith('http://localhost:')) {
        return redirectTo
      }
      // Allow private network IPs (for dev access from phones / other LAN devices)
      if (/^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(redirectTo)) {
        return redirectTo
      }
      const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '')

      if (redirectTo.startsWith('?') || redirectTo.startsWith('/')) {
        return `${siteUrl}${redirectTo}`
      }

      if (siteUrl && redirectTo.startsWith(siteUrl)) {
        return redirectTo
      }

      throw new Error(`Invalid redirectTo: ${redirectTo}`)
    },
  },
})
