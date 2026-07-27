import { SettingMigration } from '../setting.types'

const DEFAULT_AUTO_TOOL_ROUNDS = 12

export const migrateFrom24To25: SettingMigration['migrate'] = (data) => {
  const mcp = isRecord(data.mcp) ? data.mcp : {}
  const chatOptions = isRecord(data.chatOptions) ? data.chatOptions : {}
  const previousRounds =
    typeof chatOptions.maxAutoIterations === 'number'
      ? chatOptions.maxAutoIterations
      : 1

  return {
    ...data,
    version: 25,
    mcp: {
      ...mcp,
      executionMode: 'full-auto',
    },
    chatOptions: {
      ...chatOptions,
      maxAutoIterations:
        previousRounds <= 1 ? DEFAULT_AUTO_TOOL_ROUNDS : previousRounds,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
