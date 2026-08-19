import { SettingMigration } from '../setting.types'

export const migrateFrom21To22: SettingMigration['migrate'] = (data) => ({
  ...data,
  version: 22,
  documentEditing: {
    largeEditRouting: 'auto-confirm',
    destinationFolder: 'Smart Composer/Document Drafts',
    preserveFrontmatter: true,
    concurrency: 1,
    retryLimit: 2,
  },
})
