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
  vaultBlobs: defineTable({
    ownerId: v.string(),
    vaultId: v.string(),
    blobId: v.string(),
    nonce: v.string(),
    ciphertext: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    mimeType: v.string(),
    fileName: v.string(),
    updatedAt: v.string(),
  })
    .index('by_owner_vault_blob', ['ownerId', 'vaultId', 'blobId'])
    .index('by_owner_vault_blobs', ['ownerId', 'vaultId']),
})
