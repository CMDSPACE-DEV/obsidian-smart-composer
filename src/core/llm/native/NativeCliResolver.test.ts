jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { NativeCliResolver } from './NativeCliResolver'
import { NativeRuntimePathStore } from './NativeRuntimePathStore'

describe('NativeCliResolver discovery inventory', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'smtcmp-resolver-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('finds WinGet Links even when the running Obsidian PATH is stale', () => {
    const home = path.join(root, 'home')
    const localAppData = path.join(root, 'local-app-data')
    const executable = path.join(
      localAppData,
      'Microsoft',
      'WinGet',
      'Links',
      'claude.exe',
    )
    createExecutable(executable)
    const resolver = new NativeCliResolver(undefined, {
      platform: 'win32',
      home,
      env: { LOCALAPPDATA: localAppData, PATH: '' },
    })

    expect(resolver.discover('claude')).toMatchObject({
      selectedPath: executable,
      selectedMethod: 'winget',
      ambiguous: false,
      candidates: [
        expect.objectContaining({
          path: executable,
          method: 'winget',
          evidence: ['WinGet user Links path'],
        }),
      ],
    })
  })

  it('prefers native over WinGet but reports both installations as ambiguous', () => {
    const home = path.join(root, 'home')
    const localAppData = path.join(root, 'local-app-data')
    const nativePath = path.join(home, '.local', 'bin', 'claude.exe')
    const wingetPath = path.join(
      localAppData,
      'Microsoft',
      'WinGet',
      'Links',
      'claude.exe',
    )
    createExecutable(nativePath)
    createExecutable(wingetPath)
    const resolver = new NativeCliResolver(undefined, {
      platform: 'win32',
      home,
      env: { LOCALAPPDATA: localAppData, PATH: '' },
    })

    const discovery = resolver.discover('claude')
    expect(discovery.selectedPath).toBe(nativePath)
    expect(discovery.selectedMethod).toBe('native')
    expect(discovery.ambiguous).toBe(true)
    expect(discovery.candidates.map((candidate) => candidate.method)).toEqual([
      'native',
      'winget',
    ])
  })

  it('gives a valid device-local custom path highest priority', () => {
    const home = path.join(root, 'home')
    const nativePath = path.join(home, '.local', 'bin', 'claude.exe')
    const customPath = path.join(root, 'custom', 'claude.exe')
    createExecutable(nativePath)
    createExecutable(customPath)
    const pathStore = {
      get: () => customPath,
      set: jest.fn(),
    } as unknown as NativeRuntimePathStore
    const resolver = new NativeCliResolver(pathStore, {
      platform: 'win32',
      home,
      env: { PATH: '' },
    })

    const discovery = resolver.discover('claude')
    expect(discovery.selectedPath).toBe(customPath)
    expect(discovery.selectedMethod).toBe('custom')
    expect(discovery.ambiguous).toBe(true)
  })

  it('recognizes Apple Silicon and Intel Homebrew Claude paths', () => {
    const fakeFs = {
      existsSync: (candidate: fs.PathLike) =>
        ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'].includes(
          String(candidate),
        ),
      statSync: () => ({ isFile: () => true }),
      realpathSync: (candidate: fs.PathLike) => String(candidate),
    } as unknown as typeof fs
    const resolver = new NativeCliResolver(undefined, {
      platform: 'darwin',
      home: '/Users/test',
      env: { PATH: '' },
      fs: fakeFs,
      path,
    })

    const discovery = resolver.discover('claude')
    expect(discovery.selectedMethod).toBe('homebrew')
    expect(discovery.ambiguous).toBe(true)
    expect(discovery.candidates).toEqual([
      expect.objectContaining({ path: '/opt/homebrew/bin/claude' }),
      expect.objectContaining({ path: '/usr/local/bin/claude' }),
    ])
  })
})

function createExecutable(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, '')
}
