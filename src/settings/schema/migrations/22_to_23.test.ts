import { RESEARCH_SOURCE_IDS } from '../../../types/research.types'

import { migrateFrom22To23 } from './22_to_23'

describe('Migrate from version 22 to 23', () => {
  it('adds disabled research connections without changing existing settings', () => {
    const previous = {
      version: 22,
      chatModelId: 'gpt-5.6-sol (plan)',
      mcp: {
        routingMode: 'auto',
        connections: [{ id: 'existing-law' }],
      },
    }

    const result = migrateFrom22To23(previous)

    expect(result).toMatchObject({
      version: 23,
      chatModelId: 'gpt-5.6-sol (plan)',
      mcp: previous.mcp,
      research: {
        routingMode: 'auto',
        maxAutoSources: 2,
      },
    })
    const sources = (result.research as { sources: Record<string, unknown> })
      .sources
    expect(Object.keys(sources)).toEqual(RESEARCH_SOURCE_IDS)
    expect(
      Object.values(sources).every(
        (source) => !(source as { enabled: boolean }).enabled,
      ),
    ).toBe(true)
    expect(
      (
        sources.kosis as {
          autoPolicy: string
        }
      ).autoPolicy,
    ).toBe('explicit-only')
  })
})
