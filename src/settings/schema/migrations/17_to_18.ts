import { SettingMigration } from '../setting.types'

export const migrateFrom17To18: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 18

  newData.ragOptions = {
    ...(typeof newData.ragOptions === 'object' && newData.ragOptions !== null
      ? newData.ragOptions
      : {}),
    folderReadMode:
      (newData.ragOptions as { folderReadMode?: unknown } | undefined)
        ?.folderReadMode ?? 'auto',
    exhaustiveDirectTokenLimit:
      (
        newData.ragOptions as
          | { exhaustiveDirectTokenLimit?: unknown }
          | undefined
      )?.exhaustiveDirectTokenLimit ?? 60000,
  }

  return newData
}
