import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const source = resolve('android', 'app', 'build', 'outputs', 'apk', 'production', 'debug', 'app-production-debug.apk')
const target = resolve('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')

if (!existsSync(source)) {
  console.error(`Source APK not found: ${source}`)
  process.exit(1)
}

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)

console.log(`Aliased debug APK:\n  ${source}\n-> ${target}`)
