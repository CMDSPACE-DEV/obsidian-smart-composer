import {
  classifyAntigravityQuotaProvenance,
  classifyClaudeAuthStatus,
  prepareNativePlanEnvironment,
  verifyAntigravityPlanAuth,
  verifyClaudePlanAuth,
} from './NativeRuntimeAuth'

describe('Claude Plan billing guard', () => {
  it.each(['pro', 'max'])(
    'keeps an apparent first-party %s fixture blocked without effective provenance',
    (subscriptionType) => {
      expect(
        classifyClaudeAuthStatus(
          JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            apiProvider: 'firstParty',
            subscriptionType,
            apiKeySource: '/login managed key',
          }),
        ),
      ).toMatchObject({ status: 'billing-blocked', allowed: false })
    },
  )

  it.each(['team', 'enterprise'])(
    'fails closed for %s until managed billing provenance is machine-readable',
    (subscriptionType) => {
      expect(
        classifyClaudeAuthStatus(
          JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            apiProvider: 'firstParty',
            subscriptionType,
          }),
        ),
      ).toMatchObject({ status: 'billing-blocked', allowed: false })
    },
  )

  it.each([
    [
      'Console',
      {
        loggedIn: true,
        authMethod: 'console',
        apiProvider: 'firstParty',
        subscriptionType: null,
      },
    ],
    [
      'cloud provider',
      {
        loggedIn: true,
        authMethod: 'oauth',
        apiProvider: 'bedrock',
        subscriptionType: 'max',
      },
    ],
    [
      'apiKeyHelper override',
      {
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        subscriptionType: 'pro',
        apiKeySource: 'apiKeyHelper',
      },
    ],
    [
      'unknown future schema',
      { loggedIn: true, authMethod: 'oauth_token', apiProvider: 'firstParty' },
    ],
  ])('fails closed for %s auth', (_label, fixture) => {
    expect(classifyClaudeAuthStatus(JSON.stringify(fixture))).toMatchObject({
      status: 'billing-blocked',
      allowed: false,
    })
  })

  it('returns login-required only for an explicit logged-out fixture', () => {
    expect(
      classifyClaudeAuthStatus(JSON.stringify({ loggedIn: false })),
    ).toMatchObject({ status: 'login-required', allowed: false })
    expect(classifyClaudeAuthStatus('not-json')).toMatchObject({
      status: 'billing-blocked',
      allowed: false,
    })
  })

  it('redacts credential values and blocks before invoking auth status', async () => {
    const environment = prepareNativePlanEnvironment('claude', {
      PATH: '/safe/bin',
      ANTHROPIC_API_KEY: 'must-never-be-retained',
      CLAUDE_CODE_USE_VERTEX: '1',
    })
    const runner = jest.fn()

    const verification = await verifyClaudePlanAuth('/runtime/claude', {
      environment,
      runner,
    })

    expect(runner).not.toHaveBeenCalled()
    expect(verification.decision).toMatchObject({
      status: 'billing-blocked',
      allowed: false,
    })
    expect(environment.env).toEqual({ PATH: '/safe/bin' })
    expect(environment.blockedVariables).toEqual([
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_USE_VERTEX',
    ])
    expect(JSON.stringify(verification)).not.toContain('must-never-be-retained')
  })

  it('blocks mixed-case credential names used by Windows environments', () => {
    const environment = prepareNativePlanEnvironment('claude', {
      Path: 'C:\\safe\\bin',
      anthropic_api_key: 'must-never-reach-claude',
      Claude_Code_Use_Bedrock: '1',
    })

    expect(environment.env).toEqual({ Path: 'C:\\safe\\bin' })
    expect(environment.blockedVariables).toEqual([
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_USE_BEDROCK',
    ])
    expect(JSON.stringify(environment)).not.toContain('must-never-reach-claude')
  })

  it('blocks managed settings before invoking auth status', async () => {
    const runner = jest.fn()
    const verification = await verifyClaudePlanAuth('/runtime/claude', {
      environment: prepareNativePlanEnvironment('claude', {
        PATH: '/safe/bin',
      }),
      runner,
      managedSettingsInspector: () => [
        'managed settings file present',
        'machine policy registry present',
      ],
    })

    expect(runner).not.toHaveBeenCalled()
    expect(verification.decision).toMatchObject({
      status: 'billing-blocked',
      allowed: false,
    })
    expect(verification.decision.evidence).toEqual([
      'managed settings file present',
      'machine policy registry present',
    ])
  })
})

describe('Gemini Plan quota guard', () => {
  it('blocks Google Cloud environment provenance without retaining values', () => {
    const environment = prepareNativePlanEnvironment('gemini', {
      PATH: '/safe/bin',
      GOOGLE_CLOUD_PROJECT: 'private-project-id',
    })
    const decision = classifyAntigravityQuotaProvenance('{}', environment)

    expect(decision).toMatchObject({
      status: 'billing-blocked',
      allowed: false,
    })
    expect(environment.env).toEqual({ PATH: '/safe/bin' })
    expect(JSON.stringify(decision)).not.toContain('private-project-id')
  })

  it('blocks mixed-case Google Cloud credential names', () => {
    const environment = prepareNativePlanEnvironment('gemini', {
      Path: 'C:\\safe\\bin',
      google_application_credentials: 'C:\\secret\\adc.json',
    })

    expect(environment.env).toEqual({ Path: 'C:\\safe\\bin' })
    expect(environment.blockedVariables).toEqual([
      'GOOGLE_APPLICATION_CREDENTIALS',
    ])
    expect(JSON.stringify(environment)).not.toContain('adc.json')
  })

  it('does not mistake a successful model catalog for personal Plan quota', () => {
    expect(
      classifyAntigravityQuotaProvenance(
        JSON.stringify({ models: [{ id: 'gemini-pro' }] }),
      ),
    ).toMatchObject({ status: 'quota-unverified', allowed: false })
  })

  it('keeps a successful models --json preflight blocked until Google exposes provenance', async () => {
    const runner = jest.fn().mockResolvedValue({
      stdout: JSON.stringify({ models: [{ id: 'gemini-pro' }] }),
      stderr: '',
      exitCode: 0,
    })

    const verification = await verifyAntigravityPlanAuth('/runtime/agy', {
      environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
      runner,
    })

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['models', '--json'] }),
    )
    expect(verification.decision).toMatchObject({
      status: 'quota-unverified',
      allowed: false,
    })
  })

  it('blocks machine-readable Cloud and service-account markers', () => {
    expect(
      classifyAntigravityQuotaProvenance(
        JSON.stringify({
          account: { authMethod: 'service_account' },
          projectId: 'redacted-by-test-fixture',
        }),
      ),
    ).toMatchObject({ status: 'billing-blocked', allowed: false })
  })
})
