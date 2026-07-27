import { SettingMigration } from '../setting.types'

export const migrateFrom25To26: SettingMigration['migrate'] = (data) => {
  const research = isRecord(data.research) ? data.research : {}
  const sources = isRecord(research.sources) ? research.sources : {}
  const riss = isRecord(sources.riss) ? sources.riss : null

  return {
    ...data,
    version: 26,
    ...(riss
      ? {
          research: {
            ...research,
            sources: {
              ...sources,
              riss: {
                ...riss,
                autoPolicy:
                  riss.autoPolicy === 'off' ? 'off' : ('allow' as const),
              },
            },
          },
        }
      : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
