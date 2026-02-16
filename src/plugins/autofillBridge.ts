import { registerPlugin } from '@capacitor/core'

export interface AutofillCredentialDTO {
  id: string
  title: string
  username: string
  password: string
  urls: string[]
  linkedAndroidPackages?: string[]
}

export interface CapturedCredentialDTO {
  id: string
  title: string
  username: string
  password: string
  urls: string[]
  linkedAndroidPackages?: string[]
  packageName?: string
  webDomain?: string
  capturedAt?: number
}

export interface AutofillBridgePlugin {
  syncCredentials(options: { credentials: AutofillCredentialDTO[] }): Promise<{ success: boolean; count: number }>
  consumeCapturedCredentials(): Promise<{ captures: CapturedCredentialDTO[]; count: number }>
  clearCredentials(): Promise<{ success: boolean }>
  isAutofillServiceEnabled(): Promise<{ enabled: boolean; supported: boolean }>
  openAutofillSettings(): Promise<void>
}

const AutofillBridge = registerPlugin<AutofillBridgePlugin>('AutofillBridge')

export default AutofillBridge
