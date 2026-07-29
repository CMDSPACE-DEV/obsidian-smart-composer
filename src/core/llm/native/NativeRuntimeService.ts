import { Platform } from 'obsidian'

import { NativeCliResolver } from './NativeCliResolver'
import { launchVisibleTerminal, runNativeProcess } from './NativeProcess'
import type {
  NativeRuntimeDiagnostics,
  NativeRuntimeModel,
  NativeRuntimeProvider,
} from './nativeRuntime.types'

const DIAGNOSTIC_TIMEOUT_MS = 30_000
const CLAUDE_INSTALL_GUIDE_URL = 'https://code.claude.com/docs/en/installation'
const ANTIGRAVITY_INSTALL_GUIDE_URL =
  'https://codelabs.developers.google.com/antigravity-cli-hands-on#1'

export type NativeRuntimeSetupShell = 'powershell' | 'cmd' | 'terminal'

export type NativeRuntimeInstallGuide = {
  command: string
  loginCommand: string
  shell: NativeRuntimeSetupShell
  shellLabel: string
  officialUrl: string
}

export class NativeRuntimeService {
  constructor(private readonly resolver = new NativeCliResolver()) {}

  async diagnose(
    provider: NativeRuntimeProvider,
  ): Promise<NativeRuntimeDiagnostics> {
    if (!Platform.isDesktop) {
      return {
        provider,
        status: 'not-installed',
        models: [],
        error: 'Plan runtimes are available on desktop only.',
      }
    }

    const executablePath = this.resolver.resolve(provider)
    if (!executablePath) {
      return {
        provider,
        status: 'not-installed',
        models: [],
      }
    }

    try {
      return provider === 'claude'
        ? await diagnoseClaude(executablePath)
        : await diagnoseAntigravity(executablePath)
    } catch (error) {
      return {
        provider,
        status: isLoginError(error) ? 'login-required' : 'error',
        executablePath,
        models: provider === 'claude' ? defaultModels('claude') : [],
        error: toErrorMessage(error),
      }
    }
  }

  setCustomPath(provider: NativeRuntimeProvider, executablePath: string): void {
    this.resolver.setCustomPath(provider, executablePath)
  }

  getCustomPath(provider: NativeRuntimeProvider): string {
    return this.resolver.getCustomPath(provider)
  }

  openSetupTerminal(shell: NativeRuntimeSetupShell): void {
    launchVisibleTerminal('', shell)
  }

  openUpdateTerminal(provider: NativeRuntimeProvider): void {
    const executablePath = this.resolver.resolve(provider)
    if (!executablePath) {
      throw new Error(
        provider === 'claude'
          ? 'Claude Code is not installed. Open the installation guide first.'
          : 'Antigravity CLI is not installed. Open the installation guide first.',
      )
    }
    launchVisibleTerminal(
      provider === 'claude'
        ? `${quoteForShell(executablePath)} update`
        : `${quoteForShell(executablePath)} update`,
    )
  }

  openLoginTerminal(provider: NativeRuntimeProvider): void {
    const executablePath = this.resolver.resolve(provider)
    if (!executablePath) {
      throw new Error(
        provider === 'claude'
          ? 'Claude Code is not installed.'
          : 'Antigravity CLI is not installed.',
      )
    }
    launchVisibleTerminal(
      provider === 'claude'
        ? `${quoteForShell(executablePath)} auth login`
        : quoteForShell(executablePath),
    )
  }
}

async function diagnoseClaude(
  executablePath: string,
): Promise<NativeRuntimeDiagnostics> {
  const versionResult = await runWithTimeout({
    executable: executablePath,
    args: ['--version'],
  })
  if (versionResult.exitCode !== 0) {
    throw new Error(
      versionResult.stderr.trim() || 'Claude Code version check failed.',
    )
  }

  const authResult = await runWithTimeout({
    executable: executablePath,
    args: ['auth', 'status'],
  })
  if (authResult.exitCode !== 0) {
    return {
      provider: 'claude',
      status: 'login-required',
      executablePath,
      version: firstMeaningfulLine(versionResult.stdout),
      models: defaultModels('claude'),
      error:
        authResult.stderr.trim() ||
        authResult.stdout.trim() ||
        'Sign in to Claude Code.',
    }
  }

  return {
    provider: 'claude',
    status: 'ready',
    executablePath,
    version: firstMeaningfulLine(versionResult.stdout),
    models: defaultModels('claude'),
  }
}

async function diagnoseAntigravity(
  executablePath: string,
): Promise<NativeRuntimeDiagnostics> {
  const versionResult = await runWithTimeout({
    executable: executablePath,
    args: ['--version'],
  })
  if (versionResult.exitCode !== 0) {
    throw new Error(
      versionResult.stderr.trim() || 'Antigravity CLI version check failed.',
    )
  }

  let modelsResult = await runWithTimeout({
    executable: executablePath,
    args: ['models', '--json'],
  })
  if (modelsResult.exitCode !== 0 && !isLoginText(modelsResult.stderr)) {
    modelsResult = await runWithTimeout({
      executable: executablePath,
      args: ['models'],
    })
  }
  if (modelsResult.exitCode !== 0) {
    const message =
      modelsResult.stderr.trim() ||
      modelsResult.stdout.trim() ||
      'Open Antigravity CLI and sign in with Google.'
    return {
      provider: 'gemini',
      status: isLoginText(message) ? 'login-required' : 'error',
      executablePath,
      version: firstMeaningfulLine(versionResult.stdout),
      models: [],
      error: message,
    }
  }

  const models = parseAntigravityModels(modelsResult.stdout)
  if (models.length === 0) {
    return {
      provider: 'gemini',
      status: 'error',
      executablePath,
      version: firstMeaningfulLine(versionResult.stdout),
      models: [],
      error:
        'Antigravity returned no readable model catalog. Update the runtime and run `agy models` in a terminal before diagnosing again.',
    }
  }
  return {
    provider: 'gemini',
    status: 'ready',
    executablePath,
    version: firstMeaningfulLine(versionResult.stdout),
    models,
  }
}

export function parseAntigravityModels(output: string): NativeRuntimeModel[] {
  const parsed = parseJson(output)
  const fromJson = collectModelRecords(parsed)
  if (fromJson.length > 0) return dedupeModels(fromJson)

  const plainText = stripAnsi(output)
  const rows = plainText
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^[*+\-\u2022>]\s*/, '')
        .replace(/^\[[ x]\]\s*/i, ''),
    )
    .filter(Boolean)
    .filter(
      (line) =>
        !/^(available\s+models?|models?|name\s+slug|loading|current)/i.test(
          line,
        ),
    )
    .map((line) => {
      const tabParts = line.split(/\t+|\s{2,}/).filter(Boolean)
      const label = tabParts[0]?.trim() ?? ''
      const slug =
        tabParts.find((part) => /^[a-z0-9][a-z0-9._-]+$/i.test(part)) ?? label
      return label ? { id: slug, label } : null
    })
    .filter((model): model is NativeRuntimeModel => model !== null)

  return dedupeModels(rows)
}

function collectModelRecords(value: unknown): NativeRuntimeModel[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectModelRecords)
  }
  if (!isRecord(value)) return []
  const nested =
    value.models ?? value.data ?? value.items ?? value.availableModels
  if (nested !== undefined) return collectModelRecords(nested)

  const id =
    stringValue(value, 'slug') ??
    stringValue(value, 'id') ??
    stringValue(value, 'value') ??
    stringValue(value, 'name')
  const label =
    stringValue(value, 'displayName') ??
    stringValue(value, 'label') ??
    stringValue(value, 'name') ??
    id
  return id && label
    ? [
        {
          id,
          label,
          description: stringValue(value, 'description'),
        },
      ]
    : []
}

function defaultModels(provider: NativeRuntimeProvider): NativeRuntimeModel[] {
  return provider === 'claude'
    ? [
        { id: 'default', label: 'Claude default (runtime selected)' },
        { id: 'opus', label: 'Claude Opus (latest)' },
        { id: 'sonnet', label: 'Claude Sonnet (latest)' },
        { id: 'haiku', label: 'Claude Haiku (latest)' },
      ]
    : []
}

export function getNativeRuntimeInstallGuide(
  provider: NativeRuntimeProvider,
  platform: NodeJS.Platform = process.platform,
): NativeRuntimeInstallGuide {
  if (platform === 'win32') {
    if (provider === 'claude') {
      return {
        command:
          'winget install --id Anthropic.ClaudeCode --exact --source winget --accept-source-agreements --accept-package-agreements',
        loginCommand: 'claude',
        shell: 'powershell',
        shellLabel: 'PowerShell',
        officialUrl: CLAUDE_INSTALL_GUIDE_URL,
      }
    }

    return {
      command:
        'curl.exe -fsSL https://antigravity.google/cli/install.cmd -o "%TEMP%\\antigravity-install.cmd" && call "%TEMP%\\antigravity-install.cmd" && del "%TEMP%\\antigravity-install.cmd"',
      loginCommand: 'agy',
      shell: 'cmd',
      shellLabel: '명령 프롬프트',
      officialUrl: ANTIGRAVITY_INSTALL_GUIDE_URL,
    }
  }

  if (provider === 'claude' && platform === 'darwin') {
    return {
      command: 'brew install --cask claude-code',
      loginCommand: 'claude',
      shell: 'terminal',
      shellLabel: 'Terminal',
      officialUrl: CLAUDE_INSTALL_GUIDE_URL,
    }
  }

  return {
    command:
      provider === 'claude'
        ? 'curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh && bash /tmp/claude-install.sh && rm -f /tmp/claude-install.sh'
        : 'curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/antigravity-install.sh && bash /tmp/antigravity-install.sh && rm -f /tmp/antigravity-install.sh',
    loginCommand: provider === 'claude' ? 'claude' : 'agy',
    shell: 'terminal',
    shellLabel: 'Terminal',
    officialUrl:
      provider === 'claude'
        ? CLAUDE_INSTALL_GUIDE_URL
        : ANTIGRAVITY_INSTALL_GUIDE_URL,
  }
}

function quoteForShell(value: string): string {
  if (process.platform === 'win32') {
    return `& '${value.replace(/'/g, "''")}'`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function runWithTimeout(options: Parameters<typeof runNativeProcess>[0]) {
  const timeoutController = new AbortController()
  const abort = () => timeoutController.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    () => timeoutController.abort(),
    DIAGNOSTIC_TIMEOUT_MS,
  )
  try {
    return await runNativeProcess({
      ...options,
      signal: timeoutController.signal,
    })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function stringValue(
  value: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const result = value?.[key]
  return typeof result === 'string' && result.trim() ? result.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstMeaningfulLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

function stripAnsi(value: string): string {
  const ansiSequence = new RegExp(
    `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
    'g',
  )
  return value.replace(ansiSequence, '')
}

function dedupeModels(models: NativeRuntimeModel[]): NativeRuntimeModel[] {
  const unique = new Map<string, NativeRuntimeModel>()
  for (const model of models) {
    if (!unique.has(model.id)) unique.set(model.id, model)
  }
  return [...unique.values()]
}

function isLoginError(error: unknown): boolean {
  return isLoginText(toErrorMessage(error))
}

function isLoginText(value: string): boolean {
  return /not signed|sign.?in|log.?in|authentication|unauthorized|credential/i.test(
    value,
  )
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
