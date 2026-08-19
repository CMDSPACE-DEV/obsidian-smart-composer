import {
  NAVER_DEFAULT_DAILY_LIMIT,
  isNaverApiHubHost,
  parseResearchUsageLimit,
  recordResearchUsage,
  summarizeResearchUsage,
  toSeoulDayKey,
} from './ResearchUsage'

describe('ResearchUsage', () => {
  it('uses Korea Standard Time for daily counters', () => {
    expect(toSeoulDayKey(Date.parse('2026-07-27T14:59:59Z'))).toBe('2026-07-27')
    expect(toSeoulDayKey(Date.parse('2026-07-27T15:00:00Z'))).toBe('2026-07-28')
  })

  it('records responses and summarizes the current day and month', () => {
    let usage = recordResearchUsage(undefined, {
      at: Date.parse('2026-07-27T06:00:00Z'),
      succeeded: true,
    })
    usage = recordResearchUsage(usage, {
      at: Date.parse('2026-07-27T07:00:00Z'),
      succeeded: false,
    })
    usage = recordResearchUsage(usage, {
      at: Date.parse('2026-07-26T07:00:00Z'),
      succeeded: true,
    })

    expect(
      summarizeResearchUsage(usage, Date.parse('2026-07-27T08:00:00Z')),
    ).toMatchObject({
      today: { requests: 2, succeeded: 1, failed: 1 },
      month: { requests: 3, succeeded: 2, failed: 1 },
    })
  })

  it('recognizes only the NAVER API HUB host', () => {
    expect(isNaverApiHubHost('naverapihub.apigw.ntruss.com')).toBe(true)
    expect(isNaverApiHubHost('openapi.naver.com')).toBe(false)
  })

  it('parses editable console limits without accepting invalid values', () => {
    expect(parseResearchUsageLimit('775,000', 1)).toBe(775_000)
    expect(
      parseResearchUsageLimit('not-a-number', NAVER_DEFAULT_DAILY_LIMIT),
    ).toBe(NAVER_DEFAULT_DAILY_LIMIT)
  })
})
