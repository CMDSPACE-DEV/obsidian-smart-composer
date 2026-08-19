import type { App } from 'obsidian'

import {
  deserializeMentionable,
  getMentionableKey,
  serializeMentionable,
} from './mentionable'

describe('research mentionables', () => {
  const app = {
    vault: {
      getFileByPath: () => null,
      getFolderByPath: () => null,
    },
  } as unknown as App

  it('round-trips a research source through chat history', () => {
    const mentionable = {
      type: 'research-source' as const,
      sourceId: 'wos' as const,
      name: 'Web of Science Starter',
    }
    const serialized = serializeMentionable(mentionable)

    expect(serialized).toEqual(mentionable)
    expect(deserializeMentionable(serialized, app)).toEqual(mentionable)
    expect(getMentionableKey(serialized)).toBe('research-source:wos')
  })

  it('round-trips a research pack through chat history', () => {
    const mentionable = {
      type: 'research-pack' as const,
      packId: 'korean-academic' as const,
      name: 'Korean Academic',
    }
    const serialized = serializeMentionable(mentionable)

    expect(serialized).toEqual(mentionable)
    expect(deserializeMentionable(serialized, app)).toEqual(mentionable)
    expect(getMentionableKey(serialized)).toBe('research-pack:korean-academic')
  })
})
