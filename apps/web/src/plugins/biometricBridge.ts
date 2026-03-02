import { registerPlugin } from '@capacitor/core'

export interface BiometricStatusResult {
  available: boolean
  enrolled: boolean
  canAuthenticate: boolean
  reason: string
}

export interface WrapVaultKeyResult {
  keyAlias: string
  ivBase64: string
  ciphertextBase64: string
}

export interface BiometricBridgePlugin {
  getStatus(): Promise<BiometricStatusResult>
  wrapVaultKey(options: { rawVaultKeyBase64: string; keyAlias?: string }): Promise<WrapVaultKeyResult>
  unwrapVaultKey(options: { keyAlias: string; ivBase64: string; ciphertextBase64: string }): Promise<{ rawVaultKeyBase64: string }>
}

const BiometricBridge = registerPlugin<BiometricBridgePlugin>('BiometricBridge')

export default BiometricBridge
