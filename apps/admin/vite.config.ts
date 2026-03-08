import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string }
const appVersion = (packageJson.version || '0.0.0').trim() || '0.0.0'

export default defineConfig({
  base: './',
  envDir: '../../',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_SURFACE__: JSON.stringify('admin'),
  },
})
