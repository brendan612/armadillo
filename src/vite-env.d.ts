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
    onOAuthCallback?: (callback: (url: string) => void) => (() => void) | void
  }
}
}

export {}
