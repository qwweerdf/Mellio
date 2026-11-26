import type { MellioApi } from '../../../shared/types'

declare global {
  interface Window {
    api: MellioApi
  }
}

export {}
