const mockUnref = jest.fn()
const mockSpawn = jest.fn(
  (
    _executable: string,
    _args: string[],
    _options: Record<string, unknown>,
  ) => ({ unref: mockUnref }),
)

jest.mock('./nodeRuntime', () => ({
  requireNode: () => ({ spawn: mockSpawn }),
}))

import { launchVisibleTerminal } from './NativeProcess'

function latestSpawnCall(): [string, string[], Record<string, unknown>] {
  const call = mockSpawn.mock.calls.at(-1)
  if (!call) throw new Error('Expected a terminal process to be spawned.')
  return call
}

describe('launchVisibleTerminal on Windows', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })

  afterAll(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  beforeEach(() => {
    mockSpawn.mockClear()
    mockUnref.mockClear()
  })

  it('opens a separate visible PowerShell window', () => {
    launchVisibleTerminal('', 'powershell')

    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd.exe',
      [
        '/d',
        '/s',
        '/c',
        'start',
        '',
        'powershell.exe',
        '-NoExit',
        '-NoProfile',
      ],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      }),
    )
    expect(mockUnref).toHaveBeenCalled()
  })

  it('opens a separate visible Command Prompt window', () => {
    launchVisibleTerminal('', 'cmd')

    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/s', '/c', 'start', '', 'cmd.exe', '/d', '/k'],
      expect.any(Object),
    )
  })

  it('starts an update-check terminal outside the active vault directory', () => {
    const command = "& 'C:\\literal %TEMP%\\agy''s \"quoted\".exe'"
    launchVisibleTerminal(command, 'powershell', 'C:\\Temp')

    const [, args, options] = latestSpawnCall()
    expect(args).toEqual(
      expect.arrayContaining(['-EncodedCommand', expect.any(String)]),
    )
    const encodedIndex = args.indexOf('-EncodedCommand')
    const encodedCommand = args[encodedIndex + 1]
    if (!encodedCommand)
      throw new Error('Encoded PowerShell command is missing.')
    expect(Buffer.from(encodedCommand, 'base64').toString('utf16le')).toBe(
      command,
    )
    expect(args.join(' ')).not.toContain('%TEMP%')
    expect(options).toEqual(expect.objectContaining({ cwd: 'C:\\Temp' }))
  })
})

describe('launchVisibleTerminal on macOS', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  afterAll(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  beforeEach(() => {
    mockSpawn.mockClear()
    mockUnref.mockClear()
  })

  it('opens an empty Terminal.app window without running a command', () => {
    launchVisibleTerminal('', 'terminal')

    const [, args, options] = latestSpawnCall()
    expect(args[0]).toBe('-e')
    expect(args[1]).toContain('on run argv')
    expect(args[2]).toBe('')
    expect(options).toEqual(
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    )
    expect(mockUnref).toHaveBeenCalled()
  })

  it('passes backslashes and quotes as an AppleScript argv value', () => {
    const command = 'printf "C:\\runtime"'
    launchVisibleTerminal(command, 'terminal')

    const [, args] = latestSpawnCall()
    expect(args[1]).not.toContain(command)
    expect(args[2]).toBe(command)
  })

  it('changes to an isolated directory before opening Antigravity', () => {
    launchVisibleTerminal("'/Applications/agy'", 'terminal', "/tmp/user's run")

    const [, args] = latestSpawnCall()
    expect(args[1]).not.toContain("/tmp/user's run")
    expect(args[2]).toBe("cd '/tmp/user'\\''s run' && '/Applications/agy'")
  })

  it('keeps control characters out of AppleScript source text', () => {
    const workingDirectory = '/tmp/update\r\nfolder'
    launchVisibleTerminal("'/Applications/agy'", 'terminal', workingDirectory)

    const [, args] = latestSpawnCall()
    expect(args[1]).not.toMatch(/[\r\n]folder/)
    expect(args[2]).toContain(workingDirectory)
  })
})
