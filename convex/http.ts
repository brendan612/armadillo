import { httpRouter } from 'convex/server'
import { api } from './_generated/api'
import { httpAction } from './_generated/server'

type RiskState = 'safe' | 'weak' | 'reused' | 'exposed' | 'stale'
type OwnerSource = 'auth' | 'anonymous'

type VaultItemPayload = {
  id: string
  title: string
  username: string
  passwordMasked: string
  urls: string[]
  category: string
  folder: string
  tags: string[]
  risk: RiskState
  updatedAt: string
  note: string
  securityQuestions: { question: string; answer: string }[]
}

const http = httpRouter()

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
    // If auth is not configured for this HTTP route yet, fall back to anonymous owner.
  }

  const ownerHintRaw = request.headers.get('x-armadillo-owner') || ''
  const ownerHint = normalizeOwnerHint(ownerHintRaw)
  if (!ownerHint) {
    return null
  }

  return { ownerId: `anon:${ownerHint}`, ownerSource: 'anonymous' as OwnerSource }
}

http.route({
  path: '/api/items/list',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/items/upsert',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/items/delete',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
})

http.route({
  path: '/api/items/list',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved. Sign in or provide owner header.' }, 401)
    }

    const items = await ctx.runQuery(api.items.listByOwner, { ownerId: owner.ownerId })
    return json({ items, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/items/upsert',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved. Sign in or provide owner header.' }, 401)
    }

    const payload = (await request.json()) as { item?: Partial<VaultItemPayload> }
    if (!payload.item?.id || !payload.item.title || !payload.item.username) {
      return json({ error: 'A valid item is required' }, 400)
    }

    const item: VaultItemPayload = {
      id: payload.item.id,
      title: payload.item.title,
      username: payload.item.username,
      passwordMasked: payload.item.passwordMasked ?? '********',
      urls: Array.isArray(payload.item.urls) ? payload.item.urls : [],
      category: payload.item.category ?? 'General',
      folder: payload.item.folder ?? 'Personal',
      tags: Array.isArray(payload.item.tags) ? payload.item.tags : [],
      risk: payload.item.risk ?? 'safe',
      updatedAt: payload.item.updatedAt ?? 'just now',
      note: payload.item.note ?? '',
      securityQuestions: Array.isArray(payload.item.securityQuestions) ? payload.item.securityQuestions : [],
    }

    const saved = await ctx.runMutation(api.items.upsertForOwner, { ownerId: owner.ownerId, item })
    return json({ ok: true, item: saved, ownerSource: owner.ownerSource })
  }),
})

http.route({
  path: '/api/items/delete',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const owner = await resolveOwner(ctx, request)
    if (!owner) {
      return json({ error: 'Owner could not be resolved. Sign in or provide owner header.' }, 401)
    }

    const payload = (await request.json()) as { itemId?: string }
    if (!payload.itemId) {
      return json({ error: 'itemId is required' }, 400)
    }

    const result = await ctx.runMutation(api.items.deleteForOwner, {
      ownerId: owner.ownerId,
      itemId: payload.itemId,
    })

    return json({ ok: true, deleted: result.deleted, ownerSource: owner.ownerSource })
  }),
})

export default http
