import { SettingMigration } from '../setting.types'

/**
 * Runtime installation, authentication, version, and catalog data describe
 * one machine. Remove the old synced cache while preserving every portable
 * user choice and provider/model selection verbatim.
 */
export const migrateFrom28To29: SettingMigration['migrate'] = (data) => {
  const { nativeRuntimes: _deviceRuntimeHealth, ...portableSettings } = data
  return {
    ...portableSettings,
    version: 29,
  }
}
