import { migrateFrom23To24 } from './23_to_24'

describe('Migrate from version 23 to 24', () => {
  it('adds empty usage counters without changing research configuration', () => {
    const previous = {
      version: 23,
      research: {
        routingMode: 'explicit',
        maxAutoSources: 3,
        sources: {
          naver: {
            enabled: true,
            autoPolicy: 'allow',
            options: { vertical: 'news' },
          },
          openalex: {
            enabled: false,
            autoPolicy: 'explicit-only',
            options: {},
          },
        },
      },
    }

    expect(migrateFrom23To24(previous)).toEqual({
      version: 24,
      research: {
        routingMode: 'explicit',
        maxAutoSources: 3,
        sources: {
          naver: {
            enabled: true,
            autoPolicy: 'allow',
            options: { vertical: 'news' },
            usage: { days: {} },
          },
          openalex: {
            enabled: false,
            autoPolicy: 'explicit-only',
            options: {},
            usage: { days: {} },
          },
        },
      },
    })
  })

  it('preserves existing usage counters', () => {
    const usage = {
      days: {
        '2026-07-27': { requests: 18, succeeded: 18, failed: 0 },
      },
      lastRequestAt: 1_785_130_200_000,
    }

    const result = migrateFrom23To24({
      version: 23,
      research: {
        sources: {
          naver: { enabled: true, usage },
        },
      },
    })

    expect(
      (
        (
          (result.research as Record<string, unknown>).sources as Record<
            string,
            unknown
          >
        ).naver as Record<string, unknown>
      ).usage,
    ).toEqual(usage)
  })
})
