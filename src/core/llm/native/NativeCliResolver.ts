import { Platform } from 'obsidian'

import { NativeRuntimeProvider } from './nativeRuntime.types'
import { NativeRuntimePathStore } from './NativeRuntimePathStore'
import { requireNode } from './nodeRuntime'

type FsModule = typeof import('fs')
type OsModule = typeof import('os')
type PathModule = typeof import('path')

/**
 * Claude candidate locations are adapted from Claudian 2.0.41 (MIT).
 * See THIRD_PARTY_NOTICES.md and R-023 for exact source provenance.
 */
export class NativeCliResolver {
  constructor(
    private readonly pathStore: NativeRuntimePathStore = new NativeRuntimePathStore(),
  ) {}

  resolve(provider: NativeRuntimeProvider): string | null {
    if (!Platform.isDesktop) return null

    const fs = requireNode<FsModule>('fs')
    const customPath = this.pathStore.get(provider)
    if (customPath && isFile(fs, customPath)) {
      return customPath
    }

    const os = requireNode<OsModule>('os')
    const path = requireNode<PathModule>('path')
    const candidates =
      provider === 'claude'
        ? claudeCandidates(os.homedir(), path)
        : antigravityCandidates(os.homedir(), path)

    for (const candidate of candidates) {
      if (isFile(fs, candidate)) return candidate
    }

    const executableNames =
      provider === 'claude'
        ? process.platform === 'win32'
          ? ['claude.exe', 'claude']
          : ['claude']
        : process.platform === 'win32'
          ? ['agy.exe', 'agy']
          : ['agy']
    const pathEntries = (process.env.PATH ?? '')
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)

    for (const entry of pathEntries) {
      for (const executableName of executableNames) {
        const candidate = path.join(entry, executableName)
        if (isFile(fs, candidate)) return candidate
      }
    }

    return null
  }

  setCustomPath(provider: NativeRuntimeProvider, executablePath: string): void {
    this.pathStore.set(provider, executablePath)
  }

  getCustomPath(provider: NativeRuntimeProvider): string {
    return this.pathStore.get(provider) ?? ''
  }
}

function claudeCandidates(home: string, path: PathModule): string[] {
  if (process.platform === 'win32') {
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    const programFilesX86 =
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    return [
      path.join(home, '.claude', 'local', 'claude.exe'),
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(localAppData, 'Claude', 'claude.exe'),
      path.join(programFiles, 'Claude', 'claude.exe'),
      path.join(programFilesX86, 'Claude', 'claude.exe'),
    ]
  }

  return [
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.volta', 'bin', 'claude'),
    path.join(home, '.asdf', 'shims', 'claude'),
    path.join(home, '.npm-global', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ]
}

function antigravityCandidates(home: string, path: PathModule): string[] {
  if (process.platform === 'win32') {
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    return [
      path.join(home, '.local', 'bin', 'agy.exe'),
      path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy.exe'),
      path.join(localAppData, 'agy', 'bin', 'agy.exe'),
      path.join(localAppData, 'Antigravity', 'bin', 'agy.exe'),
      path.join(localAppData, 'Programs', 'Antigravity', 'agy.exe'),
      path.join(localAppData, 'Google', 'Antigravity', 'agy.exe'),
      path.join(programFiles, 'Antigravity', 'agy.exe'),
    ]
  }

  return [
    path.join(home, '.local', 'bin', 'agy'),
    path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy'),
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
    '/usr/bin/agy',
  ]
}

function isFile(fs: FsModule, candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}
