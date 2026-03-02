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

export const deleteByOwnerVault = mutation({
  args: {
    ownerId: v.string(),
    vaultId: v.string(),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query('vaultSnapshots')
      .withIndex('by_owner_vault', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId))
      .unique()

    if (snapshot) {
      await ctx.db.delete(snapshot._id)
    }

    const blobs = await ctx.db
      .query('vaultBlobs')
      .withIndex('by_owner_vault_blobs', (q) => q.eq('ownerId', args.ownerId).eq('vaultId', args.vaultId))
      .collect()
    for (const blob of blobs) {
      await ctx.db.delete(blob._id)
    }

    return { deleted: Boolean(snapshot || blobs.length > 0) }
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

const roleValidator = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('editor'),
  v.literal('viewer'),
)

const overrideTargetTypeValidator = v.union(
  v.literal('userId'),
  v.literal('tokenIdentifier'),
  v.literal('subject'),
  v.literal('email'),
)

export const getEntitlementOverrideToken = query({
  args: {
    targetType: overrideTargetTypeValidator,
    targetValue: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('entitlementOverrides')
      .withIndex('by_target', (q) => q.eq('targetType', args.targetType).eq('targetValue', args.targetValue))
      .unique()
    return typeof row?.token === 'string' ? row.token : null
  },
})

export const ensureOrgMemberRole = mutation({
  args: {
    orgId: v.string(),
    memberId: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const existingOrg = await ctx.db
      .query('orgs')
      .withIndex('by_org_id', (q) => q.eq('orgId', args.orgId))
      .unique()
    if (!existingOrg) {
      await ctx.db.insert('orgs', {
        orgId: args.orgId,
        name: `Organization ${args.orgId}`,
        createdAt: args.now,
        createdBy: args.memberId,
      })
    }

    const existing = await ctx.db
      .query('orgMembers')
      .withIndex('by_org_member', (q) => q.eq('orgId', args.orgId).eq('memberId', args.memberId))
      .unique()
    if (existing?.role) {
      return existing.role
    }
    await ctx.db.insert('orgMembers', {
      orgId: args.orgId,
      memberId: args.memberId,
      role: 'owner',
      addedAt: args.now,
      updatedAt: args.now,
      addedBy: args.memberId,
    })
    return 'owner' as const
  },
})

export const getOrgMemberRole = query({
  args: {
    orgId: v.string(),
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('orgMembers')
      .withIndex('by_org_member', (q) => q.eq('orgId', args.orgId).eq('memberId', args.memberId))
      .unique()
    return existing?.role ?? null
  },
})

export const listAdminOrgs = query({
  args: {
    subject: v.string(),
    includeAll: v.boolean(),
    fallbackOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgRows = await ctx.db
      .query('orgs')
      .withIndex('by_created_at')
      .collect()
    const memberRows = await ctx.db
      .query('orgMembers')
      .collect()

    const memberCountByOrg = new Map<string, number>()
    const myRoleByOrg = new Map<string, 'owner' | 'admin' | 'editor' | 'viewer'>()
    for (const row of memberRows) {
      memberCountByOrg.set(row.orgId, (memberCountByOrg.get(row.orgId) || 0) + 1)
      if (row.memberId === args.subject) {
        myRoleByOrg.set(row.orgId, row.role)
      }
    }

    const orgMap = new Map<string, { id: string; name: string; createdAt: string; createdBy: string }>()
    for (const row of orgRows) {
      orgMap.set(row.orgId, {
        id: row.orgId,
        name: row.name,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
      })
    }
    for (const row of memberRows) {
      if (!orgMap.has(row.orgId)) {
        orgMap.set(row.orgId, {
          id: row.orgId,
          name: `Organization ${row.orgId}`,
          createdAt: row.addedAt,
          createdBy: row.addedBy,
        })
      }
    }
    const fallbackOrgId = (args.fallbackOrgId || '').trim()
    if (fallbackOrgId && !orgMap.has(fallbackOrgId)) {
      orgMap.set(fallbackOrgId, {
        id: fallbackOrgId,
        name: `Organization ${fallbackOrgId}`,
        createdAt: nowIso(),
        createdBy: args.subject,
      })
    }

    const orgs = Array.from(orgMap.values())
      .filter((org) => args.includeAll || myRoleByOrg.has(org.id) || (fallbackOrgId && org.id === fallbackOrgId))
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) return a.id.localeCompare(b.id)
        return b.createdAt > a.createdAt ? 1 : -1
      })
      .map((org) => ({
        ...org,
        myRole: myRoleByOrg.get(org.id) ?? null,
        memberCount: memberCountByOrg.get(org.id) || 0,
      }))
    return { orgs }
  },
})

export const createAdminOrg = mutation({
  args: {
    orgId: v.string(),
    name: v.string(),
    actorSubject: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = args.orgId.trim()
    const name = args.name.trim()
    const existingOrg = await ctx.db
      .query('orgs')
      .withIndex('by_org_id', (q) => q.eq('orgId', orgId))
      .unique()
    if (!existingOrg) {
      await ctx.db.insert('orgs', {
        orgId,
        name,
        createdAt: args.now,
        createdBy: args.actorSubject,
      })
    }

    const existingMember = await ctx.db
      .query('orgMembers')
      .withIndex('by_org_member', (q) => q.eq('orgId', orgId).eq('memberId', args.actorSubject))
      .unique()
    if (!existingMember) {
      await ctx.db.insert('orgMembers', {
        orgId,
        memberId: args.actorSubject,
        role: 'owner',
        addedAt: args.now,
        updatedAt: args.now,
        addedBy: args.actorSubject,
      })
    }

    return {
      org: {
        id: orgId,
        name: existingOrg?.name ?? name,
        createdAt: existingOrg?.createdAt ?? args.now,
        createdBy: existingOrg?.createdBy ?? args.actorSubject,
        myRole: existingMember?.role ?? 'owner',
      },
      created: !existingOrg,
    }
  },
})

export const listOrgMembers = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('orgMembers')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect()
  },
})

export const upsertOrgMember = mutation({
  args: {
    orgId: v.string(),
    memberId: v.string(),
    role: roleValidator,
    now: v.string(),
    actorSubject: v.string(),
  },
  handler: async (ctx, args) => {
    const existingOrg = await ctx.db
      .query('orgs')
      .withIndex('by_org_id', (q) => q.eq('orgId', args.orgId))
      .unique()
    if (!existingOrg) {
      await ctx.db.insert('orgs', {
        orgId: args.orgId,
        name: `Organization ${args.orgId}`,
        createdAt: args.now,
        createdBy: args.actorSubject,
      })
    }

    const existing = await ctx.db
      .query('orgMembers')
      .withIndex('by_org_member', (q) => q.eq('orgId', args.orgId).eq('memberId', args.memberId))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        role: args.role,
        updatedAt: args.now,
        addedBy: args.actorSubject,
      })
      return { addedAt: existing.addedAt }
    }
    await ctx.db.insert('orgMembers', {
      orgId: args.orgId,
      memberId: args.memberId,
      role: args.role,
      addedAt: args.now,
      updatedAt: args.now,
      addedBy: args.actorSubject,
    })
    return { addedAt: args.now }
  },
})

export const deleteOrgMember = mutation({
  args: {
    orgId: v.string(),
    memberId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('orgMembers')
      .withIndex('by_org_member', (q) => q.eq('orgId', args.orgId).eq('memberId', args.memberId))
      .unique()
    if (existing) {
      await ctx.db.delete(existing._id)
      return { deleted: true }
    }
    return { deleted: false }
  },
})

export const appendOrgAuditEvent = mutation({
  args: {
    orgId: v.string(),
    actorSubject: v.string(),
    action: v.string(),
    target: v.string(),
    createdAt: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('orgAuditEvents', {
      orgId: args.orgId,
      actorSubject: args.actorSubject,
      action: args.action,
      target: args.target,
      createdAt: args.createdAt,
      ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
    })
    return { ok: true }
  },
})

export const listOrgAuditEvents = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('orgAuditEvents')
      .withIndex('by_org_created', (q) => q.eq('orgId', args.orgId))
      .collect()
  },
})

export const listEntitlementOverrides = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('entitlementOverrides')
      .withIndex('by_updated_at')
      .collect()
  },
})

export const upsertEntitlementOverride = mutation({
  args: {
    targetType: overrideTargetTypeValidator,
    targetValue: v.string(),
    token: v.string(),
    note: v.string(),
    updatedAt: v.string(),
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('entitlementOverrides')
      .withIndex('by_target', (q) => q.eq('targetType', args.targetType).eq('targetValue', args.targetValue))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        token: args.token,
        note: args.note,
        updatedAt: args.updatedAt,
        updatedBy: args.updatedBy,
      })
      return { id: String(existing._id) }
    }
    const id = await ctx.db.insert('entitlementOverrides', {
      targetType: args.targetType,
      targetValue: args.targetValue,
      token: args.token,
      note: args.note,
      updatedAt: args.updatedAt,
      updatedBy: args.updatedBy,
    })
    return { id: String(id) }
  },
})

export const deleteEntitlementOverride = mutation({
  args: {
    targetType: overrideTargetTypeValidator,
    targetValue: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('entitlementOverrides')
      .withIndex('by_target', (q) => q.eq('targetType', args.targetType).eq('targetValue', args.targetValue))
      .unique()
    if (existing) {
      await ctx.db.delete(existing._id)
      return { deleted: true }
    }
    return { deleted: false }
  },
})

