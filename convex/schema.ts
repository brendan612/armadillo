import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'

export default defineSchema({
  ...authTables,
  entitlementOverrides: defineTable({
    targetType: v.union(
      v.literal('userId'),
      v.literal('tokenIdentifier'),
      v.literal('subject'),
      v.literal('email'),
    ),
    targetValue: v.string(),
    mode: v.optional(v.union(v.literal('token'), v.literal('derived'))),
    token: v.optional(v.string()),
    tier: v.optional(v.union(
      v.literal('free'),
      v.literal('premium'),
      v.literal('enterprise'),
    )),
    capabilities: v.optional(v.array(v.string())),
    note: v.optional(v.string()),
    updatedAt: v.string(),
    updatedBy: v.string(),
  })
    .index('by_target', ['targetType', 'targetValue'])
    .index('by_updated_at', ['updatedAt']),
  orgMembers: defineTable({
    orgId: v.string(),
    memberId: v.string(),
    email: v.optional(v.string()),
    role: v.union(
      v.literal('owner'),
      v.literal('admin'),
      v.literal('editor'),
      v.literal('viewer'),
    ),
    addedAt: v.string(),
    updatedAt: v.string(),
    addedBy: v.string(),
  })
    .index('by_org_member', ['orgId', 'memberId'])
    .index('by_org', ['orgId'])
    .index('by_member', ['memberId']),
  orgs: defineTable({
    orgId: v.string(),
    name: v.string(),
    createdAt: v.string(),
    createdBy: v.string(),
  })
    .index('by_org_id', ['orgId'])
    .index('by_created_at', ['createdAt']),
  orgAuditEvents: defineTable({
    orgId: v.string(),
    actorSubject: v.string(),
    action: v.string(),
    target: v.string(),
    createdAt: v.string(),
    metadata: v.optional(v.any()),
  })
    .index('by_org_created', ['orgId', 'createdAt'])
    .index('by_created', ['createdAt']),
  vaultSnapshots: defineTable({
    ownerId: v.string(),
    orgId: v.optional(v.string()),
    vaultId: v.string(),
    revision: v.number(),
    encryptedFile: v.string(),
    updatedAt: v.string(),
  })
    .index('by_owner_vault', ['ownerId', 'vaultId'])
    .index('by_owner', ['ownerId'])
    .index('by_org', ['orgId'])
    .index('by_org_vault', ['orgId', 'vaultId']),
  vaultBlobs: defineTable({
    ownerId: v.string(),
    orgId: v.optional(v.string()),
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
    .index('by_owner_vault_blobs', ['ownerId', 'vaultId'])
    .index('by_org_vault_blobs', ['orgId', 'vaultId'])
    .index('by_org', ['orgId']),
  subscriptionRecords: defineTable({
    scopeType: v.union(v.literal('org'), v.literal('user')),
    scopeId: v.string(),
    tier: v.union(
      v.literal('free'),
      v.literal('premium'),
      v.literal('enterprise'),
    ),
    status: v.union(
      v.literal('active'),
      v.literal('trialing'),
      v.literal('canceled'),
      v.literal('past_due'),
      v.literal('paused'),
    ),
    billingMode: v.union(v.literal('manual'), v.literal('external')),
    seatLimit: v.optional(v.number()),
    storageLimitBytes: v.optional(v.number()),
    renewalAt: v.optional(v.string()),
    endAt: v.optional(v.string()),
    note: v.optional(v.string()),
    updatedAt: v.string(),
    updatedBy: v.string(),
  })
    .index('by_scope', ['scopeType', 'scopeId'])
    .index('by_updated_at', ['updatedAt']),
})
