import { httpRouter } from 'convex/server'
import { api } from './_generated/api'
import { httpAction } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { auth } from './auth'

type OwnerSource = 'auth' | 'anonymous'

const http = httpRouter()
auth.addHttpRoutes(http)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-armadillo-owner, x-armadillo-org, x-armadillo-session',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const MAX_BLOB_FILE_BYTES = Number(process.env.SYNC_MAX_BLOB_FILE_BYTES || 20 * 1024 * 1024)
const MAX_BLOB_TOTAL_BYTES = Number(process.env.SYNC_MAX_BLOB_TOTAL_BYTES || 2 * 1024 * 1024 * 1024)
const SYNC_ENTITLEMENT_TOKEN = (process.env.SYNC_ENTITLEMENT_TOKEN || '').trim()

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function nowIso(value = Date.now()) {
  return new Date(value).toISOString()
}

async function resolveIdentity(
  ctx: { auth?: { getUserIdentity?: () => Promise<Record<string, unknown> | null> } },
) {
  try {
    const identity = await ctx.auth?.getUserIdentity?.()
    if (!identity) {
      return null
    }

    const subject = typeof identity.subject === 'string' ? identity.subject : null
    const email = typeof identity.email === 'string' ? identity.email : null
    const name = typeof identity.name === 'string' ? identity.name : null
    const tokenIdentifier = typeof identity.tokenIdentifier === 'string' ? identity.tokenIdentifier : null

    if (!subject && !tokenIdentifier) {
      return null
    }

    return { subject, email, name, tokenIdentifier }
  } catch {
    return null
  }
}

function normalizeOwnerHint(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64)
}

async function resolveOwner(
  ctx: { auth?: { getUserIdentity?: () => Promise<{ subject?: string } | null> } },
  request: Request,
) {
  try {
    const identity = await ctx.auth?.getUserIdentity?.()
    if (identity?.subject) {
      const userId = identity.subject.split('|')[0]
      return { ownerId: `user:${userId}`, ownerSource: 'auth' as OwnerSource }
    }
  } catch {
    // Fall through to anonymous owner hint for offline/unauthenticated mode.
  }

  const ownerHintRaw = request.headers.get('x-armadillo-owner') || ''
  const ownerHint = normalizeOwnerHint(ownerHintRaw)
  if (!ownerHint) {
    return null
  }

  return { ownerId: `anon:${ownerHint}`, ownerSource: 'anonymous' as OwnerSource }
}

http.route({
  path: '/api/auth/status',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/auth/status',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/entitlements/me',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/auth/status',
  method: 'POST',
  handler: httpAction(async (ctx) => {
    const identity = await resolveIdentity(ctx)
    if (!identity) {
      return json({ authenticated: false })
    }

    // JWT claims may omit email/name -- look them up from auth tables.
    let email = identity.email
    let name = identity.name

    const subjectUserId = identity.subject?.split('|')[0] || null
    const subjectSessionId = identity.subject?.split('|')[1] || null
    if ((!email || !name) && subjectUserId) {
      try {
        const user = await ctx.db.get(subjectUserId as Id<'users'>)
        if (user) {
          email = email || user.email || null
          name = name || user.name || null
        }
      } catch {
        // Fall through to tokenIdentifier lookup.
      }
    }

    if ((!email || !name) && subjectSessionId) {
      try {
        const session = await ctx.db.get(subjectSessionId as Id<'authSessions'>)
        if (session?.userId) {
          const userFromSession = await ctx.db.get(session.userId)
          if (userFromSession) {
            email = email || userFromSession.email || null
            name = name || userFromSession.name || null
          }
        }
      } catch {
        // Fall through to tokenIdentifier lookup.
      }
    }

    if (!email && subjectUserId) {
      try {
        const googleAccount = await ctx.db
          .query('authAccounts')
          .withIndex('userIdAndProvider', (q) => q.eq('userId', subjectUserId as Id<'users'>).eq('provider', 'google'))
          .unique()
        if (googleAccount?.emailVerified) {
          email = googleAccount.emailVerified
        }
      } catch {
        // Fall through to tokenIdentifier lookup.
      }
    }

    if ((!email || !name) && identity.tokenIdentifier) {
      try {
        const profile = await ctx.runQuery(api.sync.getUserProfile, {
          tokenIdentifier: identity.tokenIdentifier,
        })
        if (profile) {
          email = email || profile.email
          name = name || profile.name
        }
      } catch {
        // Fall through with whatever we have from the JWT
      }
    }

    const response = {
      authenticated: true,
      subject: identity.subject,
      email,
      name,
      tokenIdentifier: identity.tokenIdentifier,
    }
    return json(response)
  }),
})

http.route({
  path: '/api/v2/auth/status',
  method: 'POST',
  handler: httpAction(async (ctx) => {
    const identity = await resolveIdentity(ctx)
    if (!identity) {
      return json({ authenticated: false })
    }

    // JWT claims may omit email/name -- look them up from auth tables.
    let email = identity.email
    let name = identity.name

    const subjectUserId = identity.subject?.split('|')[0] || null
    const subjectSessionId = identity.subject?.split('|')[1] || null
    if ((!email || !name) && subjectUserId) {
      try {
        const user = await ctx.db.get(subjectUserId as Id<'users'>)
        if (user) {
          email = email || user.email || null
          name = name || user.name || null
        }
      } catch {
        // Fall through to tokenIdentifier lookup.
      }
    }

    if ((!email || !name) && subjectSessionId) {
      try {
        const session = await ctx.db.get(subjectSessionId as Id<'authSessions'>)
        if (session?.userId) {
          const userFromSession = await ctx.db.get(session.userId)
          if (userFromSession) {
            email = email || userFromSession.email || null
            name = name || userFromSession.name || null
          }
        }
      } catch {
        // Fall through to tokenIdentifier lookup.
      }
    }

    if (!email && subjectUserId) {
      try {
        const googleAccount = await ctx.db
          .query('authAccounts')
          .withIndex('userIdAndProvider', (q) => q.eq('userId', subjectUserId as Id<'users'>).eq('provider', 'google'))
          .unique()
        if (googleAccount?.emailVerified) {
          email = googleAccount.emailVerified
        }
      } catch {
        // Fall through to tokenIdentifier lookup.
      }
    }

    if ((!email || !name) && identity.tokenIdentifier) {
      try {
        const profile = await ctx.runQuery(api.sync.getUserProfile, {
          tokenIdentifier: identity.tokenIdentifier,
        })
        if (profile) {
          email = email || profile.email
          name = name || profile.name
        }
      } catch {
        // Fall through with whatever we have from the JWT
      }
    }

    const response = {
      authenticated: true,
      subject: identity.subject,
      email,
      name,
      tokenIdentifier: identity.tokenIdentifier,
    }
    return json(response)
  }),
})

http.route({
  path: '/api/v2/entitlements/me',
  method: 'GET',
  handler: httpAction(async () => {
    return json(
      SYNC_ENTITLEMENT_TOKEN
        ? {
          ok: true,
          token: SYNC_ENTITLEMENT_TOKEN,
          reason: 'Server-issued entitlement token',
          expiresAt: null,
          fetchedAt: nowIso(),
        }
        : {
          ok: false,
          token: null,
          reason: 'No signed entitlement token configured',
          expiresAt: null,
          fetchedAt: nowIso(),
        },
    )
  }),
})

http.route({
  path: '/api/sync/pull',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/pull',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/sync/push',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/push',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/sync/pull-by-owner',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/pull-by-owner',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/sync/list-by-owner',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/list-by-owner',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/blobs/put',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/blobs/get',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/v2/sync/blobs/delete',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/sync/pull-by-owner',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    let snapshot = await ctx.runQuery(api.sync.pullByOwner, {
      ownerId: owner.ownerId,
    })

    if (!snapshot && owner.ownerSource === 'auth' && owner.ownerId.startsWith('user:')) {
      const userId = owner.ownerId.slice('user:'.length)
      snapshot = await ctx.runQuery(api.sync.pullByLegacyUserPrefix, { userId })
    }

    return json({ snapshot: snapshot ? JSON.parse(snapshot.encryptedFile) : null, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/pull-by-owner',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    let snapshot = await ctx.runQuery(api.sync.pullByOwner, {
      ownerId: owner.ownerId,
    })

    if (!snapshot && owner.ownerSource === 'auth' && owner.ownerId.startsWith('user:')) {
      const userId = owner.ownerId.slice('user:'.length)
      snapshot = await ctx.runQuery(api.sync.pullByLegacyUserPrefix, { userId })
    }

    return json({ snapshot: snapshot ? JSON.parse(snapshot.encryptedFile) : null, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/sync/list-by-owner',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const seen = new Set<string>()
    const entries: Array<{ vaultId: string; revision: number; encryptedFile: string; updatedAt: string }> = []

    const primary = await ctx.runQuery(api.sync.listByOwner, {
      ownerId: owner.ownerId,
    })

    for (const entry of primary) {
      const key = `${entry.ownerId}|${entry.vaultId}|${entry.revision}|${entry.updatedAt}`
      if (!seen.has(key)) {
        seen.add(key)
        entries.push({
          vaultId: entry.vaultId,
          revision: entry.revision,
          encryptedFile: entry.encryptedFile,
          updatedAt: entry.updatedAt,
        })
      }
    }

    if (owner.ownerSource === 'auth' && owner.ownerId.startsWith('user:')) {
      const userId = owner.ownerId.slice('user:'.length)
      const legacy = await ctx.runQuery(api.sync.listByLegacyUserPrefix, { userId })
      for (const entry of legacy) {
        const key = `${entry.ownerId}|${entry.vaultId}|${entry.revision}|${entry.updatedAt}`
        if (!seen.has(key)) {
          seen.add(key)
          entries.push({
            vaultId: entry.vaultId,
            revision: entry.revision,
            encryptedFile: entry.encryptedFile,
            updatedAt: entry.updatedAt,
          })
        }
      }
    }

    const snapshots = entries
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      .map((entry) => JSON.parse(entry.encryptedFile))

    return json({ snapshots, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/list-by-owner',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const seen = new Set<string>()
    const entries: Array<{ vaultId: string; revision: number; encryptedFile: string; updatedAt: string }> = []

    const primary = await ctx.runQuery(api.sync.listByOwner, {
      ownerId: owner.ownerId,
    })

    for (const entry of primary) {
      const key = `${entry.ownerId}|${entry.vaultId}|${entry.revision}|${entry.updatedAt}`
      if (!seen.has(key)) {
        seen.add(key)
        entries.push({
          vaultId: entry.vaultId,
          revision: entry.revision,
          encryptedFile: entry.encryptedFile,
          updatedAt: entry.updatedAt,
        })
      }
    }

    if (owner.ownerSource === 'auth' && owner.ownerId.startsWith('user:')) {
      const userId = owner.ownerId.slice('user:'.length)
      const legacy = await ctx.runQuery(api.sync.listByLegacyUserPrefix, { userId })
      for (const entry of legacy) {
        const key = `${entry.ownerId}|${entry.vaultId}|${entry.revision}|${entry.updatedAt}`
        if (!seen.has(key)) {
          seen.add(key)
          entries.push({
            vaultId: entry.vaultId,
            revision: entry.revision,
            encryptedFile: entry.encryptedFile,
            updatedAt: entry.updatedAt,
          })
        }
      }
    }

    const snapshots = entries
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      .map((entry) => JSON.parse(entry.encryptedFile))

    return json({ snapshots, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/sync/pull',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const payload = (await request.json()) as { vaultId?: string }
    if (!payload.vaultId) {
      return json({ error: 'vaultId is required' }, 400)
    }

    const snapshot = await ctx.runQuery(api.sync.pullByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
    })

    return json({ snapshot: snapshot ? JSON.parse(snapshot.encryptedFile) : null, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/pull',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const payload = (await request.json()) as { vaultId?: string }
    if (!payload.vaultId) {
      return json({ error: 'vaultId is required' }, 400)
    }

    const snapshot = await ctx.runQuery(api.sync.pullByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
    })

    return json({ snapshot: snapshot ? JSON.parse(snapshot.encryptedFile) : null, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/sync/push',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const payload = (await request.json()) as {
      vaultId?: string
      revision?: number
      encryptedFile?: string
      updatedAt?: string
    }

    if (!payload.vaultId || typeof payload.revision !== 'number' || !payload.encryptedFile || !payload.updatedAt) {
      return json({ error: 'vaultId, revision, encryptedFile, and updatedAt are required' }, 400)
    }

    const result = await ctx.runMutation(api.sync.pushByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
      revision: payload.revision,
      encryptedFile: payload.encryptedFile,
      updatedAt: payload.updatedAt,
    })

    return json({ ok: true, accepted: result.accepted, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/push',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }

    const payload = (await request.json()) as {
      vaultId?: string
      revision?: number
      encryptedFile?: string
      updatedAt?: string
    }

    if (!payload.vaultId || typeof payload.revision !== 'number' || !payload.encryptedFile || !payload.updatedAt) {
      return json({ error: 'vaultId, revision, encryptedFile, and updatedAt are required' }, 400)
    }

    const result = await ctx.runMutation(api.sync.pushByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
      revision: payload.revision,
      encryptedFile: payload.encryptedFile,
      updatedAt: payload.updatedAt,
    })

    return json({ ok: true, accepted: result.accepted, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/blobs/put',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }
    const payload = (await request.json()) as {
      vaultId?: string
      blobId?: string
      nonce?: string
      ciphertext?: string
      sizeBytes?: number
      sha256?: string
      mimeType?: string
      fileName?: string
      updatedAt?: string
    }
    if (
      !payload.vaultId
      || !payload.blobId
      || !payload.nonce
      || !payload.ciphertext
      || typeof payload.sizeBytes !== 'number'
      || !payload.sha256
      || !payload.updatedAt
    ) {
      return json({ error: 'vaultId, blobId, nonce, ciphertext, sizeBytes, sha256, and updatedAt are required' }, 400)
    }
    try {
      const result = await ctx.runMutation(api.sync.putBlobByOwnerVault, {
        ownerId: owner.ownerId,
        vaultId: payload.vaultId,
        blobId: payload.blobId,
        nonce: payload.nonce,
        ciphertext: payload.ciphertext,
        sizeBytes: payload.sizeBytes,
        sha256: payload.sha256,
        mimeType: payload.mimeType || 'application/octet-stream',
        fileName: payload.fileName || 'file.bin',
        updatedAt: payload.updatedAt,
        maxFileBytes: MAX_BLOB_FILE_BYTES,
        maxVaultBytes: MAX_BLOB_TOTAL_BYTES,
      })
      return json({
        ok: true,
        accepted: result.accepted,
        ownerSource: owner.ownerSource,
        usedBytes: result.usedBytes,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'blob upload failed'
      if (message.includes('quota') || message.includes('limit')) {
        return json({ error: message }, 413)
      }
      return json({ error: message }, 400)
    }
  }),
})

http.route({
  path: '/api/v2/sync/blobs/get',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }
    const payload = (await request.json()) as { vaultId?: string; blobId?: string }
    if (!payload.vaultId || !payload.blobId) {
      return json({ error: 'vaultId and blobId are required' }, 400)
    }
    const blob = await ctx.runQuery(api.sync.getBlobByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
      blobId: payload.blobId,
    })
    return json({ blob, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/v2/sync/blobs/delete',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved.' }, 401)
    }
    const payload = (await request.json()) as { vaultId?: string; blobId?: string }
    if (!payload.vaultId || !payload.blobId) {
      return json({ error: 'vaultId and blobId are required' }, 400)
    }
    const result = await ctx.runMutation(api.sync.deleteBlobByOwnerVault, {
      ownerId: owner.ownerId,
      vaultId: payload.vaultId,
      blobId: payload.blobId,
    })
    return json({
      ok: true,
      deleted: result.deleted,
      ownerSource: owner.ownerSource,
      usedBytes: result.usedBytes,
    })
  }),
})

export default http
