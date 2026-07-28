import {
  getInternalRagModel,
  shouldSurfacePlanRequestError,
} from './internalModel'

describe('getInternalRagModel', () => {
  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'uses none effort for %s',
    (model) => {
      expect(
        getInternalRagModel({
          providerType: 'openai-plan',
          providerId: 'openai-plan',
          id: `${model} (plan)`,
          model,
          reasoning: {
            reasoning_effort: 'max',
            reasoning_summary: 'detailed',
          },
        }),
      ).toMatchObject({
        reasoning: { reasoning_effort: 'none' },
      })
    },
  )

  it.each(['default', 'opus', 'claude-sonnet-5'])(
    'explicitly disables Claude Plan adaptive thinking for %s',
    (model) => {
      expect(
        getInternalRagModel({
          providerType: 'anthropic-plan',
          providerId: 'anthropic-plan',
          id: `${model} (plan)`,
          model,
          thinking: {
            enabled: true,
            mode: 'adaptive',
            effort: 'xhigh',
            display: 'omitted',
          },
        }),
      ).toMatchObject({
        thinking: {
          enabled: false,
          mode: 'adaptive',
          effort: 'xhigh',
          display: 'omitted',
        },
      })
    },
  )

  it('keeps legacy behavior for manual thinking models', () => {
    expect(
      getInternalRagModel({
        providerType: 'anthropic',
        providerId: 'anthropic',
        id: 'legacy',
        model: 'legacy',
        thinking: { enabled: true, budget_tokens: 8192 },
      }),
    ).toMatchObject({ thinking: undefined })
  })
})

describe('shouldSurfacePlanRequestError', () => {
  it.each([400, 403, 404, 429])(
    'allows local fallback for HTTP %s',
    (status) => {
      expect(shouldSurfacePlanRequestError({ status })).toBe(false)
    },
  )

  it('surfaces only authentication failures', () => {
    expect(shouldSurfacePlanRequestError({ status: 401 })).toBe(true)
    expect(shouldSurfacePlanRequestError({ code: 'model_mismatch' })).toBe(
      false,
    )
    expect(shouldSurfacePlanRequestError(new Error('invalid JSON'))).toBe(false)
  })
})
