import { DEFAULT_RESEARCH_SOURCES } from '../../../types/research.types'
import { SettingMigration } from '../setting.types'

export const migrateFrom22To23: SettingMigration['migrate'] = (data) => ({
  ...data,
  version: 23,
  research: {
    routingMode: 'auto',
    maxAutoSources: 2,
    sources: DEFAULT_RESEARCH_SOURCES,
  },
})
