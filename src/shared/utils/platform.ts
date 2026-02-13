import { Capacitor } from '@capacitor/core'
import type { AppPlatform } from '../../app/types/app'

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function getAutoPlatform(): AppPlatform {
  if (window.armadilloShell?.isElectron) return 'desktop'
  if (isNativeAndroid()) return 'mobile'
  if (window.matchMedia('(max-width: 900px)').matches) return 'mobile'
  return 'web'
}
