import type {
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk'

import { requireNode } from './nodeRuntime'

type ChildProcessModule = typeof import('child_process')

/**
 * Adapted from Claudian 2.0.41 (MIT). The AbortSignal supplied by Obsidian's
 * Electron renderer belongs to a different realm, so Node must not receive it
 * directly in spawn options.
 */
export function createClaudeSpawnAdapter(): (
  options: SpawnOptions,
) => SpawnedProcess {
  return (options) => {
    const { spawn } = requireNode<ChildProcessModule>('child_process')
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'ignore'],
      shell: false,
      windowsHide: true,
    })

    const abort = () => terminateProcessTree(child)
    if (options.signal?.aborted) {
      abort()
    } else {
      options.signal?.addEventListener('abort', abort, { once: true })
    }
    child.once('close', () =>
      options.signal?.removeEventListener('abort', abort),
    )

    if (!child.stdin || !child.stdout) {
      throw new Error('Claude Code process streams were not created.')
    }
    return child as unknown as SpawnedProcess
  }
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
