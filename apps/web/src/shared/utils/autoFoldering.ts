import type { AutoFolderCustomMapping, VaultItem } from '../../types/vault'

export const TOP_LEVEL_FOLDERS = [
  'Finance',
  'Shopping',
  'Work',
  'Social',
  'Email',
  'Cloud',
  'Developer',
  'Utilities',
  'Health',
  'Education',
  'Travel',
  'Government',
  'Entertainment',
  'Home',
  'Other',
] as const

export type TopLevelFolder = (typeof TOP_LEVEL_FOLDERS)[number]

export type AutoFolderConfidenceLevel = 'high' | 'medium' | 'low'

export type AutoFolderPreferences = {
  excludedItemIds?: string[]
  lockedFolderPaths?: string[]
  customMappings?: AutoFolderCustomMapping[]
}

export type AutoFolderAssignment = {
  itemId: string
  itemTitle: string
  primaryUrl: string
  topLevel: string
  subfolder: string | null
  targetPath: string
  confidence: number
  confidenceLevel: AutoFolderConfidenceLevel
  reasons: string[]
  matchedSignal?: string
  lockedPathApplied?: boolean
  overridden?: boolean
  excluded?: boolean
}

export type AutoFolderBucketPreview = {
  topLevel: string
  count: number
  subfolders: Array<{ name: string; count: number }>
}

export type AutoFolderPlan = {
  consideredCount: number
  skippedCount: number
  moveCount: number
  excludedCount: number
  lowConfidenceCount: number
  topLevelCount: number
  subfolderCount: number
  createdTopLevels: string[]
  createdSubfolders: string[]
  newFolderPaths: string[]
  conflicts: string[]
  excludedItemIds: string[]
  lockedFolderPaths: string[]
  assignments: AutoFolderAssignment[]
  buckets: AutoFolderBucketPreview[]
}

export type AutoFolderOptions = {
  targetMaxTopLevel?: number
  subfolderMinItems?: number
  maxSubfoldersPerTopLevel?: number
  existingFolderPaths?: string[]
  preferences?: AutoFolderPreferences
}

type DomainRule = {
  topLevel: TopLevelFolder
  provider?: string
}

type Classification = {
  topLevel: TopLevelFolder
  providerLabel: string | null
  confidence: number
  confidenceLevel: AutoFolderConfidenceLevel
  reasons: string[]
  matchedSignal?: string
  customPath?: string
}

const SECOND_LEVEL_TLDS = new Set([
  'co.uk',
  'com.au',
  'co.nz',
  'co.jp',
  'com.br',
  'co.in',
  'com.mx',
  'com.sg',
])

const GENERIC_PROVIDER_ROOTS = new Set([
  'www',
  'auth',
  'login',
  'secure',
  'portal',
  'account',
  'accounts',
  'service',
  'app',
  'home',
  'id',
  'mail',
])

const DOMAIN_RULES: Record<string, DomainRule> = {
  // Finance
  chase: { topLevel: 'Finance', provider: 'Chase' },
  amex: { topLevel: 'Finance', provider: 'American Express' },
  capitalone: { topLevel: 'Finance', provider: 'Capital One' },
  bankofamerica: { topLevel: 'Finance', provider: 'Bank of America' },
  citibank: { topLevel: 'Finance', provider: 'Citi' },
  discover: { topLevel: 'Finance', provider: 'Discover' },
  usbank: { topLevel: 'Finance', provider: 'US Bank' },
  pnc: { topLevel: 'Finance', provider: 'PNC' },
  wellsfargo: { topLevel: 'Finance', provider: 'Wells Fargo' },
  fidelity: { topLevel: 'Finance', provider: 'Fidelity' },
  schwab: { topLevel: 'Finance', provider: 'Charles Schwab' },
  robinhood: { topLevel: 'Finance', provider: 'Robinhood' },
  coinbase: { topLevel: 'Finance', provider: 'Coinbase' },
  kraken: { topLevel: 'Finance', provider: 'Kraken' },
  paypal: { topLevel: 'Finance', provider: 'PayPal' },
  venmo: { topLevel: 'Finance', provider: 'Venmo' },
  cashapp: { topLevel: 'Finance', provider: 'Cash App' },
  stripe: { topLevel: 'Finance', provider: 'Stripe' },
  mint: { topLevel: 'Finance', provider: 'Mint' },
  intuit: { topLevel: 'Finance', provider: 'Intuit' },

  // Shopping
  amazon: { topLevel: 'Shopping', provider: 'Amazon' },
  ebay: { topLevel: 'Shopping', provider: 'eBay' },
  walmart: { topLevel: 'Shopping', provider: 'Walmart' },
  target: { topLevel: 'Shopping', provider: 'Target' },
  costco: { topLevel: 'Shopping', provider: 'Costco' },
  etsy: { topLevel: 'Shopping', provider: 'Etsy' },
  bestbuy: { topLevel: 'Shopping', provider: 'Best Buy' },
  aliexpress: { topLevel: 'Shopping', provider: 'AliExpress' },
  instacart: { topLevel: 'Shopping', provider: 'Instacart' },
  doordash: { topLevel: 'Shopping', provider: 'DoorDash' },
  ubereats: { topLevel: 'Shopping', provider: 'Uber Eats' },
  grubhub: { topLevel: 'Shopping', provider: 'Grubhub' },
  shopify: { topLevel: 'Shopping', provider: 'Shopify' },

  // Work
  slack: { topLevel: 'Work', provider: 'Slack' },
  notion: { topLevel: 'Work', provider: 'Notion' },
  atlassian: { topLevel: 'Work', provider: 'Atlassian' },
  jira: { topLevel: 'Work', provider: 'Jira' },
  confluence: { topLevel: 'Work', provider: 'Confluence' },
  asana: { topLevel: 'Work', provider: 'Asana' },
  trello: { topLevel: 'Work', provider: 'Trello' },
  clickup: { topLevel: 'Work', provider: 'ClickUp' },
  monday: { topLevel: 'Work', provider: 'Monday.com' },
  zoom: { topLevel: 'Work', provider: 'Zoom' },
  teams: { topLevel: 'Work', provider: 'Microsoft Teams' },
  calendly: { topLevel: 'Work', provider: 'Calendly' },
  docs: { topLevel: 'Work', provider: 'Google Workspace' },
  drive: { topLevel: 'Work', provider: 'Google Workspace' },
  microsoftonline: { topLevel: 'Work', provider: 'Microsoft' },
  office: { topLevel: 'Work', provider: 'Microsoft 365' },

  // Social
  facebook: { topLevel: 'Social', provider: 'Facebook' },
  instagram: { topLevel: 'Social', provider: 'Instagram' },
  tiktok: { topLevel: 'Social', provider: 'TikTok' },
  snapchat: { topLevel: 'Social', provider: 'Snapchat' },
  reddit: { topLevel: 'Social', provider: 'Reddit' },
  twitter: { topLevel: 'Social', provider: 'X' },
  x: { topLevel: 'Social', provider: 'X' },
  linkedin: { topLevel: 'Social', provider: 'LinkedIn' },
  discord: { topLevel: 'Social', provider: 'Discord' },
  telegram: { topLevel: 'Social', provider: 'Telegram' },
  whatsapp: { topLevel: 'Social', provider: 'WhatsApp' },
  signal: { topLevel: 'Social', provider: 'Signal' },

  // Email
  gmail: { topLevel: 'Email', provider: 'Google' },
  outlook: { topLevel: 'Email', provider: 'Microsoft' },
  yahoo: { topLevel: 'Email', provider: 'Yahoo' },
  proton: { topLevel: 'Email', provider: 'Proton' },
  zoho: { topLevel: 'Email', provider: 'Zoho' },
  icloud: { topLevel: 'Email', provider: 'Apple' },
  fastmail: { topLevel: 'Email', provider: 'Fastmail' },
  hey: { topLevel: 'Email', provider: 'HEY' },

  // Cloud
  aws: { topLevel: 'Cloud', provider: 'AWS' },
  azure: { topLevel: 'Cloud', provider: 'Azure' },
  googlecloud: { topLevel: 'Cloud', provider: 'Google Cloud' },
  gcp: { topLevel: 'Cloud', provider: 'Google Cloud' },
  cloudflare: { topLevel: 'Cloud', provider: 'Cloudflare' },
  digitalocean: { topLevel: 'Cloud', provider: 'DigitalOcean' },
  heroku: { topLevel: 'Cloud', provider: 'Heroku' },
  netlify: { topLevel: 'Cloud', provider: 'Netlify' },
  vercel: { topLevel: 'Cloud', provider: 'Vercel' },
  linode: { topLevel: 'Cloud', provider: 'Linode' },
  vultr: { topLevel: 'Cloud', provider: 'Vultr' },

  // Developer
  github: { topLevel: 'Developer', provider: 'GitHub' },
  gitlab: { topLevel: 'Developer', provider: 'GitLab' },
  bitbucket: { topLevel: 'Developer', provider: 'Bitbucket' },
  npmjs: { topLevel: 'Developer', provider: 'npm' },
  docker: { topLevel: 'Developer', provider: 'Docker' },
  replit: { topLevel: 'Developer', provider: 'Replit' },
  codecov: { topLevel: 'Developer', provider: 'Codecov' },
  postman: { topLevel: 'Developer', provider: 'Postman' },
  sentry: { topLevel: 'Developer', provider: 'Sentry' },

  // Utilities
  verizon: { topLevel: 'Utilities', provider: 'Verizon' },
  att: { topLevel: 'Utilities', provider: 'AT&T' },
  tmobile: { topLevel: 'Utilities', provider: 'T-Mobile' },
  xfinity: { topLevel: 'Utilities', provider: 'Xfinity' },
  comcast: { topLevel: 'Utilities', provider: 'Comcast' },
  spectrum: { topLevel: 'Utilities', provider: 'Spectrum' },
  geico: { topLevel: 'Utilities', provider: 'GEICO' },
  progressive: { topLevel: 'Utilities', provider: 'Progressive' },
  statefarm: { topLevel: 'Utilities', provider: 'State Farm' },

  // Health
  cvs: { topLevel: 'Health', provider: 'CVS' },
  walgreens: { topLevel: 'Health', provider: 'Walgreens' },
  mychart: { topLevel: 'Health', provider: 'MyChart' },
  kaiser: { topLevel: 'Health', provider: 'Kaiser Permanente' },
  cigna: { topLevel: 'Health', provider: 'Cigna' },
  aetna: { topLevel: 'Health', provider: 'Aetna' },

  // Education
  coursera: { topLevel: 'Education', provider: 'Coursera' },
  udemy: { topLevel: 'Education', provider: 'Udemy' },
  canvas: { topLevel: 'Education', provider: 'Canvas' },
  blackboard: { topLevel: 'Education', provider: 'Blackboard' },
  edx: { topLevel: 'Education', provider: 'edX' },

  // Travel
  airbnb: { topLevel: 'Travel', provider: 'Airbnb' },
  booking: { topLevel: 'Travel', provider: 'Booking.com' },
  expedia: { topLevel: 'Travel', provider: 'Expedia' },
  marriott: { topLevel: 'Travel', provider: 'Marriott' },
  hilton: { topLevel: 'Travel', provider: 'Hilton' },
  delta: { topLevel: 'Travel', provider: 'Delta' },
  united: { topLevel: 'Travel', provider: 'United' },
  southwest: { topLevel: 'Travel', provider: 'Southwest' },
  lyft: { topLevel: 'Travel', provider: 'Lyft' },
  uber: { topLevel: 'Travel', provider: 'Uber' },

  // Government
  irs: { topLevel: 'Government', provider: 'IRS' },
  usps: { topLevel: 'Government', provider: 'USPS' },
  dmv: { topLevel: 'Government', provider: 'DMV' },
  ssa: { topLevel: 'Government', provider: 'SSA' },
  va: { topLevel: 'Government', provider: 'VA' },

  // Entertainment
  netflix: { topLevel: 'Entertainment', provider: 'Netflix' },
  spotify: { topLevel: 'Entertainment', provider: 'Spotify' },
  youtube: { topLevel: 'Entertainment', provider: 'YouTube' },
  disneyplus: { topLevel: 'Entertainment', provider: 'Disney+' },
  hulu: { topLevel: 'Entertainment', provider: 'Hulu' },
  twitch: { topLevel: 'Entertainment', provider: 'Twitch' },
  steam: { topLevel: 'Entertainment', provider: 'Steam' },
  epicgames: { topLevel: 'Entertainment', provider: 'Epic Games' },
  playstation: { topLevel: 'Entertainment', provider: 'PlayStation' },
  xbox: { topLevel: 'Entertainment', provider: 'Xbox' },
  nintendo: { topLevel: 'Entertainment', provider: 'Nintendo' },

  // Home
  ring: { topLevel: 'Home', provider: 'Ring' },
  nest: { topLevel: 'Home', provider: 'Nest' },
  wyze: { topLevel: 'Home', provider: 'Wyze' },
  hue: { topLevel: 'Home', provider: 'Philips Hue' },
  ecobee: { topLevel: 'Home', provider: 'Ecobee' },
}

const PROVIDER_ALIAS: Record<string, string> = {
  google: 'Google',
  gmail: 'Google',
  youtube: 'YouTube',
  microsoft: 'Microsoft',
  microsoftonline: 'Microsoft',
  live: 'Microsoft',
  office: 'Microsoft',
  amazon: 'Amazon',
  aws: 'AWS',
  apple: 'Apple',
  meta: 'Meta',
  facebook: 'Facebook',
  paypal: 'PayPal',
  atlassian: 'Atlassian',
  github: 'GitHub',
  gitlab: 'GitLab',
  cloudflare: 'Cloudflare',
  doordash: 'DoorDash',
  tmobile: 'T-Mobile',
}

const TOP_LEVEL_KEYWORDS: Record<TopLevelFolder, string[]> = {
  Finance: ['bank', 'finance', 'billing', 'invoice', 'payment', 'wallet', 'credit', 'debit', 'tax', 'invest', 'broker', 'crypto'],
  Shopping: ['shop', 'store', 'retail', 'order', 'checkout', 'market', 'delivery', 'cart'],
  Work: ['work', 'office', 'project', 'task', 'team', 'meeting', 'workspace', 'company'],
  Social: ['social', 'community', 'friends', 'followers', 'forum', 'chat', 'profile'],
  Email: ['email', 'mail', 'inbox', 'imap', 'smtp', 'alias'],
  Cloud: ['cloud', 'hosting', 'server', 'storage', 'infra', 'dns', 'cdn', 'compute'],
  Developer: ['dev', 'developer', 'repo', 'git', 'code', 'deploy', 'ci', 'pipeline', 'package'],
  Utilities: ['utility', 'internet', 'wireless', 'telecom', 'mobile', 'insurance', 'provider'],
  Health: ['health', 'medical', 'doctor', 'clinic', 'pharmacy', 'insurance', 'patient'],
  Education: ['school', 'education', 'course', 'class', 'university', 'learning'],
  Travel: ['travel', 'flight', 'hotel', 'booking', 'trip', 'ride', 'rental'],
  Government: ['government', 'gov', 'benefits', 'license', 'passport', 'official'],
  Entertainment: ['music', 'video', 'stream', 'gaming', 'game', 'media', 'podcast'],
  Home: ['home', 'smart', 'security', 'camera', 'iot'],
  Other: [],
}

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
}

function titleCase(value: string) {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

function pathSegments(pathRaw: string) {
  return pathRaw
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function normalizePathKey(pathRaw: string) {
  return pathSegments(pathRaw).join('/').toLowerCase()
}

export function normalizeAutoFolderPath(pathRaw: string) {
  return pathSegments(pathRaw).join('/')
}

function splitTargetPath(pathRaw: string) {
  const normalized = normalizeAutoFolderPath(pathRaw)
  const segments = pathSegments(normalized)
  const topLevel = segments[0] ?? 'Other'
  const subfolder = segments.length > 1 ? segments.slice(1).join('/') : null
  return { normalized, topLevel, subfolder }
}

function parseHostFromUrl(urlRaw: string) {
  const trimmed = urlRaw.trim()
  if (!trimmed) return null
  const candidates = trimmed.includes('://') ? [trimmed] : [`https://${trimmed}`]
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate)
      return url.hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      // Try candidate fallback.
    }
  }
  return null
}

function getRootDomain(host: string | null) {
  if (!host) return null
  const parts = host.split('.').filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  const suffix = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`
  if (parts.length >= 3 && SECOND_LEVEL_TLDS.has(suffix)) {
    return parts[parts.length - 3]
  }
  return parts[parts.length - 2]
}

function getDomainFromUsername(username: string) {
  const value = username.trim().toLowerCase()
  const at = value.lastIndexOf('@')
  if (at < 0) return null
  const domain = value.slice(at + 1)
  const parsed = parseHostFromUrl(domain)
  if (parsed) return parsed
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return domain.replace(/^www\./, '')
  }
  return null
}

function canonicalProviderLabel(rootRaw: string | null, fallbackProvider?: string) {
  const root = normalizeToken(rootRaw ?? '')
  if (fallbackProvider) return fallbackProvider
  if (!root || GENERIC_PROVIDER_ROOTS.has(root)) return null
  return PROVIDER_ALIAS[root] ?? titleCase(rootRaw ?? '')
}

function applyCustomMappings(
  item: VaultItem,
  host: string | null,
  usernameHost: string | null,
  mappings: AutoFolderCustomMapping[],
) {
  const titleTokens = new Set(tokenize(item.title))
  const tagTokens = new Set(item.tags.flatMap((tag) => tokenize(tag)))
  const roots = new Set([
    normalizeToken(getRootDomain(host) ?? ''),
    normalizeToken(getRootDomain(usernameHost) ?? ''),
  ])

  for (const mapping of mappings) {
    const matchValue = mapping.matchValue.trim()
    const normalizedMatchValue = normalizeToken(matchValue)
    if (!matchValue || !normalizedMatchValue) continue
    if (mapping.matchType === 'domain') {
      const hostMatch = host?.includes(matchValue.toLowerCase()) || usernameHost?.includes(matchValue.toLowerCase())
      if (hostMatch || roots.has(normalizedMatchValue)) {
        return mapping
      }
      continue
    }
    if (mapping.matchType === 'titleToken') {
      if (titleTokens.has(matchValue.toLowerCase()) || titleTokens.has(normalizedMatchValue)) {
        return mapping
      }
      continue
    }
    if (mapping.matchType === 'tag') {
      if (tagTokens.has(matchValue.toLowerCase()) || tagTokens.has(normalizedMatchValue)) {
        return mapping
      }
    }
  }
  return null
}

function classifyItem(
  item: VaultItem,
  customMappings: AutoFolderCustomMapping[],
): Classification {
  const primaryUrl = item.urls[0] ?? ''
  const host = parseHostFromUrl(primaryUrl)
  const usernameHost = getDomainFromUsername(item.username)
  const hostRoot = getRootDomain(host)
  const usernameRoot = getRootDomain(usernameHost)

  const custom = applyCustomMappings(item, host, usernameHost, customMappings)
  if (custom) {
    const customPath = normalizeAutoFolderPath(custom.targetPath)
    const { topLevel } = splitTargetPath(customPath)
    return {
      topLevel: (TOP_LEVEL_FOLDERS.includes(topLevel as TopLevelFolder) ? topLevel : 'Other') as TopLevelFolder,
      providerLabel: null,
      confidence: 12,
      confidenceLevel: 'high',
      reasons: [`custom mapping: ${custom.matchType}:${custom.matchValue}`],
      matchedSignal: `${custom.matchType}:${custom.matchValue}`,
      customPath,
    }
  }

  const scores = new Map<TopLevelFolder, number>()
  for (const folderName of TOP_LEVEL_FOLDERS) {
    if (folderName === 'Other') continue
    scores.set(folderName, 0)
  }

  const reasons: string[] = []
  let providerLabel: string | null = null
  let matchedSignal: string | undefined

  const hostRule = hostRoot ? DOMAIN_RULES[normalizeToken(hostRoot)] : undefined
  if (hostRule) {
    scores.set(hostRule.topLevel, (scores.get(hostRule.topLevel) ?? 0) + 10)
    reasons.push(`domain rule: ${hostRoot}`)
    providerLabel = canonicalProviderLabel(hostRoot, hostRule.provider)
    matchedSignal = hostRoot ?? undefined
  }

  const usernameRule = usernameRoot ? DOMAIN_RULES[normalizeToken(usernameRoot)] : undefined
  if (usernameRule) {
    scores.set(usernameRule.topLevel, (scores.get(usernameRule.topLevel) ?? 0) + 7)
    reasons.push(`username domain rule: ${usernameRoot}`)
    if (!providerLabel) {
      providerLabel = canonicalProviderLabel(usernameRoot, usernameRule.provider)
    }
    if (!matchedSignal) matchedSignal = usernameRoot ?? undefined
  }

  if (!providerLabel) {
    providerLabel = canonicalProviderLabel(hostRoot) ?? canonicalProviderLabel(usernameRoot)
  }

  const contentTokens = [
    ...tokenize(item.title),
    ...tokenize(item.username),
    ...tokenize(item.note),
    ...item.tags.flatMap((tag) => tokenize(tag)),
  ]

  for (const folderName of TOP_LEVEL_FOLDERS) {
    if (folderName === 'Other') continue
    let score = scores.get(folderName) ?? 0
    for (const keyword of TOP_LEVEL_KEYWORDS[folderName]) {
      const token = normalizeToken(keyword)
      if (!token) continue
      if (contentTokens.some((row) => normalizeToken(row) === token)) {
        score += 2
      } else if (contentTokens.some((row) => normalizeToken(row).includes(token) && token.length > 4)) {
        score += 1
      }
      if (host && host.includes(keyword)) {
        score += 3
      }
    }
    scores.set(folderName, score)
  }

  let bestTopLevel: TopLevelFolder = 'Other'
  let bestScore = 0
  for (const [name, score] of scores.entries()) {
    if (score > bestScore) {
      bestTopLevel = name
      bestScore = score
    }
  }

  if (bestScore === 0) {
    reasons.push('fallback: no strong domain/keyword signals')
  } else if (reasons.length === 0) {
    reasons.push('keyword-based classification')
  }

  const confidenceLevel: AutoFolderConfidenceLevel = bestScore >= 9 ? 'high' : bestScore >= 5 ? 'medium' : 'low'
  return {
    topLevel: bestScore > 0 ? bestTopLevel : 'Other',
    providerLabel,
    confidence: bestScore,
    confidenceLevel,
    reasons,
    matchedSignal,
  }
}

function normalizeExistingPathMap(paths: string[]) {
  const map = new Map<string, string>()
  for (const path of paths) {
    const normalized = normalizeAutoFolderPath(path)
    if (!normalized) continue
    const key = normalizePathKey(normalized)
    if (!map.has(key)) {
      map.set(key, normalized)
    }
  }
  return map
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

export function summarizeAutoFolderPlanDraft(params: {
  consideredCount: number
  skippedCount: number
  assignments: AutoFolderAssignment[]
  existingFolderPaths?: string[]
  lockedFolderPaths?: string[]
  conflicts?: string[]
}): AutoFolderPlan {
  const assignments = params.assignments
  const activeAssignments = assignments.filter((row) => !row.excluded && normalizeAutoFolderPath(row.targetPath))
  const excludedItemIds = uniqueSorted(assignments.filter((row) => row.excluded).map((row) => row.itemId))
  const lockedFolderPaths = uniqueSorted((params.lockedFolderPaths ?? []).map((path) => normalizeAutoFolderPath(path)).filter(Boolean))

  const targetPaths = uniqueSorted(activeAssignments.map((row) => normalizeAutoFolderPath(row.targetPath)).filter(Boolean))
  const existingPathMap = normalizeExistingPathMap(params.existingFolderPaths ?? [])
  const newFolderPaths = targetPaths.filter((path) => !existingPathMap.has(normalizePathKey(path)))

  const createdTopLevels = uniqueSorted(targetPaths.map((path) => splitTargetPath(path).topLevel))
  const createdSubfolders = uniqueSorted(targetPaths.filter((path) => pathSegments(path).length > 1))

  const bucketMap = new Map<string, { count: number; subfolders: Map<string, number> }>()
  for (const assignment of activeAssignments) {
    const { topLevel, subfolder } = splitTargetPath(assignment.targetPath)
    const bucket = bucketMap.get(topLevel) ?? { count: 0, subfolders: new Map<string, number>() }
    bucket.count += 1
    if (subfolder) {
      bucket.subfolders.set(subfolder, (bucket.subfolders.get(subfolder) ?? 0) + 1)
    }
    bucketMap.set(topLevel, bucket)
  }

  const buckets: AutoFolderBucketPreview[] = Array.from(bucketMap.entries())
    .map(([topLevel, summary]) => ({
      topLevel,
      count: summary.count,
      subfolders: Array.from(summary.subfolders.entries())
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => (b.count - a.count) || a.topLevel.localeCompare(b.topLevel))

  const lowConfidenceCount = activeAssignments.filter((row) => row.confidenceLevel === 'low').length

  return {
    consideredCount: params.consideredCount,
    skippedCount: params.skippedCount,
    moveCount: activeAssignments.length,
    excludedCount: excludedItemIds.length,
    lowConfidenceCount,
    topLevelCount: createdTopLevels.length,
    subfolderCount: createdSubfolders.length,
    createdTopLevels,
    createdSubfolders,
    newFolderPaths,
    conflicts: uniqueSorted(params.conflicts ?? []),
    excludedItemIds,
    lockedFolderPaths,
    assignments: assignments.slice().sort((a, b) => a.itemTitle.localeCompare(b.itemTitle) || a.itemId.localeCompare(b.itemId)),
    buckets,
  }
}

export function buildAutoFolderPlan(
  items: VaultItem[],
  options: AutoFolderOptions = {},
): AutoFolderPlan {
  const targetMaxTopLevel = Math.max(4, options.targetMaxTopLevel ?? 20)
  const subfolderMinItems = Math.max(2, options.subfolderMinItems ?? 4)
  const maxSubfoldersPerTopLevel = Math.max(1, options.maxSubfoldersPerTopLevel ?? 8)
  const existingPathMap = normalizeExistingPathMap(options.existingFolderPaths ?? [])
  const preferences = options.preferences ?? {}
  const excludedIds = new Set((preferences.excludedItemIds ?? []).map((id) => id.trim()).filter(Boolean))
  const lockedPaths = uniqueSorted((preferences.lockedFolderPaths ?? []).map((path) => normalizeAutoFolderPath(path)).filter(Boolean))
  const lockedByTopLevel = new Map<string, string[]>()
  for (const path of lockedPaths) {
    const { topLevel } = splitTargetPath(path)
    const rows = lockedByTopLevel.get(topLevel) ?? []
    rows.push(path)
    lockedByTopLevel.set(topLevel, rows)
  }

  const customMappings = preferences.customMappings ?? []

  const candidates = items.filter((item) => !item.folderId)
  if (candidates.length === 0) {
    return {
      consideredCount: 0,
      skippedCount: items.length,
      moveCount: 0,
      excludedCount: 0,
      lowConfidenceCount: 0,
      topLevelCount: 0,
      subfolderCount: 0,
      createdTopLevels: [],
      createdSubfolders: [],
      newFolderPaths: [],
      conflicts: [],
      excludedItemIds: [],
      lockedFolderPaths: lockedPaths,
      assignments: [],
      buckets: [],
    }
  }

  const classified = candidates.map((item) => ({
    item,
    classification: classifyItem(item, customMappings),
  }))

  const topLevelCounts = new Map<TopLevelFolder, number>()
  for (const row of classified) {
    const topLevel = row.classification.customPath
      ? splitTargetPath(row.classification.customPath).topLevel as TopLevelFolder
      : row.classification.topLevel
    topLevelCounts.set(topLevel, (topLevelCounts.get(topLevel) ?? 0) + 1)
  }

  const sortableTopLevels = Array.from(topLevelCounts.entries())
    .filter(([name]) => name !== 'Other')
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))

  const keepTopLevels = new Set<TopLevelFolder>(['Other'])
  for (const [name] of sortableTopLevels.slice(0, Math.max(1, targetMaxTopLevel - 1))) {
    keepTopLevels.add(name)
  }
  for (const row of classified) {
    if (row.classification.customPath) {
      const customTopLevel = splitTargetPath(row.classification.customPath).topLevel
      if (TOP_LEVEL_FOLDERS.includes(customTopLevel as TopLevelFolder)) {
        keepTopLevels.add(customTopLevel as TopLevelFolder)
      }
    }
  }

  const providerCountsByTopLevel = new Map<string, Map<string, number>>()
  for (const row of classified) {
    if (row.classification.customPath) continue
    const topLevel = keepTopLevels.has(row.classification.topLevel) ? row.classification.topLevel : 'Other'
    const provider = row.classification.providerLabel
    if (!provider || topLevel === 'Other') continue
    const summary = providerCountsByTopLevel.get(topLevel) ?? new Map<string, number>()
    summary.set(provider, (summary.get(provider) ?? 0) + 1)
    providerCountsByTopLevel.set(topLevel, summary)
  }

  const allowedSubfoldersByTopLevel = new Map<string, Set<string>>()
  for (const [topLevel, providers] of providerCountsByTopLevel.entries()) {
    const sortedCandidates = Array.from(providers.entries())
      .filter(([, count]) => count >= subfolderMinItems)
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .slice(0, maxSubfoldersPerTopLevel)
      .map(([name]) => name)
    if (sortedCandidates.length > 0) {
      allowedSubfoldersByTopLevel.set(topLevel, new Set(sortedCandidates))
    }
  }

  const conflicts: string[] = []
  const assignments: AutoFolderAssignment[] = classified.map((row) => {
    const { item, classification } = row
    const reasons = [...classification.reasons]
    let topLevel = classification.topLevel
    if (!classification.customPath && !keepTopLevels.has(topLevel)) {
      topLevel = 'Other'
      reasons.push('merged into Other to enforce top-level cap')
    }

    let targetPath = classification.customPath
      ? normalizeAutoFolderPath(classification.customPath)
      : topLevel
    let lockedPathApplied = false

    if (!classification.customPath) {
      const allowed = allowedSubfoldersByTopLevel.get(topLevel)
      const candidate = classification.providerLabel ? normalizeAutoFolderPath(classification.providerLabel) : ''
      if (allowed && candidate && allowed.has(candidate)) {
        targetPath = `${topLevel}/${candidate}`
      }

      const lockedCandidates = lockedByTopLevel.get(topLevel) ?? []
      if (classification.confidenceLevel === 'low' && lockedCandidates.length === 1) {
        targetPath = lockedCandidates[0]
        lockedPathApplied = true
        reasons.push(`used locked path for ${topLevel}`)
      }
    } else {
      const split = splitTargetPath(targetPath)
      topLevel = (TOP_LEVEL_FOLDERS.includes(split.topLevel as TopLevelFolder) ? split.topLevel : 'Other') as TopLevelFolder
    }

    const normalizedKey = normalizePathKey(targetPath)
    const canonicalPath = existingPathMap.get(normalizedKey) ?? lockedPaths.find((path) => normalizePathKey(path) === normalizedKey) ?? targetPath
    if (canonicalPath !== targetPath) {
      conflicts.push(`Canonicalized "${targetPath}" to existing path "${canonicalPath}"`)
      targetPath = canonicalPath
    }
    if (lockedPaths.some((path) => normalizePathKey(path) === normalizePathKey(targetPath))) {
      lockedPathApplied = true
    }

    const splitPath = splitTargetPath(targetPath)
    return {
      itemId: item.id,
      itemTitle: item.title || 'Untitled',
      primaryUrl: item.urls[0] ?? '',
      topLevel: splitPath.topLevel,
      subfolder: splitPath.subfolder,
      targetPath,
      confidence: classification.confidence,
      confidenceLevel: classification.confidenceLevel,
      reasons,
      matchedSignal: classification.matchedSignal,
      lockedPathApplied,
      overridden: false,
      excluded: excludedIds.has(item.id),
    }
  })

  return summarizeAutoFolderPlanDraft({
    consideredCount: candidates.length,
    skippedCount: items.length - candidates.length,
    assignments,
    existingFolderPaths: options.existingFolderPaths ?? [],
    lockedFolderPaths: lockedPaths,
    conflicts,
  })
}
