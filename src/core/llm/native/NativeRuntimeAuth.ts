import type { NativeProcessOptions } from './NativeProcess'
import { runNativeProcess } from './NativeProcess'
import type {
  NativeRuntimeProvider,
  RuntimeAuthDecision,
} from './nativeRuntime.types'
import { requireNode } from './nodeRuntime'

type NativeProcessRunner = (
  options: NativeProcessOptions,
) => ReturnType<typeof runNativeProcess>

export type PreparedNativePlanEnvironment = {
  provider: NativeRuntimeProvider
  env: NodeJS.ProcessEnv
  /** Names only. Values are deliberately neither retained nor exposed. */
  blockedVariables: string[]
}

export type RuntimeAuthVerification = {
  decision: RuntimeAuthDecision
  environment: PreparedNativePlanEnvironment
}

const CLAUDE_BLOCKED_ENVIRONMENT = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
])

const GEMINI_BLOCKED_ENVIRONMENT = new Set([
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'VERTEX_AI_PROJECT',
  'VERTEX_AI_LOCATION',
])

const CLAUDE_PERSONAL_SUBSCRIPTION_TYPES = new Set(['pro', 'max'])

export type ClaudeManagedSettingsInspector = () => string[]

export function prepareNativePlanEnvironment(
  provider: NativeRuntimeProvider,
  source: NodeJS.ProcessEnv = process.env,
): PreparedNativePlanEnvironment {
  const blockedSet =
    provider === 'claude'
      ? CLAUDE_BLOCKED_ENVIRONMENT
      : GEMINI_BLOCKED_ENVIRONMENT
  const env: NodeJS.ProcessEnv = {}
  const blockedVariables: string[] = []

  for (const [name, value] of Object.entries(source)) {
    // Windows environment-variable names are case-insensitive even though
    // Node preserves the spelling used to create the entry. Normalize only
    // for classification so mixed-case credential variables can never pass
    // through to a child CLI process.
    const canonicalName = name.toUpperCase()
    if (!blockedSet.has(canonicalName)) {
      env[name] = value
      continue
    }
    if (typeof value === 'string' && value.trim()) {
      blockedVariables.push(canonicalName)
    }
  }

  return {
    provider,
    env,
    blockedVariables: [...new Set(blockedVariables)].sort(),
  }
}

export async function verifyClaudePlanAuth(
  executablePath: string,
  options: {
    signal?: AbortSignal
    environment?: PreparedNativePlanEnvironment
    runner?: NativeProcessRunner
    managedSettingsInspector?: ClaudeManagedSettingsInspector
  } = {},
): Promise<RuntimeAuthVerification> {
  const environment =
    options.environment ?? prepareNativePlanEnvironment('claude')
  if (environment.blockedVariables.length > 0) {
    return {
      environment,
      decision: blockedEnvironmentDecision(
        'Claude',
        environment.blockedVariables,
      ),
    }
  }

  let managedSettingsEvidence: string[]
  try {
    managedSettingsEvidence = (
      options.managedSettingsInspector ?? inspectClaudeManagedSettings
    )()
  } catch {
    managedSettingsEvidence = ['managed settings inspection failed closed']
  }
  if (managedSettingsEvidence.length > 0) {
    return {
      environment,
      decision: {
        status: 'billing-blocked',
        allowed: false,
        reason:
          'Claude Plan is blocked because managed settings could supply an API key, gateway, cloud provider, or credential helper.',
        evidence: managedSettingsEvidence,
      },
    }
  }

  const result = await (options.runner ?? runNativeProcess)({
    executable: executablePath,
    args: ['auth', 'status'],
    env: environment.env,
    signal: options.signal,
  })
  if (result.exitCode !== 0) {
    return {
      environment,
      decision: {
        status: 'login-required',
        allowed: false,
        reason: 'Sign in to Claude Code with an eligible Claude subscription.',
        evidence: ['claude auth status reported signed out'],
      },
    }
  }

  return {
    environment,
    decision: classifyClaudeAuthStatus(result.stdout, environment),
  }
}

/**
 * Detects managed Claude settings without reading their values. User, project,
 * and local settings are excluded separately with `--setting-sources ""` on
 * every inference request. Any managed source is blocked because managed
 * policy outranks command-line settings and may inject billing credentials.
 */
export function inspectClaudeManagedSettings(): string[] {
  const fs = requireNode<typeof import('fs')>('fs')
  const path = requireNode<typeof import('path')>('path')
  const { spawnSync } =
    requireNode<typeof import('child_process')>('child_process')
  const evidence: string[] = []
  const platform = process.platform
  const managedRoot =
    platform === 'win32'
      ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode')
      : platform === 'darwin'
        ? '/Library/Application Support/ClaudeCode'
        : '/etc/claude-code'

  if (fs.existsSync(path.join(managedRoot, 'managed-settings.json'))) {
    evidence.push('managed settings file present')
  }
  const dropInDirectory = path.join(managedRoot, 'managed-settings.d')
  if (fs.existsSync(dropInDirectory)) {
    try {
      if (
        fs
          .readdirSync(dropInDirectory)
          .some((name) => !name.startsWith('.') && name.endsWith('.json'))
      ) {
        evidence.push('managed settings drop-in present')
      }
    } catch {
      evidence.push('managed settings drop-in could not be inspected')
    }
  }

  if (platform === 'win32') {
    for (const [scope, registryKey] of [
      ['machine', 'HKLM\\SOFTWARE\\Policies\\ClaudeCode'],
      ['user', 'HKCU\\SOFTWARE\\Policies\\ClaudeCode'],
    ] as const) {
      const result = spawnSync('reg.exe', ['query', registryKey], {
        stdio: 'ignore',
        windowsHide: true,
      })
      if (result.status === 0) evidence.push(`${scope} policy registry present`)
      if (result.error || result.status === null) {
        evidence.push(`${scope} policy registry inspection failed closed`)
      }
    }
  } else if (platform === 'darwin') {
    const result = spawnSync(
      '/usr/bin/defaults',
      ['read', 'com.anthropic.claudecode'],
      { stdio: 'ignore' },
    )
    if (result.status === 0) evidence.push('managed preferences domain present')
    if (result.error || result.status === null) {
      evidence.push('managed preferences inspection failed closed')
    }
  }

  return [...new Set(evidence)].sort()
}

export async function verifyAntigravityPlanAuth(
  executablePath: string,
  options: {
    signal?: AbortSignal
    environment?: PreparedNativePlanEnvironment
    runner?: NativeProcessRunner
  } = {},
): Promise<RuntimeAuthVerification> {
  const environment =
    options.environment ?? prepareNativePlanEnvironment('gemini')
  if (environment.blockedVariables.length > 0) {
    return {
      environment,
      decision: blockedEnvironmentDecision(
        'Gemini',
        environment.blockedVariables,
      ),
    }
  }

  const result = await (options.runner ?? runNativeProcess)({
    executable: executablePath,
    args: ['models', '--json'],
    env: environment.env,
    signal: options.signal,
  })
  if (result.exitCode !== 0) {
    return {
      environment,
      decision: {
        status: isLoginText(result.stderr || result.stdout)
          ? 'login-required'
          : 'quota-unverified',
        allowed: false,
        reason: isLoginText(result.stderr || result.stdout)
          ? 'Open Antigravity CLI and sign in with Google.'
          : 'Gemini Plan quota provenance could not be verified.',
        evidence: [
          isLoginText(result.stderr || result.stdout)
            ? 'agy models reported signed out'
            : 'agy models did not provide verifiable quota provenance',
        ],
      },
    }
  }

  return {
    environment,
    decision: classifyAntigravityQuotaProvenance(result.stdout, environment),
  }
}

export function classifyClaudeAuthStatus(
  output: string,
  environment: PreparedNativePlanEnvironment = prepareNativePlanEnvironment(
    'claude',
    {},
  ),
): RuntimeAuthDecision {
  if (environment.blockedVariables.length > 0) {
    return blockedEnvironmentDecision('Claude', environment.blockedVariables)
  }
  const parsed = parseRecord(output)
  if (!parsed || parsed.loggedIn !== true) {
    return {
      status: parsed?.loggedIn === false ? 'login-required' : 'billing-blocked',
      allowed: false,
      reason:
        parsed?.loggedIn === false
          ? 'Sign in to Claude Code with an eligible Claude subscription.'
          : 'Claude authentication metadata was not recognized, so Plan billing cannot be verified.',
      evidence: [
        parsed?.loggedIn === false
          ? 'auth status explicitly reported logged out'
          : 'unknown auth status schema',
      ],
    }
  }

  const authMethod = normalizedString(parsed.authMethod)
  const apiProvider = normalizedString(parsed.apiProvider)
  const subscriptionType = normalizedString(parsed.subscriptionType)
  const records = collectRecords(parsed)
  if (records.some(hasBlockedClaudeAuthMarker)) {
    return {
      status: 'billing-blocked',
      allowed: false,
      reason:
        'Claude is configured for API, helper, gateway, or cloud-provider billing instead of subscription Plan usage.',
      evidence: ['auth metadata contains a non-subscription billing marker'],
    }
  }

  const looksLikePersonalSubscription =
    authMethod === 'claude.ai' &&
    apiProvider === 'firstparty' &&
    subscriptionType !== undefined &&
    CLAUDE_PERSONAL_SUBSCRIPTION_TYPES.has(subscriptionType)
  if (looksLikePersonalSubscription) {
    return {
      status: 'billing-blocked',
      allowed: false,
      reason:
        'Claude appears to use a first-party Pro/Max login, but the current CLI cannot prove that remote managed settings will not override it for this request.',
      evidence: [
        'authMethod=claude.ai',
        'apiProvider=firstParty',
        `subscriptionType=${subscriptionType}`,
        'effective remote managed credential source is not machine-readable',
      ],
    }
  }

  return {
    status: 'billing-blocked',
    allowed: false,
    reason:
      'Claude is signed in, but an eligible first-party subscription was not explicitly identified.',
    evidence: ['subscription provenance is incomplete or unknown'],
  }
}

export function classifyAntigravityQuotaProvenance(
  output: string,
  environment: PreparedNativePlanEnvironment = prepareNativePlanEnvironment(
    'gemini',
    {},
  ),
): RuntimeAuthDecision {
  if (environment.blockedVariables.length > 0) {
    return blockedEnvironmentDecision('Gemini', environment.blockedVariables)
  }
  const parsed = parseRecord(output)
  if (parsed && collectRecords(parsed).some(hasGoogleCloudMarker)) {
    return {
      status: 'billing-blocked',
      allowed: false,
      reason:
        'Antigravity reported Google Cloud, ADC, enterprise, or consumption-billing provenance.',
      evidence: ['machine-readable output contains a Cloud billing marker'],
    }
  }

  // Google currently publishes no supported machine-readable contract that
  // proves `agy` is consuming an individual Google AI Plan quota. A successful
  // model catalog is authentication evidence only, not billing evidence.
  return {
    status: 'quota-unverified',
    allowed: false,
    reason:
      'Antigravity is signed in, but personal Gemini Plan quota provenance cannot be verified by the current CLI.',
    evidence: ['no supported personal-plan quota provenance field'],
  }
}

export function assertRuntimeAuthAllowed(
  provider: NativeRuntimeProvider,
  decision: RuntimeAuthDecision,
): void {
  if (decision.allowed) return
  const label = provider === 'claude' ? 'Claude Plan' : 'Gemini Plan'
  throw new Error(`${label} request blocked: ${decision.reason}`)
}

function blockedEnvironmentDecision(
  label: string,
  variables: string[],
): RuntimeAuthDecision {
  return {
    status: 'billing-blocked',
    allowed: false,
    reason: `${label} Plan is blocked because API, token, gateway, or cloud-provider environment credentials would take precedence.`,
    evidence: variables.map((name) => `environment variable present: ${name}`),
  }
}

function hasBlockedClaudeAuthMarker(record: Record<string, unknown>): boolean {
  const markerFields = [
    record.authMethod,
    record.apiProvider,
    record.apiKeySource,
    record.billingType,
    record.billingSource,
    record.credentialSource,
  ]
    .map(normalizedString)
    .filter((value): value is string => value !== undefined)
  return markerFields.some((value) =>
    /console|api[_ -]?key|api[_ -]?usage|bedrock|vertex|foundry|gateway|helper/.test(
      value,
    ),
  )
}

function hasGoogleCloudMarker(record: Record<string, unknown>): boolean {
  const fieldNames = Object.keys(record).map((name) => name.toLowerCase())
  if (
    fieldNames.some((name) =>
      /projectid|project_id|billingproject|quota_project|serviceaccount/.test(
        name,
      ),
    )
  ) {
    return true
  }
  return [
    record.authMethod,
    record.accountType,
    record.billingSource,
    record.quotaSource,
  ]
    .map(normalizedString)
    .filter((value): value is string => value !== undefined)
    .some((value) =>
      /cloud|enterprise|adc|service[_ -]?account|consumption/.test(value),
    )
}

function collectRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectRecords)
  if (!isRecord(value)) return []
  return [value, ...Object.values(value).flatMap(collectRecords)]
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLoginText(value: string): boolean {
  return /not signed|sign.?in|log.?in|authentication|unauthorized|credential/i.test(
    value,
  )
}
