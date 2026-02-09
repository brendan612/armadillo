import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  vaultItems: defineTable({
    ownerId: v.string(),
    itemId: v.string(),
    title: v.string(),
    username: v.string(),
    passwordMasked: v.string(),
    urls: v.array(v.string()),
    category: v.string(),
    folder: v.string(),
    tags: v.array(v.string()),
    risk: v.union(v.literal('safe'), v.literal('weak'), v.literal('reused'), v.literal('exposed'), v.literal('stale')),
    updatedAt: v.string(),
    note: v.string(),
    securityQuestions: v.array(
      v.object({
        question: v.string(),
        answer: v.string(),
      }),
    ),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_item', ['ownerId', 'itemId']),
})
