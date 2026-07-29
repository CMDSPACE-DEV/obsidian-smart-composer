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
