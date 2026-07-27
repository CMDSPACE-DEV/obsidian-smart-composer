import { migrateFrom25To26 } from './25_to_26'

describe('migrateFrom25To26', () => {
  it('enables RISS auto routing while preserving existing source data', () => {
    const result = migrateFrom25To26({
      version: 25,
      research: {
        routingMode: 'auto',
        maxAutoSources: 3,
        sources: {
          riss: {
            enabled: true,
            autoPolicy: 'explicit-only',
            options: { custom: 'preserved' },
            lastTestedAt: 123,
          },
          naver: {
            enabled: true,
            autoPolicy: 'allow',
            options: {},
          },
        },
      },
    })

    expect(result).toMatchObject({
      version: 26,
      research: {
        routingMode: 'auto',
        maxAutoSources: 3,
        sources: {
          riss: {
            enabled: true,
            autoPolicy: 'allow',
            options: { custom: 'preserved' },
            lastTestedAt: 123,
          },
          naver: {
            enabled: true,
            autoPolicy: 'allow',
            options: {},
          },
        },
      },
    })
  })

  it('keeps an explicitly disabled RISS source out of auto routing', () => {
    const result = migrateFrom25To26({
      version: 25,
      research: {
        sources: {
          riss: {
            enabled: true,
            autoPolicy: 'off',
            options: {},
          },
        },
      },
    })

    expect(
      (
        (result.research as Record<string, unknown>).sources as Record<
          string,
          Record<string, unknown>
        >
      ).riss.autoPolicy,
    ).toBe('off')
  })
})
