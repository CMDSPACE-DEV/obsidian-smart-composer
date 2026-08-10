import {
  classifyAntigravityQuotaProvenance,
  classifyClaudeAuthStatus,
  prepareNativePlanEnvironment,
  verifyAntigravityPlanAuth,
  verifyClaudePlanAuth,
} from './NativeRuntimeAuth'

describe('Claude Plan billing guard', () => {
  it.each(['pro', 'max'])(
    'allows a clean first-party %s subscription fixture',
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
      ).toEqual({
        status: 'subscription',
        allowed: true,
        reason:
          'Claude Code reported an eligible first-party Pro/Max subscription login.',
        evidence: [
          'authMethod=claude.ai',
          'apiProvider=firstParty',
          `subscriptionType=${subscriptionType}`,
        ],
      })
    },
  )

  it('allows unrelated identity fields without retaining them as evidence', () => {
    const decision = classifyClaudeAuthStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        subscriptionType: 'max',
        email: 'private@example.test',
        accountId: 'private-account-id',
        author: 'private-author-label',
        resource: 'private-resource-label',
        organization: {
          id: 'private-organization-id',
          displayName: 'Private organization',
        },
      }),
    )

    expect(decision).toMatchObject({
      status: 'subscription',
      allowed: true,
    })
    expect(JSON.stringify(decision)).not.toContain('private')
  })

  it.each([
    ['unknown billing source', { billingSource: 'future-source' }],
    ['enabled gateway', { gateway: true }],
    [
      'nested unknown provenance string',
      { metadata: { billingProvenance: 'future-provenance' } },
    ],
    [
      'nested unknown provenance object',
      { metadata: { quotaProvenance: { kind: 'future' } } },
    ],
    ['nested unknown provenance number', { metadata: { provenance: 7 } }],
    [
      'compact lowercase provenance marker',
      { metadata: { billingprovenance: true } },
    ],
  ])(
    'fails closed for %s on an otherwise clean Max tuple',
    (_label, marker) => {
      expect(
        classifyClaudeAuthStatus(
          JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            apiProvider: 'firstParty',
            subscriptionType: 'max',
            ...marker,
          }),
        ),
      ).toMatchObject({
        status: 'billing-blocked',
        allowed: false,
        evidence: ['auth metadata contains a non-subscription billing marker'],
      })
    },
  )

  it.each(['pro', 'max'])(
    'blocks a first-party %s fixture with an API helper marker',
    (subscriptionType) => {
      expect(
        classifyClaudeAuthStatus(
          JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            apiProvider: 'firstParty',
            subscriptionType,
            apiKeySource: 'apiKeyHelper',
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
      'Mantle billing marker',
      {
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        subscriptionType: 'max',
        billingSource: 'Amazon Bedrock Mantle',
      },
    ],
    [
      'unknown credential source',
      {
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        subscriptionType: 'pro',
        credentialSource: 'future-source',
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

  it('allows verified Pro auth when the environment and managed settings are clean', async () => {
    const runner = jest.fn().mockResolvedValue({
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        subscriptionType: 'pro',
      }),
      stderr: '',
      exitCode: 0,
    })
    const environment = prepareNativePlanEnvironment('claude', {
      PATH: '/safe/bin',
    })

    const verification = await verifyClaudePlanAuth('/runtime/claude', {
      environment,
      runner,
      managedSettingsInspector: () => [],
    })

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: '/runtime/claude',
        args: ['auth', 'status'],
        env: { PATH: '/safe/bin' },
      }),
    )
    expect(verification.decision).toMatchObject({
      status: 'subscription',
      allowed: true,
    })
  })

  it.each([
    'ANTHROPIC_AWS_API_KEY',
    'ANTHROPIC_AWS_BASE_URL',
    'ANTHROPIC_AWS_WORKSPACE_ID',
    'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
    'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
    'ANTHROPIC_FOUNDRY_RESOURCE',
    'ANTHROPIC_VERTEX_PROJECT_ID',
    'ANTHROPIC_WORKSPACE_ID',
    'AWS_BEARER_TOKEN_BEDROCK',
    'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
    'CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH',
    'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
    'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
    'CLAUDE_CODE_SKIP_MANTLE_AUTH',
    'CLAUDE_CODE_SKIP_VERTEX_AUTH',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS',
    'CLAUDE_CODE_USE_MANTLE',
  ])('blocks and removes the documented Claude routing override %s', (name) => {
    const environment = prepareNativePlanEnvironment('claude', {
      PATH: '/safe/bin',
      [name]: 'must-never-reach-claude',
    })

    expect(environment.env).toEqual({ PATH: '/safe/bin' })
    expect(environment.blockedVariables).toEqual([name])
    expect(JSON.stringify(environment)).not.toContain('must-never-reach-claude')
  })

  it('does not treat ambient AWS credentials or disabled provider toggles as active routing', () => {
    const environment = prepareNativePlanEnvironment('claude', {
      PATH: '/safe/bin',
      AWS_ACCESS_KEY_ID: 'ambient-access-id',
      AWS_SECRET_ACCESS_KEY: 'ambient-secret',
      AWS_SESSION_TOKEN: 'ambient-session',
      AWS_PROFILE: 'ambient-profile',
      AWS_REGION: 'us-east-1',
      ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION: 'us-west-2',
      CLAUDE_CODE_USE_BEDROCK: '0',
      CLAUDE_CODE_USE_MANTLE: 'false',
    })

    expect(environment.blockedVariables).toEqual([])
    expect(environment.env).toEqual({
      PATH: '/safe/bin',
      AWS_ACCESS_KEY_ID: 'ambient-access-id',
      AWS_SECRET_ACCESS_KEY: 'ambient-secret',
      AWS_SESSION_TOKEN: 'ambient-session',
      AWS_PROFILE: 'ambient-profile',
      AWS_REGION: 'us-east-1',
      ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION: 'us-west-2',
    })
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

  it('fails closed when managed settings inspection throws', async () => {
    const runner = jest.fn()
    const verification = await verifyClaudePlanAuth('/runtime/claude', {
      environment: prepareNativePlanEnvironment('claude', {
        PATH: '/safe/bin',
      }),
      runner,
      managedSettingsInspector: () => {
        throw new Error('inspection failure must not escape')
      },
    })

    expect(runner).not.toHaveBeenCalled()
    expect(verification.decision).toMatchObject({
      status: 'billing-blocked',
      allowed: false,
      evidence: ['managed settings inspection failed closed'],
    })
    expect(JSON.stringify(verification)).not.toContain(
      'inspection failure must not escape',
    )
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
