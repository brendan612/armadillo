import { ConvexReactClient } from 'convex/react'

export const convexUrl = import.meta.env.VITE_CONVEX_URL || ''
export const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null

export function convexAuthStorageNamespace() {
  const address = ((convexClient as any)?.address as string | undefined) || convexUrl
  return address.replace(/[^a-zA-Z0-9]/g, '')
}

export function convexAuthStorageNamespaces() {
  const values = new Set<string>()
  const add = (value?: string) => {
    if (!value) return
    values.add(value.replace(/[^a-zA-Z0-9]/g, ''))
  }

  add(((convexClient as any)?.address as string | undefined) || '')
  add(convexUrl)
  add(convexUrl.replace(/\/$/, ''))
  add(`${convexUrl.replace(/\/$/, '')}/`)

  return Array.from(values).filter(Boolean)
}
