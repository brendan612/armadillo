import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'

export default defineSchema({
  ...authTables,
  vaultSnapshots: defineTable({
    ownerId: v.string(),
    vaultId: v.string(),
    revision: v.number(),
    encryptedFile: v.string(),
    updatedAt: v.string(),
  })
    .index('by_owner_vault', ['ownerId', 'vaultId'])
    .index('by_owner', ['ownerId']),
})
