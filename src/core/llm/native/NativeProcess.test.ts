const mockUnref = jest.fn()
const mockSpawn = jest.fn(() => ({ unref: mockUnref }))

jest.mock('./nodeRuntime', () => ({
  requireNode: () => ({ spawn: mockSpawn }),
}))

import { launchVisibleTerminal } from './NativeProcess'

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

    expect(mockSpawn).toHaveBeenCalledWith(
      'osascript',
      ['-e', 'tell application "Terminal" to do script ""'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    )
    expect(mockUnref).toHaveBeenCalled()
  })

  it('escapes backslashes and quotes in a generated AppleScript argument', () => {
    launchVisibleTerminal('printf "C:\\runtime"', 'terminal')

    expect(mockSpawn).toHaveBeenCalledWith(
      'osascript',
      [
        '-e',
        'tell application "Terminal" to do script "printf \\"C:\\\\runtime\\""',
      ],
      expect.any(Object),
    )
  })
})
