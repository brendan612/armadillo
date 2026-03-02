import { ConvexReactClient } from 'convex/react'

export const convexUrl = import.meta.env.VITE_CONVEX_URL || ''
const fallbackConvexUrl = 'https://placeholder.convex.cloud'
export const convexClient = new ConvexReactClient(convexUrl || fallbackConvexUrl)
