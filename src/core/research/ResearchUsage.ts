import type {
  ResearchUsage,
  ResearchUsageBucket,
} from '../../types/research.types'

export const NAVER_DEFAULT_DAILY_LIMIT = 25_000
export const NAVER_DEFAULT_MONTHLY_LIMIT = 775_000
export const NAVER_API_HUB_HOST = 'naverapihub.apigw.ntruss.com'

const RETAIN_DAYS = 93

export type ResearchUsageSummary = {
  today: ResearchUsageBucket
  month: ResearchUsageBucket
  lastRequestAt?: number
}

export function isNaverApiHubHost(hostname: string): boolean {
  return hostname.toLocaleLowerCase() === NAVER_API_HUB_HOST
}

export function recordResearchUsage(
  usage: ResearchUsage | undefined,
  {
    at,
    succeeded,
  }: {
    at: number
    succeeded: boolean
  },
): ResearchUsage {
  const dayKey = toSeoulDayKey(at)
  const days = { ...(usage?.days ?? {}) }
  const current = days[dayKey] ?? emptyUsageBucket()
  days[dayKey] = {
    requests: current.requests + 1,
    succeeded: current.succeeded + (succeeded ? 1 : 0),
    failed: current.failed + (succeeded ? 0 : 1),
  }

  const retainedKeys = Object.keys(days).sort().slice(-RETAIN_DAYS)
  return {
    days: Object.fromEntries(retainedKeys.map((key) => [key, days[key]])),
    lastRequestAt: at,
  }
}

export function summarizeResearchUsage(
  usage: ResearchUsage | undefined,
  at = Date.now(),
): ResearchUsageSummary {
  const dayKey = toSeoulDayKey(at)
  const monthKey = dayKey.slice(0, 7)
  const today = usage?.days[dayKey] ?? emptyUsageBucket()
  const month = Object.entries(usage?.days ?? {})
    .filter(([key]) => key.startsWith(`${monthKey}-`))
    .reduce<ResearchUsageBucket>(
      (total, [, bucket]) => ({
        requests: total.requests + bucket.requests,
        succeeded: total.succeeded + bucket.succeeded,
        failed: total.failed + bucket.failed,
      }),
      emptyUsageBucket(),
    )
  return {
    today,
    month,
    lastRequestAt: usage?.lastRequestAt,
  }
}

export function parseResearchUsageLimit(
  value: unknown,
  fallback: number,
): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.replace(/,/g, ''), 10)
        : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export function toSeoulDayKey(at: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at))
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${values.year}-${values.month}-${values.day}`
}

function emptyUsageBucket(): ResearchUsageBucket {
  return { requests: 0, succeeded: 0, failed: 0 }
}
