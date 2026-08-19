import { App } from 'obsidian'

import { migrateToJsonDatabaseIfNeeded } from './migrateToJsonDatabase'

describe('migrateToJsonDatabaseIfNeeded', () => {
  it('does not initialize the legacy PGlite database after migration completed', async () => {
    const exists = jest.fn(async () => true)
    const app = {
      vault: {
        adapter: { exists },
      },
    } as unknown as App
    const getDatabaseManager = jest.fn()

    await expect(
      migrateToJsonDatabaseIfNeeded(app, getDatabaseManager),
    ).resolves.toBe(false)

    expect(exists).toHaveBeenCalledTimes(1)
    expect(getDatabaseManager).not.toHaveBeenCalled()
  })
})
