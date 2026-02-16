import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// https://vite.dev/config/
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }
const appVersion = (packageJson.version || '0.0.0').trim() || '0.0.0'
const buildSha = (process.env.GITHUB_SHA || process.env.VITE_GIT_SHA || 'local').trim() || 'local'
const buildTime = new Date().toISOString()

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_SHA__: JSON.stringify(buildSha),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    allowedHosts: ['b8b0-97-120-96-142.ngrok-free.app'],
  },
})
