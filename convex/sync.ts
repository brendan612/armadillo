import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

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
