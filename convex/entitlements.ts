import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

const TARGET_TYPE = v.union(
  v.literal('userId'),
  v.literal('tokenIdentifier'),
  v.literal('subject'),
  v.literal('email'),
)

function normalizeTargetValue(targetType: 'userId' | 'tokenIdentifier' | 'subject' | 'email', raw: string) {
  const trimmed = raw.trim()
  return targetType === 'email' ? trimmed.toLowerCase() : trimmed
}

function assertAdminSecret(secret: string) {
  const expected = (process.env.ENTITLEMENT_ADMIN_SECRET || '').trim()
  if (!expected) {
    throw new Error('ENTITLEMENT_ADMIN_SECRET is not configured on the server')
  }
  if (secret.trim() !== expected) {
    throw new Error('Invalid entitlement admin secret')
  }
}

function normalizeToken(raw: string) {
  const token = raw.trim()
  if (!token) {
    throw new Error('Token is required')
  }
  if (token.split('.').length !== 3) {
    throw new Error('Token must be a signed JWT')
  }
  return token
}

function getActor(identity: { subject?: string | null; tokenIdentifier?: string | null } | null) {
  if (identity?.subject) return `subject:${identity.subject}`
  if (identity?.tokenIdentifier) return `tokenIdentifier:${identity.tokenIdentifier}`
  return 'admin:unknown'
}

export const listOverrides = query({
  args: {
    adminSecret: v.string(),
  },
  handler: async (ctx, args) => {
    assertAdminSecret(args.adminSecret)
    const rows = await ctx.db
      .query('entitlementOverrides')
      .withIndex('by_updated_at')
      .collect()
    return rows
      .slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((row) => ({
        _id: row._id,
        targetType: row.targetType,
        targetValue: row.targetValue,
        note: row.note ?? '',
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      }))
  },
})

export const upsertOverride = mutation({
  args: {
    adminSecret: v.string(),
    targetType: TARGET_TYPE,
    targetValue: v.string(),
    token: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertAdminSecret(args.adminSecret)

    const targetValue = normalizeTargetValue(args.targetType, args.targetValue)
    if (!targetValue) {
      throw new Error('targetValue is required')
    }
    const token = normalizeToken(args.token)
    const note = (args.note || '').trim()
    const identity = await ctx.auth.getUserIdentity()
    const updatedBy = getActor(identity)
    const updatedAt = new Date().toISOString()

    const existing = await ctx.db
      .query('entitlementOverrides')
      .withIndex('by_target', (q) => q.eq('targetType', args.targetType).eq('targetValue', targetValue))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        token,
        note,
        updatedAt,
        updatedBy,
      })
      return { ok: true, updated: true, targetType: args.targetType, targetValue }
    }

    await ctx.db.insert('entitlementOverrides', {
      targetType: args.targetType,
      targetValue,
      token,
      note,
      updatedAt,
      updatedBy,
    })
    return { ok: true, updated: false, targetType: args.targetType, targetValue }
  },
})

export const clearOverride = mutation({
  args: {
    adminSecret: v.string(),
    targetType: TARGET_TYPE,
    targetValue: v.string(),
  },
  handler: async (ctx, args) => {
    assertAdminSecret(args.adminSecret)

    const targetValue = normalizeTargetValue(args.targetType, args.targetValue)
    if (!targetValue) {
      throw new Error('targetValue is required')
    }

    const existing = await ctx.db
      .query('entitlementOverrides')
      .withIndex('by_target', (q) => q.eq('targetType', args.targetType).eq('targetValue', targetValue))
      .unique()

    if (!existing) {
      return { ok: true, deleted: false, targetType: args.targetType, targetValue }
    }

    await ctx.db.delete(existing._id)
    return { ok: true, deleted: true, targetType: args.targetType, targetValue }
  },
})

