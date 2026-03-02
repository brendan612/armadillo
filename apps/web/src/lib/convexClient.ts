import { ConvexReactClient } from 'convex/react'

export const convexUrl = import.meta.env.VITE_CONVEX_URL || ''
export const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null
type ConvexClientWithAddress = { address?: string }

export function convexAuthStorageNamespace() {
  const address = (convexClient as unknown as ConvexClientWithAddress | null)?.address || convexUrl
  return address.replace(/[^a-zA-Z0-9]/g, '')
}

export function convexAuthStorageNamespaces() {
  const values = new Set<string>()
  const add = (value?: string) => {
    if (!value) return
    values.add(value.replace(/[^a-zA-Z0-9]/g, ''))
  }

  add((convexClient as unknown as ConvexClientWithAddress | null)?.address || '')
  add(convexUrl)
  add(convexUrl.replace(/\/$/, ''))
  add(`${convexUrl.replace(/\/$/, '')}/`)

  return Array.from(values).filter(Boolean)
}
