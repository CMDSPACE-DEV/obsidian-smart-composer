import { SettingMigration } from '../setting.types'

export const migrateFrom23To24: SettingMigration['migrate'] = (data) => {
  const research = isRecord(data.research) ? data.research : {}
  const sources = isRecord(research.sources) ? research.sources : {}
  return {
    ...data,
    version: 24,
    research: {
      ...research,
      sources: Object.fromEntries(
        Object.entries(sources).map(([sourceId, source]) => [
          sourceId,
          {
            ...(isRecord(source) ? source : {}),
            usage:
              isRecord(source) && isRecord(source.usage)
                ? source.usage
                : { days: {} },
          },
        ]),
      ),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
