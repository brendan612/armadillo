import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { v } from 'convex/values'

const DEFAULT_MAX_BLOB_FILE_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_BLOB_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

export const getUserProfile = query({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    // tokenIdentifier format is usually "issuer|userId|sessionId".
    // Extract userId (the 2nd segment), not the sessionId.
    const parts = args.tokenIdentifier.split('|')
    const rawId = parts.length >= 2 ? parts[1] : parts[0]

    try {
      const user = await ctx.db.get(rawId as Id<'users'>)
      if (!user) return null
      return {
        email: user.email ?? null,
        name: user.name ?? null,
      }
    } catch {
      return null
    }
  },
})

export const pullByOwner = query({
  args: {
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const snapshots = await ctx.db
      .query('vaultSnapshots')
      .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
      .collect()

    if (snapshots.length === 0) {
      return null
    }

    // Return the most recently updated vault
    const latest = snapshots.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))[0]
    return {
      revision: latest.revision,
      encryptedFile: latest.encryptedFile,
      updatedAt: latest.updatedAt,
    }
  },
})

export const listByOwner = query({
  args: {
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('vaultSnapshots')
      .withIndex('by_owner', (q) => q.eq('ownerId', args.ownerId))
      .collect()
  },
})

export const pullByLegacyUserPrefix = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Legacy owner IDs were stored as user:<userId>|<sessionId>.
    const prefix = `user:${args.userId}|`
    const snapshots = await ctx.db.query('vaultSnapshots').collect()
    const legacyMatches = snapshots.filter((snapshot) => snapshot.ownerId.startsWith(prefix))

    if (legacyMatches.length === 0) {
      return null
    }

    const latest = legacyMatches.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))[0]
    return {
      revision: latest.revision,
      encryptedFile: latest.encryptedFile,
      updatedAt: latest.updatedAt,
    }
  },
})

export const listByLegacyUserPrefix = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Legacy owner IDs were stored as user:<userId>|<sessionId>.
    const prefix = `user:${args.userId}|`
    const snapshots = await ctx.db.query('vaultSnapshots').collect()
    return snapshots.filter((snapshot) => snapshot.ownerId.startsWith(prefix))
  },
})

export const pullByOwnerVault = query({
  args: {
    ownerId: v.string(),
    vaultId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('vaultSnapshots')
      .withIndex('by_owner_vault', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId))
      .unique()

    if (!existing) {
      return null
    }

    return {
      revision: existing.revision,
      encryptedFile: existing.encryptedFile,
      updatedAt: existing.updatedAt,
    }
  },
})

export const pushByOwnerVault = mutation({
  args: {
    ownerId: v.string(),
    vaultId: v.string(),
    revision: v.number(),
    encryptedFile: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('vaultSnapshots')
      .withIndex('by_owner_vault', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId))
      .unique()

    if (!existing) {
      await ctx.db.insert('vaultSnapshots', {
        ownerId: args.ownerId,
        vaultId: args.vaultId,
        revision: args.revision,
        encryptedFile: args.encryptedFile,
        updatedAt: args.updatedAt,
      })
      return { accepted: true }
    }

    if (args.revision <= existing.revision) {
      return { accepted: false }
    }

    await ctx.db.patch(existing._id, {
      revision: args.revision,
      encryptedFile: args.encryptedFile,
      updatedAt: args.updatedAt,
    })

    return { accepted: true }
  },
})

export const getBlobByOwnerVault = query({
  args: {
    ownerId: v.string(),
    vaultId: v.string(),
    blobId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('vaultBlobs')
      .withIndex('by_owner_vault_blob', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId).eq('blobId', args.blobId))
      .unique()
    if (!existing) return null
    return {
      blobId: existing.blobId,
      vaultId: existing.vaultId,
      nonce: existing.nonce,
      ciphertext: existing.ciphertext,
      sizeBytes: existing.sizeBytes,
      sha256: existing.sha256,
      mimeType: existing.mimeType,
      fileName: existing.fileName,
      updatedAt: existing.updatedAt,
    }
  },
})

export const listBlobByOwnerVault = query({
  args: {
    ownerId: v.string(),
    vaultId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('vaultBlobs')
      .withIndex('by_owner_vault_blobs', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId))
      .collect()
  },
})

export const putBlobByOwnerVault = mutation({
  args: {
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
    maxFileBytes: v.optional(v.number()),
    maxVaultBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxFileBytes = args.maxFileBytes ?? DEFAULT_MAX_BLOB_FILE_BYTES
    const maxVaultBytes = args.maxVaultBytes ?? DEFAULT_MAX_BLOB_TOTAL_BYTES
    if (args.sizeBytes <= 0 || args.sizeBytes > maxFileBytes) {
      throw new Error(`Blob exceeds file limit (${maxFileBytes})`)
    }

    const existing = await ctx.db
      .query('vaultBlobs')
      .withIndex('by_owner_vault_blob', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId).eq('blobId', args.blobId))
      .unique()

    const rows = await ctx.db
      .query('vaultBlobs')
      .withIndex('by_owner_vault_blobs', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId))
      .collect()
    const usageWithoutCurrent = rows.reduce((total, row) => (
      row.blobId === args.blobId ? total : total + Math.max(0, row.sizeBytes)
    ), 0)
    if (usageWithoutCurrent + args.sizeBytes > maxVaultBytes) {
      throw new Error(`Vault blob quota exceeded (${maxVaultBytes})`)
    }

    if (!existing) {
      await ctx.db.insert('vaultBlobs', {
        ownerId: args.ownerId,
        vaultId: args.vaultId,
        blobId: args.blobId,
        nonce: args.nonce,
        ciphertext: args.ciphertext,
        sizeBytes: args.sizeBytes,
        sha256: args.sha256,
        mimeType: args.mimeType,
        fileName: args.fileName,
        updatedAt: args.updatedAt,
      })
      return { accepted: true, usedBytes: usageWithoutCurrent + args.sizeBytes }
    }

    await ctx.db.patch(existing._id, {
      nonce: args.nonce,
      ciphertext: args.ciphertext,
      sizeBytes: args.sizeBytes,
      sha256: args.sha256,
      mimeType: args.mimeType,
      fileName: args.fileName,
      updatedAt: args.updatedAt,
    })
    return { accepted: true, usedBytes: usageWithoutCurrent + args.sizeBytes }
  },
})

export const deleteBlobByOwnerVault = mutation({
  args: {
    ownerId: v.string(),
    vaultId: v.string(),
    blobId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('vaultBlobs')
      .withIndex('by_owner_vault_blob', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId).eq('blobId', args.blobId))
      .unique()
    if (!existing) {
      const rows = await ctx.db
        .query('vaultBlobs')
        .withIndex('by_owner_vault_blobs', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId))
        .collect()
      const usedBytes = rows.reduce((total, row) => total + Math.max(0, row.sizeBytes), 0)
      return { deleted: false, usedBytes }
    }
    await ctx.db.delete(existing._id)
    const rows = await ctx.db
      .query('vaultBlobs')
      .withIndex('by_owner_vault_blobs', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId))
      .collect()
    const usedBytes = rows.reduce((total, row) => total + Math.max(0, row.sizeBytes), 0)
    return { deleted: true, usedBytes }
  },
})

