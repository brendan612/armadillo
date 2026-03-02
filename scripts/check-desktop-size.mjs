import { execFileSync } from 'node:child_process'
import { existsSync, statSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const mode = process.argv.includes('--report') ? 'report' : 'check'
const repoRoot = process.cwd()
const releaseRoot = path.join(repoRoot, 'release', 'win-unpacked')
const asarPath = path.join(releaseRoot, 'resources', 'app.asar')
const maxMb = Number.parseFloat(process.env.ARMADILLO_MAX_DESKTOP_MB ?? '320')
const maxBytes = Math.round(maxMb * 1024 * 1024)
const require = createRequire(import.meta.url)

function readAllFiles(dirPath) {
  const entries = readdirSync(dirPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...readAllFiles(absolutePath))
      continue
    }
    if (entry.isFile()) {
      const size = statSync(absolutePath).size
      files.push({ absolutePath, size })
    }
  }
  return files
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function listAsarEntries(filePath) {
  try {
    const asar = require('@electron/asar')
    return asar.listPackage(filePath)
      .map((entry) => entry.trim())
      .filter(Boolean)
  } catch {
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const output = execFileSync(npxCmd, ['asar', 'list', filePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 1024 * 1024 * 64,
    })
    return output
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
  }
}

if (!existsSync(releaseRoot)) {
  console.error(`Missing desktop package directory: ${releaseRoot}`)
  process.exit(1)
}

if (!existsSync(asarPath)) {
  console.error(`Missing desktop ASAR: ${asarPath}`)
  process.exit(1)
}

const files = readAllFiles(releaseRoot)
const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
const topFiles = [...files]
  .sort((a, b) => b.size - a.size)
  .slice(0, 20)

const asarEntries = listAsarEntries(asarPath)
const nodeModulesEntries = asarEntries.filter((entry) => /(^|[\\/])node_modules([\\/]|$)/i.test(entry))

console.log(`Desktop package path: ${releaseRoot}`)
console.log(`Desktop package size: ${formatMb(totalBytes)}`)
console.log(`Size guardrail: ${maxMb.toFixed(2)} MB`)
console.log(`ASAR node_modules entry count: ${nodeModulesEntries.length}`)
console.log('')
console.log('Top 20 largest packaged files:')
for (const file of topFiles) {
  const relPath = path.relative(repoRoot, file.absolutePath).replace(/\\/g, '/')
  console.log(`- ${formatMb(file.size)}\t${relPath}`)
}

if (mode === 'report') {
  process.exit(0)
}

let failed = false

if (nodeModulesEntries.length > 0) {
  failed = true
  console.error('')
  console.error('Desktop size check failed: app.asar still contains node_modules entries.')
  for (const entry of nodeModulesEntries.slice(0, 10)) {
    console.error(`- ${entry}`)
  }
  if (nodeModulesEntries.length > 10) {
    console.error(`- ...and ${nodeModulesEntries.length - 10} more`)
  }
}

if (totalBytes > maxBytes) {
  failed = true
  console.error('')
  console.error(`Desktop size check failed: ${formatMb(totalBytes)} exceeds ${maxMb.toFixed(2)} MB.`)
}

if (failed) {
  process.exit(1)
}

console.log('')
console.log('Desktop size check passed.')
