import type { AppPlatform } from '../../app/types/app'

export function getAutoPlatform(): AppPlatform {
  if (window.armadilloShell?.isElectron) return 'desktop'
  if (window.matchMedia('(max-width: 900px)').matches) return 'mobile'
  return 'web'
}
