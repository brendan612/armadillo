import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const riskValidator = v.union(
  v.literal('safe'),
  v.literal('weak'),
  v.literal('reused'),
  v.literal('exposed'),
  v.literal('stale'),
)

const securityQuestionValidator = v.object({
  question: v.string(),
  answer: v.string(),
})

const itemValidator = v.object({
  id: v.string(),
  title: v.string(),
  username: v.string(),
  passwordMasked: v.string(),
  urls: v.array(v.string()),
  category: v.string(),
  folder: v.string(),
  tags: v.array(v.string()),
  risk: riskValidator,
  updatedAt: v.string(),
  note: v.string(),
  securityQuestions: v.array(securityQuestionValidator),
})

export const listByOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query('vaultItems')
      .withIndex('by_owner', (query) => query.eq('ownerId', args.ownerId))
      .collect()

    return docs
      .map((doc) => ({
        id: doc.itemId,
        title: doc.title,
        username: doc.username,
        passwordMasked: doc.passwordMasked,
        urls: doc.urls,
        category: doc.category,
        folder: doc.folder,
        tags: doc.tags,
        risk: doc.risk,
        updatedAt: doc.updatedAt,
        note: doc.note,
        securityQuestions: doc.securityQuestions,
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
  },
})

export const upsertForOwner = mutation({
  args: {
    ownerId: v.string(),
    item: itemValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('vaultItems')
      .withIndex('by_owner_item', (query) => query.eq('ownerId', args.ownerId).eq('itemId', args.item.id))
      .unique()

    const cleanItem = {
      ownerId: args.ownerId,
      itemId: args.item.id,
      title: args.item.title,
      username: args.item.username,
      passwordMasked: args.item.passwordMasked,
      urls: args.item.urls,
      category: args.item.category,
      folder: args.item.folder,
      tags: args.item.tags,
      risk: args.item.risk,
      updatedAt: args.item.updatedAt,
      note: args.item.note,
      securityQuestions: args.item.securityQuestions,
    }

    if (existing) {
      await ctx.db.patch(existing._id, cleanItem)
    } else {
      await ctx.db.insert('vaultItems', cleanItem)
    }

    return {
      id: cleanItem.itemId,
      title: cleanItem.title,
      username: cleanItem.username,
      passwordMasked: cleanItem.passwordMasked,
      urls: cleanItem.urls,
      category: cleanItem.category,
      folder: cleanItem.folder,
      tags: cleanItem.tags,
      risk: cleanItem.risk,
      updatedAt: cleanItem.updatedAt,
      note: cleanItem.note,
      securityQuestions: cleanItem.securityQuestions,
    }
  },
})

export const seedForOwner = mutation({
  args: {
    ownerId: v.string(),
    items: v.array(itemValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('vaultItems')
      .withIndex('by_owner', (query) => query.eq('ownerId', args.ownerId))
      .take(1)

    if (existing.length > 0) {
      return { seeded: false }
    }

    for (const item of args.items) {
      await ctx.db.insert('vaultItems', {
        ownerId: args.ownerId,
        itemId: item.id,
        title: item.title,
        username: item.username,
        passwordMasked: item.passwordMasked,
        urls: item.urls,
        category: item.category,
        folder: item.folder,
        tags: item.tags,
        risk: item.risk,
        updatedAt: item.updatedAt,
        note: item.note,
        securityQuestions: item.securityQuestions,
      })
    }

    return { seeded: true }
  },
})

export const deleteForOwner = mutation({
  args: {
    ownerId: v.string(),
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('vaultItems')
      .withIndex('by_owner_item', (query) => query.eq('ownerId', args.ownerId).eq('itemId', args.itemId))
      .unique()

    if (!existing) {
      return { deleted: false }
    }

    await ctx.db.delete(existing._id)
    return { deleted: true }
  },
})
