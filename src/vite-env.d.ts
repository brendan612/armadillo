/// <reference types="vite/client" />

declare global {
  interface Window {
    armadilloShell?: {
      isElectron: boolean
      platform: string
    }
  }
}

export {}
