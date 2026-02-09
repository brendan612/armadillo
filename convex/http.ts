import { httpRouter } from 'convex/server'
import { api } from './_generated/api'
import { httpAction } from './_generated/server'
import { auth } from './auth'

type OwnerSource = 'auth' | 'anonymous'

const http = httpRouter()
auth.addHttpRoutes(http)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-armadillo-owner',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
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
      return { ownerId: `user:${identity.subject}`, ownerSource: 'auth' as OwnerSource }
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
  path: '/api/sync/pull',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/sync/push',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
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

export default http
