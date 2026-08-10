import { Platform } from 'obsidian'

import { NativeCliResolver } from './NativeCliResolver'
import {
  NativeProcessOptions,
  launchVisibleTerminal,
  runNativeProcess,
} from './NativeProcess'
import type {
  NativeRuntimeModel,
  NativeRuntimeProvider,
  NativeRuntimeSnapshot,
  NativeRuntimeUpdateState,
  RuntimeAuthDecision,
  RuntimeDiscovery,
} from './nativeRuntime.types'
import {
  classifyAntigravityBlockingSignals,
  classifyAntigravityQuotaProvenance,
  classifyAntigravityTextCatalog,
  prepareNativePlanEnvironment,
  verifyClaudePlanAuth,
} from './NativeRuntimeAuth'
import {
  NativeRuntimeStore,
  sharedNativeRuntimeStore,
} from './NativeRuntimeStore'

const DIAGNOSTIC_TIMEOUT_MS = 30_000
const CLAUDE_INSTALL_GUIDE_URL = 'https://code.claude.com/docs/en/installation'
const ANTIGRAVITY_INSTALL_GUIDE_URL =
  'https://antigravity.google/docs/cli/install'

type NativeProcessRunner = (
  options: NativeProcessOptions,
) => ReturnType<typeof runNativeProcess>

export type NativeRuntimeSetupShell = 'powershell' | 'cmd' | 'terminal'

export type NativeRuntimeInstallAlternative = {
  label: string
  command: string
  shell: NativeRuntimeSetupShell
}

export type NativeRuntimeInstallGuide = {
  command: string
  loginCommand: string
  shell: NativeRuntimeSetupShell
  shellLabel: string
  officialUrl: string
  platform: NodeJS.Platform
  pasteModifier: 'Ctrl' | 'Command'
  expectedPath: string
  alternatives: NativeRuntimeInstallAlternative[]
}

export type NativeRuntimeUpdateDecision = {
  provider: NativeRuntimeProvider
  state: NativeRuntimeUpdateState
  command?: string
  shell: NativeRuntimeSetupShell
  reason: string
  discovery: RuntimeDiscovery
}

export class NativeRuntimeService {
  constructor(
    private readonly resolver = new NativeCliResolver(),
    private readonly store: NativeRuntimeStore = sharedNativeRuntimeStore,
    private readonly runner: NativeProcessRunner = runNativeProcess,
    private readonly environmentSource: NodeJS.ProcessEnv = process.env,
  ) {}

  getSnapshot(provider: NativeRuntimeProvider): NativeRuntimeSnapshot {
    return this.store.getSnapshot(provider)
  }

  subscribe(
    provider: NativeRuntimeProvider,
    listener: (snapshot: NativeRuntimeSnapshot) => void,
  ): () => void {
    return this.store.subscribe(provider, listener)
  }

  async diagnose(
    provider: NativeRuntimeProvider,
    signal?: AbortSignal,
  ): Promise<NativeRuntimeSnapshot> {
    const generation = this.store.beginDiagnosis(provider)
    let snapshot: NativeRuntimeSnapshot

    if (!Platform.isDesktop) {
      snapshot = settledSnapshot(provider, {
        status: 'not-installed',
        installation: 'not-installed',
        error: 'Plan runtimes are available on desktop only.',
      })
      return this.store.settleDiagnosis(provider, generation, snapshot)
    }

    let discovery = this.resolver.discover(provider)
    const executablePath = discovery.selectedPath
    if (!executablePath) {
      snapshot = settledSnapshot(provider, {
        status: 'not-installed',
        installation: 'not-installed',
        discovery,
      })
      return this.store.settleDiagnosis(provider, generation, snapshot)
    }

    try {
      discovery = await verifyPackageManagerEvidence(
        provider,
        discovery,
        this.runner,
        signal,
      )
      snapshot =
        provider === 'claude'
          ? await diagnoseClaude(
              executablePath,
              discovery,
              this.runner,
              signal,
              this.environmentSource,
            )
          : await diagnoseAntigravity(
              executablePath,
              discovery,
              this.runner,
              signal,
              this.environmentSource,
            )
    } catch (error) {
      snapshot = settledSnapshot(provider, {
        status: isLoginError(error) ? 'login-required' : 'error',
        installation: 'installed',
        authentication: isLoginError(error) ? 'login-required' : 'not-checked',
        catalog: provider === 'claude' ? 'ready' : 'error',
        update: getUpdateDecision(provider, discovery).state,
        executablePath: discovery.selectedPath,
        models: provider === 'claude' ? defaultModels('claude') : [],
        discovery,
        error: safeDiagnosticError(error),
      })
    }

    return this.store.settleDiagnosis(provider, generation, snapshot)
  }

  setCustomPath(provider: NativeRuntimeProvider, executablePath: string): void {
    this.resolver.setCustomPath(provider, executablePath)
    this.store.reset(provider)
  }

  getCustomPath(provider: NativeRuntimeProvider): string {
    return this.resolver.getCustomPath(provider)
  }

  openSetupTerminal(shell: NativeRuntimeSetupShell): void {
    launchVisibleTerminal('', shell)
  }

  getUpdateDecision(
    provider: NativeRuntimeProvider,
  ): NativeRuntimeUpdateDecision {
    const snapshotDiscovery = this.store.getSnapshot(provider).discovery
    return getUpdateDecision(
      provider,
      snapshotDiscovery ?? this.resolver.discover(provider),
    )
  }

  openUpdateTerminal(provider: NativeRuntimeProvider): void {
    const decision = this.getUpdateDecision(provider)
    if (!decision.command) throw new Error(decision.reason)
    launchVisibleTerminal(decision.command, decision.shell)
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
  discovery: RuntimeDiscovery,
  runner: NativeProcessRunner,
  signal?: AbortSignal,
  environmentSource: NodeJS.ProcessEnv = process.env,
): Promise<NativeRuntimeSnapshot> {
  const environment = prepareNativePlanEnvironment('claude', environmentSource)
  const versionResult = await runWithTimeout(runner, {
    executable: executablePath,
    args: ['--version'],
    env: environment.env,
    signal,
  })
  if (versionResult.exitCode !== 0) {
    throw new Error('Claude Code version check failed.')
  }

  const verification = await verifyClaudePlanAuth(executablePath, {
    environment,
    runner: (options) => runWithTimeout(runner, options),
    signal,
  })
  const common = {
    executablePath,
    version: firstMeaningfulLine(versionResult.stdout),
    models: defaultModels('claude'),
    discovery,
    authDecision: verification.decision,
    update: getUpdateDecision('claude', discovery).state,
  }
  if (verification.decision.status === 'login-required') {
    return settledSnapshot('claude', {
      ...common,
      status: 'login-required',
      installation: 'installed',
      authentication: 'login-required',
      catalog: 'ready',
      error: verification.decision.reason,
    })
  }
  if (!verification.decision.allowed) {
    return settledSnapshot('claude', {
      ...common,
      status: 'billing-blocked',
      installation: 'installed',
      authentication: 'billing-blocked',
      catalog: 'ready',
      error: verification.decision.reason,
    })
  }

  return settledSnapshot('claude', {
    ...common,
    status: 'ready',
    installation: 'installed',
    authentication: 'subscription',
    catalog: 'ready',
  })
}

async function diagnoseAntigravity(
  executablePath: string,
  discovery: RuntimeDiscovery,
  runner: NativeProcessRunner,
  signal?: AbortSignal,
  environmentSource: NodeJS.ProcessEnv = process.env,
): Promise<NativeRuntimeSnapshot> {
  const environment = prepareNativePlanEnvironment('gemini', environmentSource)
  const versionResult = await runWithTimeout(runner, {
    executable: executablePath,
    args: ['--version'],
    env: environment.env,
    signal,
  })
  if (versionResult.exitCode !== 0) {
    throw new Error('Antigravity CLI version check failed.')
  }

  const common = {
    executablePath,
    version: firstMeaningfulLine(versionResult.stdout),
    discovery,
    update: getUpdateDecision('gemini', discovery).state,
  }
  if (environment.blockedVariables.length > 0) {
    const failureDecision: RuntimeAuthDecision = {
      status: 'billing-blocked',
      allowed: false,
      reason:
        'Gemini Plan is blocked because API or Google Cloud environment credentials would take precedence.',
      evidence: environment.blockedVariables.map(
        (name) => `environment variable present: ${name}`,
      ),
    }
    return settledSnapshot('gemini', {
      ...common,
      status: 'billing-blocked',
      installation: 'installed',
      authentication: 'billing-blocked',
      catalog: 'not-checked',
      models: [],
      authDecision: failureDecision,
      error: failureDecision.reason,
    })
  }

  let modelsResult = await runWithTimeout(runner, {
    executable: executablePath,
    args: ['models', '--json'],
    env: environment.env,
    signal,
  })
  let hasJsonCatalog = modelsResult.exitCode === 0
  let authDecision: RuntimeAuthDecision | undefined =
    classifyAntigravityBlockingSignals(
      [modelsResult.stdout, modelsResult.stderr],
      environment,
    ) ??
    (hasJsonCatalog
      ? classifyAntigravityQuotaProvenance(modelsResult.stdout, environment)
      : undefined)
  if (
    (modelsResult.exitCode !== 0 &&
      authDecision === undefined &&
      !isLoginText(`${modelsResult.stderr}\n${modelsResult.stdout}`)) ||
    authDecision?.status === 'quota-unverified'
  ) {
    modelsResult = await runWithTimeout(runner, {
      executable: executablePath,
      args: ['models'],
      env: environment.env,
      signal,
    })
    hasJsonCatalog = false
    authDecision =
      classifyAntigravityBlockingSignals(
        [modelsResult.stdout, modelsResult.stderr],
        environment,
      ) ??
      (modelsResult.exitCode === 0
        ? classifyAntigravityTextCatalog(modelsResult.stdout, environment)
        : undefined)
  }
  if (modelsResult.exitCode !== 0) {
    if (authDecision) {
      const billingBlocked = authDecision.status === 'billing-blocked'
      const loginRequired = authDecision.status === 'login-required'
      return settledSnapshot('gemini', {
        ...common,
        status: billingBlocked
          ? 'billing-blocked'
          : loginRequired
            ? 'login-required'
            : 'error',
        installation: 'installed',
        authentication: billingBlocked
          ? 'billing-blocked'
          : loginRequired
            ? 'login-required'
            : 'quota-unverified',
        catalog: 'error',
        models: [],
        authDecision,
        error: authDecision.reason,
      })
    }
    const loginRequired = isLoginText(
      `${modelsResult.stderr}\n${modelsResult.stdout}`,
    )
    const failureDecision: RuntimeAuthDecision = {
      status: loginRequired ? 'login-required' : 'quota-unverified',
      allowed: false,
      reason: loginRequired
        ? 'Open Antigravity CLI and sign in with Google.'
        : 'Antigravity model discovery failed without verifiable quota provenance.',
      evidence: [
        loginRequired
          ? 'agy models reported signed out'
          : 'agy models failed without a recognized auth result',
      ],
    }
    return settledSnapshot('gemini', {
      ...common,
      status: loginRequired ? 'login-required' : 'error',
      installation: 'installed',
      authentication: loginRequired ? 'login-required' : 'quota-unverified',
      catalog: 'error',
      models: [],
      authDecision: failureDecision,
      error: failureDecision.reason,
    })
  }

  const models = parseAntigravityModels(modelsResult.stdout)
  if (
    models.length === 0 &&
    authDecision?.status !== 'billing-blocked' &&
    authDecision?.status !== 'login-required'
  ) {
    return settledSnapshot('gemini', {
      ...common,
      status: 'error',
      installation: 'installed',
      authentication: 'quota-unverified',
      catalog: 'error',
      models: [],
      error:
        'Antigravity returned no readable model catalog. Update the runtime and run `agy models` in a terminal before diagnosing again.',
    })
  }

  authDecision ??= hasJsonCatalog
    ? classifyAntigravityQuotaProvenance(modelsResult.stdout, environment)
    : classifyAntigravityTextCatalog(modelsResult.stdout, environment)
  const billingBlocked = authDecision.status === 'billing-blocked'
  const loginRequired = authDecision.status === 'login-required'
  return settledSnapshot('gemini', {
    ...common,
    status: authDecision.allowed
      ? 'ready'
      : billingBlocked
        ? 'billing-blocked'
        : loginRequired
          ? 'login-required'
          : 'quota-unverified',
    installation: 'installed',
    authentication: authDecision.allowed
      ? 'subscription'
      : billingBlocked
        ? 'billing-blocked'
        : loginRequired
          ? 'login-required'
          : 'quota-unverified',
    catalog: models.length > 0 ? 'ready' : 'error',
    models,
    authDecision,
    ...(authDecision.allowed
      ? { warning: authDecision.reason }
      : { error: authDecision.reason }),
  })
}

export function getUpdateDecision(
  provider: NativeRuntimeProvider,
  discovery: RuntimeDiscovery,
): NativeRuntimeUpdateDecision {
  const shell = process.platform === 'win32' ? 'powershell' : 'terminal'
  if (!discovery.selectedPath) {
    return {
      provider,
      state: 'unknown',
      shell,
      reason:
        provider === 'claude'
          ? 'Claude Code is not installed. Open the installation guide first.'
          : 'Antigravity CLI is not installed. Open the installation guide first.',
      discovery,
    }
  }
  if (discovery.ambiguous) {
    return {
      provider,
      state: 'ambiguous',
      shell,
      reason:
        'Multiple runtime installations were detected. Resolve the duplicate installations before updating.',
      discovery,
    }
  }
  if (provider === 'gemini') {
    return {
      provider,
      state: 'background',
      shell,
      reason:
        'Antigravity uses its documented background updater. Smart Composer does not run the undocumented `agy update` command.',
      discovery,
    }
  }

  if (discovery.selectedMethod === 'native') {
    return {
      provider,
      state: 'native',
      command: `${quoteForShell(discovery.selectedPath)} update`,
      shell,
      reason: 'Update the Anthropic native installation with `claude update`.',
      discovery,
    }
  }
  if (discovery.selectedMethod === 'winget') {
    if (!selectedCandidate(discovery)?.managerVerified) {
      return {
        provider,
        state: 'unknown',
        shell: 'powershell',
        reason:
          'A WinGet link was found, but WinGet did not confirm the Claude Code package. No updater was selected.',
        discovery,
      }
    }
    return {
      provider,
      state: 'winget',
      command: 'winget upgrade --id Anthropic.ClaudeCode --exact',
      shell: 'powershell',
      reason: 'Update the WinGet installation through WinGet.',
      discovery,
    }
  }
  if (discovery.selectedMethod === 'homebrew') {
    if (!selectedCandidate(discovery)?.managerVerified) {
      return {
        provider,
        state: 'unknown',
        shell: 'terminal',
        reason:
          'A Homebrew-prefix executable was found, but Homebrew did not confirm the Claude Code cask. No updater was selected.',
        discovery,
      }
    }
    return {
      provider,
      state: 'homebrew',
      command: 'brew upgrade --cask claude-code',
      shell: 'terminal',
      reason: 'Update the Homebrew cask through Homebrew.',
      discovery,
    }
  }

  return {
    provider,
    state: 'unknown',
    shell,
    reason:
      'This custom or legacy Claude executable cannot be updated safely without a verified installation method.',
    discovery,
  }
}

async function verifyPackageManagerEvidence(
  provider: NativeRuntimeProvider,
  discovery: RuntimeDiscovery,
  runner: NativeProcessRunner,
  signal?: AbortSignal,
): Promise<RuntimeDiscovery> {
  if (
    provider !== 'claude' ||
    !discovery.selectedPath ||
    discovery.ambiguous ||
    (discovery.selectedMethod !== 'winget' &&
      discovery.selectedMethod !== 'homebrew')
  ) {
    return discovery
  }
  const method = discovery.selectedMethod
  try {
    const result = await runWithTimeout(runner, {
      executable:
        method === 'winget'
          ? 'winget.exe'
          : discovery.selectedPath.startsWith('/opt/homebrew/')
            ? '/opt/homebrew/bin/brew'
            : '/usr/local/bin/brew',
      args:
        method === 'winget'
          ? ['list', '--id', 'Anthropic.ClaudeCode', '--exact']
          : ['list', '--cask', 'claude-code'],
      signal,
    })
    if (result.exitCode !== 0) return discovery
    return {
      ...discovery,
      candidates: discovery.candidates.map((candidate) =>
        candidate.path === discovery.selectedPath
          ? {
              ...candidate,
              managerVerified: true,
              evidence: [
                ...candidate.evidence,
                method === 'winget'
                  ? 'WinGet confirmed Anthropic.ClaudeCode'
                  : 'Homebrew confirmed claude-code cask',
              ],
            }
          : candidate,
      ),
    }
  } catch {
    return discovery
  }
}

function selectedCandidate(discovery: RuntimeDiscovery) {
  return discovery.candidates.find(
    (candidate) => candidate.path === discovery.selectedPath,
  )
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
  if (Array.isArray(value)) return value.flatMap(collectModelRecords)
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
        command: 'irm https://claude.ai/install.ps1 | iex',
        loginCommand: 'claude auth login',
        shell: 'powershell',
        shellLabel: 'PowerShell',
        officialUrl: CLAUDE_INSTALL_GUIDE_URL,
        platform,
        pasteModifier: 'Ctrl',
        expectedPath: '%USERPROFILE%\\.local\\bin\\claude.exe',
        alternatives: [
          {
            label: 'WinGet',
            command: 'winget install Anthropic.ClaudeCode',
            shell: 'powershell',
          },
        ],
      }
    }
    return {
      command: 'irm https://antigravity.google/cli/install.ps1 | iex',
      loginCommand: 'agy',
      shell: 'powershell',
      shellLabel: 'PowerShell',
      officialUrl: ANTIGRAVITY_INSTALL_GUIDE_URL,
      platform,
      pasteModifier: 'Ctrl',
      expectedPath: '%LOCALAPPDATA%\\agy\\bin\\agy.exe',
      alternatives: [
        {
          label: 'Command Prompt',
          command:
            'curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd',
          shell: 'cmd',
        },
      ],
    }
  }

  if (platform === 'darwin') {
    if (provider === 'claude') {
      return {
        command: 'curl -fsSL https://claude.ai/install.sh | bash',
        loginCommand: 'claude auth login',
        shell: 'terminal',
        shellLabel: 'Terminal.app',
        officialUrl: CLAUDE_INSTALL_GUIDE_URL,
        platform,
        pasteModifier: 'Command',
        expectedPath: '~/.local/bin/claude',
        alternatives: [
          {
            label: 'Homebrew',
            command: 'brew install --cask claude-code',
            shell: 'terminal',
          },
        ],
      }
    }
    return {
      command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
      loginCommand: 'agy',
      shell: 'terminal',
      shellLabel: 'Terminal.app',
      officialUrl: ANTIGRAVITY_INSTALL_GUIDE_URL,
      platform,
      pasteModifier: 'Command',
      expectedPath: '~/.local/bin/agy',
      alternatives: [],
    }
  }

  return {
    command:
      provider === 'claude'
        ? 'curl -fsSL https://claude.ai/install.sh | bash'
        : 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    loginCommand: provider === 'claude' ? 'claude auth login' : 'agy',
    shell: 'terminal',
    shellLabel: 'Terminal',
    officialUrl:
      provider === 'claude'
        ? CLAUDE_INSTALL_GUIDE_URL
        : ANTIGRAVITY_INSTALL_GUIDE_URL,
    platform,
    pasteModifier: 'Ctrl',
    expectedPath:
      provider === 'claude' ? '~/.local/bin/claude' : '~/.local/bin/agy',
    alternatives: [],
  }
}

function settledSnapshot(
  provider: NativeRuntimeProvider,
  values: Partial<NativeRuntimeSnapshot> &
    Pick<NativeRuntimeSnapshot, 'status' | 'installation'>,
): NativeRuntimeSnapshot {
  return {
    provider,
    status: values.status,
    phase: 'settled',
    installation: values.installation,
    authentication: values.authentication ?? 'not-checked',
    catalog: values.catalog ?? 'not-checked',
    update: values.update ?? 'unknown',
    models: values.models ?? [],
    executablePath: values.executablePath,
    version: values.version,
    discovery: values.discovery,
    authDecision: values.authDecision,
    error: values.error,
    warning: values.warning,
    lastCheckedAt: Date.now(),
  }
}

function quoteForShell(value: string): string {
  if (process.platform === 'win32') return `& '${value.replace(/'/g, "''")}'`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function runWithTimeout(
  runner: NativeProcessRunner,
  options: NativeProcessOptions,
) {
  const timeoutController = new AbortController()
  const abort = () => timeoutController.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    () => timeoutController.abort(),
    DIAGNOSTIC_TIMEOUT_MS,
  )
  try {
    return await runner({ ...options, signal: timeoutController.signal })
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
  return isLoginText(error instanceof Error ? error.message : String(error))
}

function isLoginText(value: string): boolean {
  return /not signed|sign.?in|log.?in|authentication|unauthorized|credential/i.test(
    value,
  )
}

function safeDiagnosticError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Native runtime diagnosis was canceled.'
  }
  return 'Native runtime diagnosis failed. Retry the check or open the official runtime in a terminal.'
}
