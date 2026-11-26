import { localizeError, translate, type StringKey } from './i18n'
import { useStore } from './store'

export function useT() {
  const lang = useStore(s => s.lang)
  return {
    lang,
    t: (key: StringKey, params?: Record<string, string | number>) => translate(lang, key, params),
    te: (message: string) => localizeError(lang, message)
  }
}
