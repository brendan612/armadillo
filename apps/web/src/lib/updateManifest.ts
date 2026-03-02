export type UpdateChannel = 'production' | 'fastlane-android'

export type UpdateStatus = 'up_to_date' | 'available' | 'required' | 'unavailable'

export type UpdateManifest = {
  generatedAt: string
  policy: 'n-1'
  production: {
    latestVersion: string
    minimumSupportedVersion: string
  }
  android?: {
    fastlane?: {
      latestBuild: string
      releaseNotesUrl?: string | null
      installUrl?: string | null
    }
  }
  critical?: boolean
  forceBy?: string | null
}

export type AppBuildInfo = {
  version: string
  channel: UpdateChannel
  manifestUrl: string
  commit: string
  builtAt: string
}

export type UpdateCheckResult = {
  status: UpdateStatus
  checkedAt: string | null
  currentVersion: string
  latestVersion: string | null
  minimumSupportedVersion: string | null
  policy: string
  critical: boolean
  forceBy: string | null
  installUrl: string | null
  releaseNotesUrl: string | null
  message: string
  error: string | null
}

type ParsedVersion = {
  major: number
  minor: number
  patch: number
  prerelease: Array<number | string> | null
}

function parsePrereleaseSegment(value: string) {
  if (/^[0-9]+$/.test(value)) return Number(value)
  return value.toLowerCase()
}

function parseVersion(rawValue: string): ParsedVersion | null {
  const value = rawValue.trim().replace(/^v/i, '')
  const match = value.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (![major, minor, patch].every(Number.isFinite)) return null
  const prerelease = match[4]
    ? match[4]
      .split('.')
      .filter(Boolean)
      .map(parsePrereleaseSegment)
    : null
  return { major, minor, patch, prerelease }
}

function compareIdentifiers(a: number | string, b: number | string) {
  const aNum = typeof a === 'number'
  const bNum = typeof b === 'number'
  if (aNum && bNum) return a - b
  if (aNum && !bNum) return -1
  if (!aNum && bNum) return 1
  return String(a).localeCompare(String(b))
}

function compareSemver(a: string, b: string) {
  const parsedA = parseVersion(a)
  const parsedB = parseVersion(b)
  if (!parsedA || !parsedB) return null

  if (parsedA.major !== parsedB.major) return parsedA.major > parsedB.major ? 1 : -1
  if (parsedA.minor !== parsedB.minor) return parsedA.minor > parsedB.minor ? 1 : -1
  if (parsedA.patch !== parsedB.patch) return parsedA.patch > parsedB.patch ? 1 : -1

  const preA = parsedA.prerelease
  const preB = parsedB.prerelease
  if (!preA && !preB) return 0
  if (!preA) return 1
  if (!preB) return -1

  const max = Math.max(preA.length, preB.length)
  for (let index = 0; index < max; index += 1) {
    if (index >= preA.length) return -1
    if (index >= preB.length) return 1
    const compared = compareIdentifiers(preA[index], preB[index])
    if (compared !== 0) return compared > 0 ? 1 : -1
  }
  return 0
}

function normalizeManifest(data: unknown): UpdateManifest {
  if (!data || typeof data !== 'object') {
    throw new Error('Update manifest is not an object')
  }
  const source = data as Record<string, unknown>
  const production = source.production as Record<string, unknown> | undefined
  const android = source.android as Record<string, unknown> | undefined
  const fastlane = android?.fastlane as Record<string, unknown> | undefined

  const generatedAt = typeof source.generatedAt === 'string' ? source.generatedAt : new Date().toISOString()
  const policy = source.policy === 'n-1' ? 'n-1' : 'n-1'
  const latestVersion = typeof production?.latestVersion === 'string' ? production.latestVersion : ''
  const minimumSupportedVersion = typeof production?.minimumSupportedVersion === 'string'
    ? production.minimumSupportedVersion
    : latestVersion

  if (!latestVersion || !minimumSupportedVersion) {
    throw new Error('Update manifest is missing production version fields')
  }

  return {
    generatedAt,
    policy,
    production: {
      latestVersion,
      minimumSupportedVersion,
    },
    android: fastlane
      ? {
        fastlane: {
          latestBuild: typeof fastlane.latestBuild === 'string' ? fastlane.latestBuild : '',
          releaseNotesUrl: typeof fastlane.releaseNotesUrl === 'string' ? fastlane.releaseNotesUrl : null,
          installUrl: typeof fastlane.installUrl === 'string' ? fastlane.installUrl : null,
        },
      }
      : undefined,
    critical: source.critical === true,
    forceBy: typeof source.forceBy === 'string' ? source.forceBy : null,
  }
}

function normalizeChannel(value: string | undefined): UpdateChannel {
  if ((value || '').trim().toLowerCase() === 'fastlane-android') return 'fastlane-android'
  return 'production'
}

function normalizeManifestUrl(value: string | undefined) {
  return (value || '').trim() || './update-manifest.json'
}

export function getAppBuildInfo(): AppBuildInfo {
  return {
    version: __APP_VERSION__,
    channel: normalizeChannel(import.meta.env.VITE_UPDATE_CHANNEL),
    manifestUrl: normalizeManifestUrl(import.meta.env.VITE_UPDATE_MANIFEST_URL),
    commit: __APP_BUILD_SHA__,
    builtAt: __APP_BUILD_TIME__,
  }
}

export function defaultUpdateCheckResult(buildInfo: AppBuildInfo): UpdateCheckResult {
  return {
    status: 'unavailable',
    checkedAt: null,
    currentVersion: buildInfo.version,
    latestVersion: null,
    minimumSupportedVersion: null,
    policy: 'n-1',
    critical: false,
    forceBy: null,
    installUrl: null,
    releaseNotesUrl: null,
    message: 'Update status has not been checked yet',
    error: null,
  }
}

export async function fetchUpdateManifest(url: string) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Manifest request failed (${response.status})`)
  }
  const data = await response.json()
  return normalizeManifest(data)
}

export function evaluateUpdateStatus(manifest: UpdateManifest, buildInfo: AppBuildInfo): UpdateCheckResult {
  const checkedAt = new Date().toISOString()
  const isProduction = buildInfo.channel === 'production'
  const latestVersion = isProduction
    ? manifest.production.latestVersion
    : (manifest.android?.fastlane?.latestBuild || manifest.production.latestVersion)
  const minimumSupportedVersion = isProduction ? manifest.production.minimumSupportedVersion : null

  const latestCompared = compareSemver(buildInfo.version, latestVersion)
  const minimumCompared = minimumSupportedVersion ? compareSemver(buildInfo.version, minimumSupportedVersion) : null
  const isCritical = manifest.critical === true
  const forceBy = manifest.forceBy ?? null

  if (latestCompared === null || (minimumSupportedVersion && minimumCompared === null)) {
    return {
      status: 'unavailable',
      checkedAt,
      currentVersion: buildInfo.version,
      latestVersion,
      minimumSupportedVersion,
      policy: manifest.policy,
      critical: isCritical,
      forceBy,
      installUrl: manifest.android?.fastlane?.installUrl ?? null,
      releaseNotesUrl: manifest.android?.fastlane?.releaseNotesUrl ?? null,
      message: 'Update manifest is present but version fields are not semver-compliant',
      error: 'invalid-semver',
    }
  }

  if (isProduction && minimumSupportedVersion && minimumCompared !== null && minimumCompared < 0) {
    return {
      status: 'required',
      checkedAt,
      currentVersion: buildInfo.version,
      latestVersion,
      minimumSupportedVersion,
      policy: manifest.policy,
      critical: isCritical,
      forceBy,
      installUrl: manifest.android?.fastlane?.installUrl ?? null,
      releaseNotesUrl: manifest.android?.fastlane?.releaseNotesUrl ?? null,
      message: forceBy
        ? `Update required before ${new Date(forceBy).toLocaleString()}`
        : 'Update required to continue using this release channel',
      error: null,
    }
  }

  if (latestCompared !== null && latestCompared < 0) {
    return {
      status: 'available',
      checkedAt,
      currentVersion: buildInfo.version,
      latestVersion,
      minimumSupportedVersion,
      policy: manifest.policy,
      critical: isCritical,
      forceBy,
      installUrl: manifest.android?.fastlane?.installUrl ?? null,
      releaseNotesUrl: manifest.android?.fastlane?.releaseNotesUrl ?? null,
      message: isCritical
        ? 'A critical update is available'
        : 'A newer app build is available',
      error: null,
    }
  }

  return {
    status: 'up_to_date',
    checkedAt,
    currentVersion: buildInfo.version,
    latestVersion,
    minimumSupportedVersion,
    policy: manifest.policy,
    critical: isCritical,
    forceBy,
    installUrl: manifest.android?.fastlane?.installUrl ?? null,
    releaseNotesUrl: manifest.android?.fastlane?.releaseNotesUrl ?? null,
    message: 'You are on the latest supported app build',
    error: null,
  }
}
