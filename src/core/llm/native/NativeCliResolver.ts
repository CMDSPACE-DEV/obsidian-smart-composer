import { Platform } from 'obsidian'

import type {
  NativeRuntimeInstallMethod,
  NativeRuntimeProvider,
  RuntimeDiscovery,
  RuntimeExecutableCandidate,
} from './nativeRuntime.types'
import { NativeRuntimePathStore } from './NativeRuntimePathStore'
import { requireNode } from './nodeRuntime'

type FsModule = typeof import('fs')
type OsModule = typeof import('os')
type PathModule = typeof import('path')

type CandidateSpec = RuntimeExecutableCandidate & { priority: number }

export type NativeCliResolverOptions = {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  fs?: FsModule
  path?: PathModule
}

/**
 * Claude candidate locations are adapted from Claudian 2.0.41 (MIT).
 * See THIRD_PARTY_NOTICES.md and R-023 for exact source provenance.
 */
export class NativeCliResolver {
  constructor(
    private readonly pathStore: NativeRuntimePathStore = new NativeRuntimePathStore(),
    private readonly options: NativeCliResolverOptions = {},
  ) {}

  resolve(provider: NativeRuntimeProvider): string | null {
    return this.discover(provider).selectedPath ?? null
  }

  discover(provider: NativeRuntimeProvider): RuntimeDiscovery {
    if (!Platform.isDesktop) return emptyDiscovery(provider)

    const fs = this.options.fs ?? requireNode<FsModule>('fs')
    const os = requireNode<OsModule>('os')
    const path = this.options.path ?? requireNode<PathModule>('path')
    const platform = this.options.platform ?? process.platform
    const env = this.options.env ?? process.env
    const home = this.options.home ?? os.homedir()
    const specs: CandidateSpec[] = []
    const customPath = this.pathStore.get(provider)

    if (customPath && isFile(fs, customPath)) {
      specs.push(
        candidateSpec(customPath, 'custom', 'device-local custom path', 0),
      )
    }

    specs.push(
      ...(provider === 'claude'
        ? claudeCandidates(platform, home, env, path)
        : antigravityCandidates(platform, home, env, path)),
    )

    const executableNames =
      provider === 'claude'
        ? platform === 'win32'
          ? ['claude.exe', 'claude']
          : ['claude']
        : platform === 'win32'
          ? ['agy.exe', 'agy']
          : ['agy']
    for (const entry of (env.PATH ?? '')
      .split(path.delimiter)
      .map((value) => value.trim())
      .filter(Boolean)) {
      for (const executableName of executableNames) {
        specs.push(
          candidateSpec(
            path.join(entry, executableName),
            'path',
            'inherited PATH entry',
            50,
          ),
        )
      }
    }

    const candidates = dedupeExistingCandidates(specs, fs, path, platform)
    const selected = candidates[0]
    return {
      provider,
      selectedPath: selected?.path,
      selectedMethod: selected?.method ?? 'unknown',
      candidates: candidates.map(
        ({ priority: _priority, ...candidate }) => candidate,
      ),
      ambiguous: candidates.length > 1,
    }
  }

  setCustomPath(provider: NativeRuntimeProvider, executablePath: string): void {
    this.pathStore.set(provider, executablePath)
  }

  getCustomPath(provider: NativeRuntimeProvider): string {
    return this.pathStore.get(provider) ?? ''
  }
}

function claudeCandidates(
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv,
  path: PathModule,
): CandidateSpec[] {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
    const programFilesX86 =
      env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    return [
      candidateSpec(
        path.join(home, '.local', 'bin', 'claude.exe'),
        'native',
        'Anthropic native installer path',
        10,
      ),
      candidateSpec(
        path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
        'winget',
        'WinGet user Links path',
        20,
      ),
      candidateSpec(
        path.join(programFiles, 'WinGet', 'Links', 'claude.exe'),
        'winget',
        'WinGet machine Links path',
        21,
      ),
      candidateSpec(
        path.join(home, '.claude', 'local', 'claude.exe'),
        'legacy',
        'legacy Claude installer path',
        30,
      ),
      candidateSpec(
        path.join(localAppData, 'Claude', 'claude.exe'),
        'legacy',
        'legacy local application path',
        31,
      ),
      candidateSpec(
        path.join(programFiles, 'Claude', 'claude.exe'),
        'legacy',
        'legacy Program Files path',
        32,
      ),
      candidateSpec(
        path.join(programFilesX86, 'Claude', 'claude.exe'),
        'legacy',
        'legacy x86 Program Files path',
        33,
      ),
    ]
  }

  const candidates = [
    candidateSpec(
      path.join(home, '.local', 'bin', 'claude'),
      'native',
      'Anthropic native installer path',
      10,
    ),
  ]
  if (platform === 'darwin') {
    candidates.push(
      candidateSpec(
        '/opt/homebrew/bin/claude',
        'homebrew',
        'Homebrew Apple Silicon prefix',
        20,
      ),
      candidateSpec(
        '/usr/local/bin/claude',
        'homebrew',
        'Homebrew Intel prefix',
        21,
      ),
    )
  }
  candidates.push(
    candidateSpec(
      path.join(home, '.claude', 'local', 'claude'),
      'legacy',
      'legacy Claude installer path',
      30,
    ),
    candidateSpec(
      path.join(home, '.volta', 'bin', 'claude'),
      'legacy',
      'Volta-managed executable',
      31,
    ),
    candidateSpec(
      path.join(home, '.asdf', 'shims', 'claude'),
      'legacy',
      'asdf shim',
      32,
    ),
    candidateSpec(
      path.join(home, '.npm-global', 'bin', 'claude'),
      'legacy',
      'legacy npm global path',
      33,
    ),
    candidateSpec('/usr/bin/claude', 'legacy', 'system executable path', 34),
  )
  return candidates
}

function antigravityCandidates(
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv,
  path: PathModule,
): CandidateSpec[] {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
    return [
      candidateSpec(
        path.join(localAppData, 'agy', 'bin', 'agy.exe'),
        'native',
        'Google Antigravity native installer path',
        10,
      ),
      candidateSpec(
        path.join(home, '.local', 'bin', 'agy.exe'),
        'native',
        'portable native installer path',
        11,
      ),
      candidateSpec(
        path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy.exe'),
        'legacy',
        'legacy Antigravity path',
        30,
      ),
      candidateSpec(
        path.join(localAppData, 'Antigravity', 'bin', 'agy.exe'),
        'legacy',
        'legacy local application path',
        31,
      ),
      candidateSpec(
        path.join(localAppData, 'Programs', 'Antigravity', 'agy.exe'),
        'legacy',
        'legacy local Programs path',
        32,
      ),
      candidateSpec(
        path.join(localAppData, 'Google', 'Antigravity', 'agy.exe'),
        'legacy',
        'legacy Google application path',
        33,
      ),
      candidateSpec(
        path.join(programFiles, 'Antigravity', 'agy.exe'),
        'legacy',
        'legacy Program Files path',
        34,
      ),
    ]
  }

  return [
    candidateSpec(
      path.join(home, '.local', 'bin', 'agy'),
      'native',
      'Google Antigravity native installer path',
      10,
    ),
    candidateSpec(
      path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy'),
      'legacy',
      'legacy Antigravity path',
      30,
    ),
    candidateSpec(
      '/opt/homebrew/bin/agy',
      'legacy',
      'legacy Homebrew prefix path',
      31,
    ),
    candidateSpec(
      '/usr/local/bin/agy',
      'legacy',
      'legacy local prefix path',
      32,
    ),
    candidateSpec('/usr/bin/agy', 'legacy', 'system executable path', 33),
  ]
}

function candidateSpec(
  path: string,
  method: NativeRuntimeInstallMethod,
  evidence: string,
  priority: number,
): CandidateSpec {
  return { path, canonicalPath: path, method, evidence: [evidence], priority }
}

function dedupeExistingCandidates(
  specs: CandidateSpec[],
  fs: FsModule,
  path: PathModule,
  platform: NodeJS.Platform,
): CandidateSpec[] {
  const candidates = new Map<string, CandidateSpec>()
  for (const spec of specs) {
    if (!isFile(fs, spec.path)) continue
    const canonicalPath = canonicalize(fs, path, spec.path)
    const key =
      platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath
    const existing = candidates.get(key)
    if (!existing) {
      candidates.set(key, { ...spec, canonicalPath })
      continue
    }
    existing.evidence = [...new Set([...existing.evidence, ...spec.evidence])]
    if (spec.priority < existing.priority) {
      existing.path = spec.path
      existing.method = spec.method
      existing.priority = spec.priority
    }
  }
  return [...candidates.values()].sort((a, b) => a.priority - b.priority)
}

function canonicalize(
  fs: FsModule,
  path: PathModule,
  candidate: string,
): string {
  try {
    return fs.realpathSync(candidate)
  } catch {
    return path.resolve(candidate)
  }
}

function emptyDiscovery(provider: NativeRuntimeProvider): RuntimeDiscovery {
  return {
    provider,
    selectedMethod: 'unknown',
    candidates: [],
    ambiguous: false,
  }
}

function isFile(fs: FsModule, candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}
