/* eslint-disable @typescript-eslint/no-unused-vars */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UPDATE_MANIFEST_URL?: string
  readonly VITE_UPDATE_CHANNEL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
const __APP_VERSION__: string
const __APP_BUILD_SHA__: string
const __APP_BUILD_TIME__: string
interface Window {
  armadilloShell?: {
    isElectron: boolean
    platform: string
    getDefaultVaultPath?: () => string
    readVaultFile?: (path?: string) => string | null
    writeVaultFile?: (contents: string, path?: string) => boolean
    deleteVaultFile?: (path?: string) => boolean
    chooseVaultSavePath?: (currentPath?: string) => Promise<string | null>
    openExternal?: (url: string) => Promise<void>
    getOAuthCallbackUrl?: () => Promise<string>
    autofillCredentials?: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
    minimizeWindow?: () => Promise<boolean>
    toggleMaximizeWindow?: () => Promise<boolean>
    isWindowMaximized?: () => Promise<boolean>
    closeWindow?: () => Promise<boolean>
    onWindowMaximizedChanged?: (callback: (maximized: boolean) => void) => (() => void) | void
    onOAuthCallback?: (callback: (url: string) => void) => (() => void) | void
  }
}
}

export {}
