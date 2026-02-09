import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const getUserProfile = query({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    // tokenIdentifier format is "issuer|userId" — extract the userId part
    const parts = args.tokenIdentifier.split('|')
    const rawId = parts.length > 1 ? parts[parts.length - 1] : parts[0]

    try {
      const user = await ctx.db.get(rawId as any)
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
