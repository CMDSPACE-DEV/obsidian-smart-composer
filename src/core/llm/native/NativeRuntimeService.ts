import type {
  ModelInfo,
  Options,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { Platform } from 'obsidian'

import { createClaudeSpawnAdapter } from './ClaudeSpawnAdapter'
import { NativeCliResolver } from './NativeCliResolver'
import { launchVisibleTerminal, runNativeProcess } from './NativeProcess'
import {
  NativeRuntimeDiagnostics,
  NativeRuntimeModel,
  NativeRuntimeProvider,
} from './nativeRuntime.types'
import { requireNode } from './nodeRuntime'

const DIAGNOSTIC_TIMEOUT_MS = 30_000

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

  openInstallTerminal(provider: NativeRuntimeProvider): void {
    launchVisibleTerminal(installCommand(provider))
  }

  openUpdateTerminal(provider: NativeRuntimeProvider): void {
    const executablePath = this.resolver.resolve(provider)
    if (!executablePath) {
      this.openInstallTerminal(provider)
      return
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

  let models = defaultModels('claude')
  let modelDiscoveryWarning: string | undefined
  try {
    const catalog = await discoverClaudeCatalog(executablePath)
    models = catalog.length > 0 ? catalog : models
  } catch (error) {
    modelDiscoveryWarning = `Using stable model aliases because catalog refresh failed: ${toErrorMessage(error)}`
  }

  return {
    provider: 'claude',
    status: 'ready',
    executablePath,
    version: firstMeaningfulLine(versionResult.stdout),
    models,
    error: modelDiscoveryWarning,
  }
}

async function discoverClaudeCatalog(executablePath: string): Promise<
  {
    id: string
    label: string
    description?: string
  }[]
> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const abortController = new AbortController()
  const cwd = createEphemeralRuntimeDirectory('claude-diagnostics')
  const options: Options = {
    pathToClaudeCodeExecutable: executablePath,
    spawnClaudeCodeProcess: createClaudeSpawnAdapter(),
    cwd,
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    tools: [],
    skills: [],
    plugins: [],
    settings: {
      autoMemoryEnabled: false,
      autoDreamEnabled: false,
    },
    permissionMode: 'dontAsk',
    abortController,
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    },
  }
  const query = sdk.query({
    prompt: waitForAbort(abortController.signal),
    options,
  })

  try {
    const modelInfo = await withTimeout(
      query.supportedModels(),
      DIAGNOSTIC_TIMEOUT_MS,
      'Claude Code model discovery timed out.',
    )
    return modelInfo.map(toNativeClaudeModel)
  } finally {
    abortController.abort()
    query.close()
    removeEphemeralRuntimeDirectory(cwd)
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

function toNativeClaudeModel(model: ModelInfo): NativeRuntimeModel {
  return {
    id: model.value,
    label: model.displayName,
    description:
      model.resolvedModel && model.resolvedModel !== model.value
        ? `${model.description} Resolves to ${model.resolvedModel}.`
        : model.description,
  }
}

function defaultModels(provider: NativeRuntimeProvider): NativeRuntimeModel[] {
  return provider === 'claude'
    ? [
        { id: 'default', label: 'Claude default (runtime selected)' },
        { id: 'opus', label: 'Claude Opus (latest)' },
        { id: 'haiku', label: 'Claude Haiku (latest)' },
      ]
    : []
}

function installCommand(provider: NativeRuntimeProvider): string {
  if (provider === 'claude') {
    return process.platform === 'win32'
      ? 'irm https://claude.ai/install.ps1 | iex'
      : 'curl -fsSL https://claude.ai/install.sh | bash'
  }
  return process.platform === 'win32'
    ? 'irm https://antigravity.google/cli/install.ps1 | iex'
    : 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function waitForAbort(signal: AbortSignal): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]() {
      let complete = false
      return {
        async next(): Promise<IteratorResult<SDKUserMessage>> {
          if (complete) return { done: true, value: undefined }
          complete = true
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve()
              return
            }
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
          return { done: true, value: undefined }
        },
      }
    },
  }
}

function createEphemeralRuntimeDirectory(prefix: string): string {
  const fs = requireNode<typeof import('fs')>('fs')
  const os = requireNode<typeof import('os')>('os')
  const path = requireNode<typeof import('path')>('path')
  return fs.mkdtempSync(path.join(os.tmpdir(), `smart-composer-${prefix}-`))
}

function removeEphemeralRuntimeDirectory(directory: string) {
  const fs = requireNode<typeof import('fs')>('fs')
  try {
    fs.rmSync(directory, { recursive: true, force: true })
  } catch {
    // The operating system will eventually clear its temporary directory.
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
