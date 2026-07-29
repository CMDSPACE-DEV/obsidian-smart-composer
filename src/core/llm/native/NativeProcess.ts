import type { NativeRuntimeSetupShell } from './NativeRuntimeService'
import { requireNode } from './nodeRuntime'

type ChildProcessModule = typeof import('child_process')
type ChildProcessWithoutNullStreams =
  import('child_process').ChildProcessWithoutNullStreams

export type NativeProcessResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type NativeProcessOptions = {
  executable: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  stdin?: string
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

export function runNativeProcess(
  options: NativeProcessOptions,
): Promise<NativeProcessResult> {
  const { spawn } = requireNode<ChildProcessModule>('child_process')

  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
    let stdout = ''
    let stderr = ''
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let settled = false

    const abort = () => {
      terminateProcessTree(child)
    }
    if (options.signal?.aborted) {
      abort()
    } else {
      options.signal?.addEventListener('abort', abort, { once: true })
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin)
    }
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      stdoutBuffer = emitLines(stdoutBuffer + chunk, options.onStdoutLine)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      stderrBuffer = emitLines(stderrBuffer + chunk, options.onStderrLine)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      if (stdoutBuffer) options.onStdoutLine?.(stdoutBuffer)
      if (stderrBuffer) options.onStderrLine?.(stderrBuffer)
      const exitCode = code ?? -1
      if (options.signal?.aborted) {
        const abortError = new Error('Native runtime request was canceled.')
        abortError.name = 'AbortError'
        reject(abortError)
        return
      }
      resolve({ stdout, stderr, exitCode })
    })
  })
}

export function launchVisibleTerminal(
  command: string,
  preferredShell: NativeRuntimeSetupShell = 'powershell',
): void {
  const { spawn } = requireNode<ChildProcessModule>('child_process')
  if (process.platform === 'win32') {
    const executable = preferredShell === 'cmd' ? 'cmd.exe' : 'powershell.exe'
    const shellArgs =
      preferredShell === 'cmd'
        ? ['/d', '/k', ...(command ? [command] : [])]
        : ['-NoExit', '-NoProfile', ...(command ? ['-Command', command] : [])]
    const child = spawn(
      'cmd.exe',
      ['/d', '/s', '/c', 'start', '', executable, ...shellArgs],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      },
    )
    child.unref()
    return
  }

  if (process.platform === 'darwin') {
    const terminalCommand = command || 'clear'
    const escaped = terminalCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const child = spawn(
      'osascript',
      ['-e', `tell application "Terminal" to do script "${escaped}"`],
      {
        detached: true,
        stdio: 'ignore',
      },
    )
    child.unref()
    return
  }

  const child = spawn(
    'x-terminal-emulator',
    ['-e', 'bash', '-lc', command || 'exec bash'],
    {
      detached: true,
      stdio: 'ignore',
    },
  )
  child.unref()
}

function emitLines(value: string, callback?: (line: string) => void): string {
  const lines = value.split(/\r?\n/)
  const remainder = lines.pop() ?? ''
  for (const line of lines) callback?.(line)
  return remainder
}

function terminateProcessTree(child: import('child_process').ChildProcess) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const { spawn } = requireNode<ChildProcessModule>('child_process')
    spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }
  child.kill('SIGTERM')
}
