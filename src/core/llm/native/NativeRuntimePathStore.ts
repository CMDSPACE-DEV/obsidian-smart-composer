import { NativeRuntimeProvider } from './nativeRuntime.types'

const STORAGE_PREFIX = 'smart-composer:native-runtime-path'

export class NativeRuntimePathStore {
  get(provider: NativeRuntimeProvider): string | undefined {
    try {
      return localStorage.getItem(`${STORAGE_PREFIX}:${provider}`) ?? undefined
    } catch {
      return undefined
    }
  }

  set(provider: NativeRuntimeProvider, executablePath: string): void {
    try {
      const key = `${STORAGE_PREFIX}:${provider}`
      const normalized = executablePath.trim()
      if (normalized) {
        localStorage.setItem(key, normalized)
      } else {
        localStorage.removeItem(key)
      }
    } catch {
      // A custom path is an optional device-local convenience.
    }
  }
}
