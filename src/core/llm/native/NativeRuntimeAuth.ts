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

const ANTIGRAVITY_AUTH_TIMEOUT_MS = 15_000

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
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_WORKSPACE_ID',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_SKIP_MANTLE_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
])

const CLAUDE_BOOLEAN_ROUTING_ENVIRONMENT = new Set([
  'CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_SKIP_MANTLE_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
])

const GEMINI_BLOCKED_ENVIRONMENT = new Set([
  'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'CLOUDSDK_CORE_PROJECT',
  'GCLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_API_KEY',
  'GOOGLE_CLOUD_LOCATION',
  'GEMINI_API_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT_ID',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'GOOGLE_GENAI_USE_ENTERPRISE',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'VERTEX_AI_PROJECT',
  'VERTEX_AI_LOCATION',
])

const GEMINI_BOOLEAN_ROUTING_ENVIRONMENT = new Set([
  'GOOGLE_GENAI_USE_ENTERPRISE',
  'GOOGLE_GENAI_USE_VERTEXAI',
])

const CLAUDE_PERSONAL_SUBSCRIPTION_TYPES = new Set(['pro', 'max'])

const CLAUDE_ALLOWED_ROOT_AUTH_FIELDS = new Set([
  'loggedIn',
  'authMethod',
  'apiProvider',
  'subscriptionType',
])

const CLAUDE_AUTH_MARKER_KEY_TOKENS = new Set([
  'auth',
  'authentication',
  'authorization',
  'bedrock',
  'billing',
  'credential',
  'credentials',
  'endpoint',
  'entitlement',
  'foundry',
  'gateway',
  'mantle',
  'oauth',
  'provenance',
  'provider',
  'quota',
  'source',
  'subscription',
  'token',
  'vertex',
])

export type ClaudeManagedSettingsInspector = () => string[]

export function prepareNativePlanEnvironment(
  provider: NativeRuntimeProvider,
  source: NodeJS.ProcessEnv = process.env,
): PreparedNativePlanEnvironment {
  const blockedSet =
    provider === 'claude'
      ? CLAUDE_BLOCKED_ENVIRONMENT
      : GEMINI_BLOCKED_ENVIRONMENT
  const booleanRoutingSet =
    provider === 'claude'
      ? CLAUDE_BOOLEAN_ROUTING_ENVIRONMENT
      : GEMINI_BOOLEAN_ROUTING_ENVIRONMENT
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
    if (
      typeof value === 'string' &&
      value.trim() &&
      !(booleanRoutingSet.has(canonicalName) && isExplicitlyDisabled(value))
    ) {
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

  const runner = options.runner ?? runNativeProcess
  let result = await runAntigravityAuthCheck(
    runner,
    {
      executable: executablePath,
      args: ['models', '--json'],
      env: environment.env,
    },
    options.signal,
  )
  if (!result) return antigravityAuthCheckFailed(environment)
  let blockingDecision = classifyAntigravityBlockingSignals(
    [result.stdout, result.stderr],
    environment,
  )
  if (blockingDecision) {
    return { environment, decision: blockingDecision }
  }
  if (result.exitCode === 0) {
    const jsonDecision = classifyAntigravityQuotaProvenance(
      result.stdout,
      environment,
    )
    if (jsonDecision.status !== 'quota-unverified') {
      return { environment, decision: jsonDecision }
    }
    result = await runAntigravityAuthCheck(
      runner,
      {
        executable: executablePath,
        args: ['models'],
        env: environment.env,
      },
      options.signal,
    )
    if (!result) return antigravityAuthCheckFailed(environment)
    blockingDecision = classifyAntigravityBlockingSignals(
      [result.stdout, result.stderr],
      environment,
    )
    if (blockingDecision) {
      return { environment, decision: blockingDecision }
    }
    if (result.exitCode === 0) {
      return {
        environment,
        decision: classifyAntigravityTextCatalog(result.stdout, environment),
      }
    }
  } else {
    const failureText = `${result.stderr}\n${result.stdout}`
    if (!isLoginText(failureText)) {
      result = await runAntigravityAuthCheck(
        runner,
        {
          executable: executablePath,
          args: ['models'],
          env: environment.env,
        },
        options.signal,
      )
      if (!result) return antigravityAuthCheckFailed(environment)
      blockingDecision = classifyAntigravityBlockingSignals(
        [result.stdout, result.stderr],
        environment,
      )
      if (blockingDecision) {
        return { environment, decision: blockingDecision }
      }
      if (result.exitCode === 0) {
        return {
          environment,
          decision: classifyAntigravityTextCatalog(result.stdout, environment),
        }
      }
    }
  }

  const fallbackFailureText = `${result.stderr}\n${result.stdout}`
  return {
    environment,
    decision: {
      status: isLoginText(fallbackFailureText)
        ? 'login-required'
        : 'quota-unverified',
      allowed: false,
      reason: isLoginText(fallbackFailureText)
        ? 'Open Antigravity CLI and sign in with Google.'
        : 'Antigravity did not return a readable model catalog.',
      evidence: [
        isLoginText(fallbackFailureText)
          ? 'agy models reported signed out'
          : 'agy models did not return a successful catalog',
      ],
    },
  }
}

async function runAntigravityAuthCheck(
  runner: NativeProcessRunner,
  options: Omit<NativeProcessOptions, 'signal'>,
  externalSignal?: AbortSignal,
): Promise<Awaited<ReturnType<NativeProcessRunner>> | null> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else {
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true })
  }
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, ANTIGRAVITY_AUTH_TIMEOUT_MS)
  try {
    const result = await runner({ ...options, signal: controller.signal })
    if (externalSignal?.aborted) throw createAbortError()
    return timedOut ? null : result
  } catch {
    if (externalSignal?.aborted) throw createAbortError()
    return null
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromCaller)
  }
}

function antigravityAuthCheckFailed(
  environment: PreparedNativePlanEnvironment,
): RuntimeAuthVerification {
  return {
    environment,
    decision: {
      status: 'quota-unverified',
      allowed: false,
      reason:
        'Antigravity connection check timed out or failed. Retry from Plan connections.',
      evidence: ['agy model catalog check did not complete'],
    },
  }
}

function createAbortError(): Error {
  const error = new Error('Antigravity connection check was canceled.')
  error.name = 'AbortError'
  return error
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
  if (hasBlockedClaudeAuthMetadata(parsed)) {
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
      status: 'subscription',
      allowed: true,
      reason:
        'Claude Code reported an eligible first-party Pro/Max subscription login.',
      evidence: [
        'authMethod=claude.ai',
        'apiProvider=firstParty',
        `subscriptionType=${subscriptionType}`,
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
  const blockingDecision = classifyAntigravityBlockingSignals(
    [output],
    environment,
  )
  if (blockingDecision) return blockingDecision
  const parsed = parseJsonValue(output)

  if (!hasAntigravityJsonModelCatalog(parsed)) {
    return {
      status: 'quota-unverified',
      allowed: false,
      reason:
        'Antigravity did not return a readable JSON model catalog, so Gemini request readiness could not be confirmed.',
      evidence: ['agy models --json returned no readable models'],
    }
  }

  // Antigravity does not currently expose a supported personal-quota field.
  // For compatibility with the working 2.6.1 flow, a successful non-empty
  // catalog is accepted as login/readiness evidence only when neither the
  // environment nor the machine-readable response identifies Cloud billing.
  return {
    status: 'subscription',
    allowed: true,
    reason:
      'Antigravity is signed in and returned a usable model catalog. Gemini requests are enabled in compatibility mode; the CLI does not expose the account quota source to Smart Composer.',
    evidence: [
      'agy models --json returned a non-empty catalog',
      'no explicit API or Google Cloud override detected',
    ],
  }
}

export function classifyAntigravityTextCatalog(
  output: string,
  environment: PreparedNativePlanEnvironment = prepareNativePlanEnvironment(
    'gemini',
    {},
  ),
): RuntimeAuthDecision {
  const blockingDecision = classifyAntigravityBlockingSignals(
    [output],
    environment,
  )
  if (blockingDecision) return blockingDecision
  if (!hasAntigravityTextModelCatalog(output)) {
    return {
      status: 'quota-unverified',
      allowed: false,
      reason:
        'Antigravity did not return a readable text model catalog, so Gemini request readiness could not be confirmed.',
      evidence: ['agy models returned no readable models'],
    }
  }
  return {
    status: 'subscription',
    allowed: true,
    reason:
      'Antigravity is signed in and returned a usable legacy text model catalog. Gemini requests are enabled in compatibility mode; the CLI does not expose the account quota source to Smart Composer.',
    evidence: [
      'agy models returned a non-empty text catalog',
      'no explicit API or Google Cloud override detected',
    ],
  }
}

export function classifyAntigravityBlockingSignals(
  outputs: readonly string[],
  environment: PreparedNativePlanEnvironment = prepareNativePlanEnvironment(
    'gemini',
    {},
  ),
): RuntimeAuthDecision | undefined {
  if (environment.blockedVariables.length > 0) {
    return blockedEnvironmentDecision('Gemini', environment.blockedVariables)
  }
  const parsedOutputs: unknown[] = []
  const textOutputs: string[] = []
  for (const output of outputs) {
    const parsed = parseJsonValue(output)
    if (parsed === undefined) textOutputs.push(output)
    else parsedOutputs.push(parsed)
  }
  if (
    parsedOutputs.some((value) =>
      collectRecords(value).some(hasGoogleCloudMarker),
    ) ||
    textOutputs.some(hasPlainTextGoogleCloudMarker)
  ) {
    return {
      status: 'billing-blocked',
      allowed: false,
      reason:
        'Antigravity reported Google Cloud, ADC, enterprise, or consumption-billing provenance.',
      evidence: ['runtime output contains a Cloud billing marker'],
    }
  }
  if (
    parsedOutputs.some((value) =>
      collectRecords(value).some(hasAntigravityLoggedOutMarker),
    ) ||
    textOutputs.some(hasAntigravityLoginRequiredText)
  ) {
    return {
      status: 'login-required',
      allowed: false,
      reason: 'Open Antigravity CLI and sign in with Google.',
      evidence: ['agy models reported signed out'],
    }
  }
  return undefined
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

function hasBlockedClaudeAuthMetadata(
  record: Record<string, unknown>,
  isRoot = true,
): boolean {
  for (const [key, value] of Object.entries(record)) {
    if (isRoot && CLAUDE_ALLOWED_ROOT_AUTH_FIELDS.has(key)) {
      if (!isAllowedClaudeRootAuthField(key, value) && hasActiveMarker(value)) {
        return true
      }
    } else if (isClaudeAuthMarkerKey(key) && hasActiveMarker(value)) {
      return true
    }

    if (containsBlockedClaudeAuthMetadata(value)) return true
  }
  return false
}

function containsBlockedClaudeAuthMetadata(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsBlockedClaudeAuthMetadata)
  }
  return isRecord(value) ? hasBlockedClaudeAuthMetadata(value, false) : false
}

function isAllowedClaudeRootAuthField(key: string, value: unknown): boolean {
  if (key === 'loggedIn') return value === true
  const normalized = normalizedString(value)
  if (key === 'authMethod') return normalized === 'claude.ai'
  if (key === 'apiProvider') return normalized === 'firstparty'
  if (key === 'subscriptionType') {
    return (
      normalized !== undefined &&
      CLAUDE_PERSONAL_SUBSCRIPTION_TYPES.has(normalized)
    )
  }
  return false
}

function isClaudeAuthMarkerKey(key: string): boolean {
  const tokens = key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z\d]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
  const compact = tokens.join('')
  return (
    tokens.some((token) => CLAUDE_AUTH_MARKER_KEY_TOKENS.has(token)) ||
    /billing|credential|endpoint|entitlement|foundry|gateway|mantle|oauth|provenance|provider|quota|subscription|token|vertex|bedrock|apikey|managedsettings/.test(
      compact,
    ) ||
    compact === 'auth' ||
    compact.endsWith('auth') ||
    /authentication|authorization|auth(?:method|override|provider|source|status|token|enabled)/.test(
      compact,
    ) ||
    (compact.endsWith('source') && compact !== 'resource') ||
    compact === 'accounttype' ||
    compact === 'organizationtype' ||
    compact === 'plantype'
  )
}

function hasActiveMarker(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return false
}

function hasGoogleCloudMarker(record: Record<string, unknown>): boolean {
  for (const [name, value] of Object.entries(record)) {
    const compactName = compactFieldName(name)
    if (
      /^(?:adc|billingproject(?:id)?|cloud|consumptionbilling|enterprise|gcpproject(?:id)?|googlecloud|googlecloudproject(?:id)?|project(?:id)?|quotaproject(?:id)?|serviceaccount|usevertexai|vertex(?:ai)?)$/.test(
        compactName,
      ) &&
      hasActiveMarker(value)
    ) {
      return true
    }
    if (
      /^(?:detail|error|message|reason)$/.test(compactName) &&
      typeof value === 'string' &&
      hasPlainTextGoogleCloudMarker(value)
    ) {
      return true
    }
  }
  return [
    record.authMethod,
    record.accountType,
    record.auth,
    record.billingSource,
    record.method,
    record.provider,
    record.quotaSource,
    record.source,
  ]
    .map(normalizedString)
    .filter((value): value is string => value !== undefined)
    .some((value) =>
      /cloud|enterprise|adc|service[_ -]?account|consumption/.test(value),
    )
}

function hasPlainTextGoogleCloudMarker(value: string): boolean {
  return /\b(?:adc|enterprise|google\s+cloud|service[_ -]?account|vertex)\b|\bconsumption(?:[- ]billing)?\b|\b(?:billing|quota)?\s*project(?:\s+id)?\s*[:=]/i.test(
    value,
  )
}

function hasAntigravityLoggedOutMarker(
  record: Record<string, unknown>,
): boolean {
  for (const [name, value] of Object.entries(record)) {
    const compactName = compactFieldName(name)
    if (
      /^(?:authenticated|isauthenticated|issignedin|isloggedin|loggedin|signedin)$/.test(
        compactName,
      ) &&
      value === false
    ) {
      return true
    }
    if (
      /^(?:loginrequired|requireslogin)$/.test(compactName) &&
      value === true
    ) {
      return true
    }
    const normalized = normalizedString(value)
    if (
      normalized &&
      /^(?:auth(?:entication)?status|loginstatus|sessionstatus|state|status)$/.test(
        compactName,
      ) &&
      /^(?:logged[_ -]?out|signed[_ -]?out|login[_ -]?required|not[_ -]?authenticated|unauthenticated|unauthorized)$/.test(
        normalized,
      )
    ) {
      return true
    }
    if (
      /^(?:detail|error|message|reason)$/.test(compactName) &&
      typeof value === 'string' &&
      hasAntigravityLoginRequiredText(value)
    ) {
      return true
    }
  }
  return false
}

function hasAntigravityLoginRequiredText(value: string): boolean {
  return /\b(?:not\s+(?:signed|logged)\s*in|(?:please\s+)?sign\s*in(?:\s+with\s+google)?|(?:please\s+)?log\s*in(?:\s+with\s+google)?|login\s+required|unauthenticated|unauthorized|authentication\s+(?:failed|required)|no\s+(?:valid\s+)?credentials?)\b/i.test(
    value,
  )
}

function compactFieldName(value: string): string {
  return value.replace(/[^a-zA-Z\d]+/g, '').toLowerCase()
}

function hasAntigravityTextModelCatalog(value: string): boolean {
  const ansiSequence = new RegExp(
    `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
    'g',
  )
  return value
    .replace(ansiSequence, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .some(
      (line) =>
        !/^(?:available\s+models?|models?|name\s+slug|loading|current)\b/i.test(
          line,
        ) &&
        /\b(?:gemini[-_.][a-z0-9][a-z0-9._-]*|gemini\s+\d+(?:\.\d+)?(?:\s+[a-z0-9]+)*)\b/i.test(
          line,
        ),
    )
}

function collectRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectRecords)
  if (!isRecord(value)) return []
  return [value, ...Object.values(value).flatMap(collectRecords)]
}

function hasAntigravityJsonModelCatalog(value: unknown): boolean {
  return hasAntigravityCatalogEntries(value, Array.isArray(value))
}

function hasAntigravityCatalogEntries(
  value: unknown,
  insideCatalog: boolean,
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasAntigravityCatalogEntries(entry, true))
  }
  if (!isRecord(value)) return false
  for (const key of ['models', 'data', 'items', 'availableModels']) {
    if (key in value && hasAntigravityCatalogEntries(value[key], true)) {
      return true
    }
  }
  return insideCatalog && hasAntigravityModelRecord(value)
}

function hasAntigravityModelRecord(value: unknown): boolean {
  if (!isRecord(value)) return false
  return ['slug', 'id', 'value', 'name'].some((key) => {
    const candidate = value[key]
    return typeof candidate === 'string' && candidate.trim().length > 0
  })
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseJsonValue(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : undefined
}

function isExplicitlyDisabled(value: string): boolean {
  return /^(?:0|false)$/i.test(value.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLoginText(value: string): boolean {
  return /not signed|sign.?in|log.?in|authentication|unauthorized|credential/i.test(
    value,
  )
}
