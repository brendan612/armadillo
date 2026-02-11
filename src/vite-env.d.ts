/// <reference types="vite/client" />

declare global {
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
