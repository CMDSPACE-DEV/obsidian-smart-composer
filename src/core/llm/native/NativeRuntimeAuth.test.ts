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

describe('Gemini Plan compatibility guard', () => {
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

  it('blocks active Enterprise and Vertex routing but ignores disabled values', () => {
    const active = prepareNativePlanEnvironment('gemini', {
      PATH: '/safe/bin',
      GOOGLE_GENAI_USE_ENTERPRISE: 'true',
      GOOGLE_GENAI_USE_VERTEXAI: 'true',
      GOOGLE_CLOUD_LOCATION: 'private-location',
    })
    const disabled = prepareNativePlanEnvironment('gemini', {
      PATH: '/safe/bin',
      GOOGLE_GENAI_USE_ENTERPRISE: '0',
      GOOGLE_GENAI_USE_VERTEXAI: 'false',
    })

    expect(active.blockedVariables).toEqual([
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_GENAI_USE_ENTERPRISE',
      'GOOGLE_GENAI_USE_VERTEXAI',
    ])
    expect(active.env).toEqual({ PATH: '/safe/bin' })
    expect(JSON.stringify(active)).not.toContain('private-location')
    expect(disabled.blockedVariables).toEqual([])
    expect(disabled.env).toEqual({ PATH: '/safe/bin' })
  })

  it('allows a non-empty model catalog without claiming a proven quota source', () => {
    const decision = classifyAntigravityQuotaProvenance(
      JSON.stringify({ models: [{ id: 'gemini-pro' }] }),
    )

    expect(decision).toMatchObject({
      status: 'subscription',
      allowed: true,
    })
    expect(decision.reason).toContain('compatibility mode')
    expect(decision.reason).toContain(
      'does not expose the account quota source',
    )
  })

  it('accepts nested JSON catalog wrappers used by model-list commands', () => {
    expect(
      classifyAntigravityQuotaProvenance(
        JSON.stringify({
          data: { items: [{ name: 'gemini-pro', label: 'Gemini Pro' }] },
        }),
      ),
    ).toMatchObject({ status: 'subscription', allowed: true })
  })

  it('allows a successful non-empty models --json request preflight', async () => {
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
      status: 'subscription',
      allowed: true,
    })
  })

  it('allows a non-empty legacy text catalog when --json is unavailable', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'unknown option',
        exitCode: 2,
      })
      .mockResolvedValueOnce({
        stdout: 'Gemini Pro  gemini-pro',
        stderr: '',
        exitCode: 0,
      })

    const verification = await verifyAntigravityPlanAuth('/runtime/agy', {
      environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
      runner,
    })

    expect(runner).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ args: ['models'] }),
    )
    expect(verification.decision).toMatchObject({
      status: 'subscription',
      allowed: true,
    })
  })

  it.each([
    ['empty JSON', JSON.stringify({ models: [] })],
    ['plain text from --json', 'Gemini Pro  gemini-pro'],
  ])(
    'retries %s with the legacy catalog command',
    async (_label, jsonOutput) => {
      const runner = jest
        .fn()
        .mockResolvedValueOnce({
          stdout: jsonOutput,
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: 'Gemini Pro  gemini-pro',
          stderr: '',
          exitCode: 0,
        })

      const verification = await verifyAntigravityPlanAuth('/runtime/agy', {
        environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
        runner,
      })

      expect(runner).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ args: ['models'] }),
      )
      expect(verification.decision).toMatchObject({
        status: 'subscription',
        allowed: true,
      })
    },
  )

  it.each([
    ['empty object', '{}'],
    ['empty model list', JSON.stringify({ models: [] })],
    ['malformed JSON', '{"models":'],
    ['heading-only text', 'Gemini Models'],
  ])(
    'blocks a successful command with an unreadable %s catalog',
    async (_label, stdout) => {
      const runner = jest.fn().mockResolvedValue({
        stdout,
        stderr: '',
        exitCode: 0,
      })

      const verification = await verifyAntigravityPlanAuth('/runtime/agy', {
        environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
        runner,
      })

      expect(verification.decision).toMatchObject({
        status: 'quota-unverified',
        allowed: false,
      })
    },
  )

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

  it.each([
    'billingProjectId',
    'quota_project_id',
    'google_cloud_project',
    'consumptionBilling',
  ])('blocks an active normalized Cloud field %s', (field) => {
    expect(
      classifyAntigravityQuotaProvenance(
        JSON.stringify({
          models: [{ id: 'gemini-pro' }],
          [field]: 'private-cloud-marker',
        }),
      ),
    ).toMatchObject({ status: 'billing-blocked', allowed: false })
  })

  it.each([
    'enterprise',
    'vertex',
    'vertexAI',
    'useVertexAI',
    'cloud',
    'googleCloud',
  ])('blocks an active machine-readable routing key %s', (field) => {
    expect(
      classifyAntigravityQuotaProvenance(
        JSON.stringify({
          models: [{ id: 'gemini-pro' }],
          [field]: true,
        }),
      ),
    ).toMatchObject({ status: 'billing-blocked', allowed: false })
  })

  it.each([
    'enterprise',
    'vertex',
    'vertexAI',
    'useVertexAI',
    'cloud',
    'googleCloud',
  ])('allows inactive machine-readable routing key %s', (field) => {
    for (const value of [false, null, '']) {
      expect(
        classifyAntigravityQuotaProvenance(
          JSON.stringify({
            models: [{ id: 'gemini-pro' }],
            [field]: value,
          }),
        ),
      ).toMatchObject({ status: 'subscription', allowed: true })
    }
  })

  it.each([null, '', false])(
    'does not block an inactive project marker %p',
    (project) => {
      expect(
        classifyAntigravityQuotaProvenance(
          JSON.stringify({
            models: [{ id: 'gemini-pro' }],
            project,
          }),
        ),
      ).toMatchObject({ status: 'subscription', allowed: true })
    },
  )

  it('does not treat model description copy as a Cloud routing marker', () => {
    expect(
      classifyAntigravityQuotaProvenance(
        JSON.stringify({
          models: [
            {
              id: 'gemini-pro',
              description: 'Enterprise-ready model for complex projects',
            },
          ],
        }),
      ),
    ).toMatchObject({ status: 'subscription', allowed: true })
  })

  it('never falls back around a machine-readable Cloud marker', async () => {
    const runner = jest.fn().mockResolvedValue({
      stdout: JSON.stringify({
        models: [{ id: 'gemini-pro' }],
        account: { authMethod: 'adc' },
      }),
      stderr: '',
      exitCode: 0,
    })

    const verification = await verifyAntigravityPlanAuth('/runtime/agy', {
      environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
      runner,
    })

    expect(verification.decision).toMatchObject({
      status: 'billing-blocked',
      allowed: false,
    })
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['nonzero stdout', 2, 'Google Cloud project: private-project', ''],
    ['nonzero stderr', 2, '', 'consumption billing enabled'],
    [
      'JSON stderr error',
      2,
      '',
      JSON.stringify({ error: 'Google Cloud project private-project' }),
    ],
    [
      'JSON stderr message',
      2,
      '',
      JSON.stringify({ message: 'consumption billing enabled' }),
    ],
    [
      'exit-zero stderr',
      0,
      JSON.stringify({ models: [{ id: 'gemini-pro' }] }),
      'ADC credentials active',
    ],
  ])(
    'blocks %s Cloud output before fallback',
    async (_label, exitCode, stdout, stderr) => {
      const runner = jest.fn().mockResolvedValue({
        stdout,
        stderr,
        exitCode,
      })

      const verification = await verifyAntigravityPlanAuth('/runtime/agy', {
        environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
        runner,
      })

      expect(verification.decision).toMatchObject({
        status: 'billing-blocked',
        allowed: false,
      })
      expect(runner).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    { loggedIn: false },
    { authenticated: false },
    { signedIn: false },
    { loginRequired: true },
    { authStatus: 'signed_out' },
    { error: 'not signed in' },
    { message: 'login required' },
    { error: 'Sign in with Google' },
    { detail: 'Please log in with Google' },
  ])('prioritizes JSON signed-out marker %p over models', (marker) => {
    expect(
      classifyAntigravityQuotaProvenance(
        JSON.stringify({ models: [{ id: 'gemini-pro' }], ...marker }),
      ),
    ).toMatchObject({ status: 'login-required', allowed: false })
  })

  it('prioritizes exit-zero sign-in stderr over a JSON catalog', async () => {
    const runner = jest.fn().mockResolvedValue({
      stdout: JSON.stringify({ models: [{ id: 'gemini-pro' }] }),
      stderr: 'Please sign in with Google',
      exitCode: 0,
    })

    const verification = await verifyAntigravityPlanAuth('/runtime/agy', {
      environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
      runner,
    })

    expect(verification.decision).toMatchObject({
      status: 'login-required',
      allowed: false,
    })
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('prioritizes a text signed-out marker over fallback model rows', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'unknown option',
        exitCode: 2,
      })
      .mockResolvedValueOnce({
        stdout: 'Not signed in\nGemini Pro  gemini-pro',
        stderr: '',
        exitCode: 0,
      })

    const verification = await verifyAntigravityPlanAuth('/runtime/agy', {
      environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
      runner,
    })

    expect(verification.decision).toMatchObject({
      status: 'login-required',
      allowed: false,
    })
  })

  it('times out a hanging catalog preflight without exposing late output', async () => {
    jest.useFakeTimers()
    try {
      const runner = jest.fn(
        (options: { signal?: AbortSignal }) =>
          new Promise<{ stdout: string; stderr: string; exitCode: number }>(
            (resolve) => {
              options.signal?.addEventListener(
                'abort',
                () =>
                  resolve({
                    stdout: 'private-account private-project',
                    stderr: 'private-path',
                    exitCode: 1,
                  }),
                { once: true },
              )
            },
          ),
      )
      const verificationPromise = verifyAntigravityPlanAuth('/runtime/agy', {
        environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
        runner,
      })

      await jest.advanceTimersByTimeAsync(15_000)
      const verification = await verificationPromise

      expect(verification.decision).toMatchObject({
        status: 'quota-unverified',
        allowed: false,
      })
      expect(JSON.stringify(verification)).not.toContain('private-')
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('combines and propagates an external cancellation without leaking output', async () => {
    const controller = new AbortController()
    const runner = jest.fn(
      (options: { signal?: AbortSignal }) =>
        new Promise<{ stdout: string; stderr: string; exitCode: number }>(
          (resolve) => {
            options.signal?.addEventListener(
              'abort',
              () =>
                resolve({
                  stdout: 'private-account',
                  stderr: 'private-project',
                  exitCode: 1,
                }),
              { once: true },
            )
          },
        ),
    )
    const verificationPromise = verifyAntigravityPlanAuth('/runtime/agy', {
      environment: prepareNativePlanEnvironment('gemini', { PATH: '/safe' }),
      runner,
      signal: controller.signal,
    })

    controller.abort()

    await expect(verificationPromise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Antigravity connection check was canceled.',
    })
  })
})
