import type { App } from 'obsidian'

import { fuzzySearchWithConnections } from './fuzzy-search'

jest.mock('fuzzysort', () => ({
  __esModule: true,
  default: {
    go: () => [],
  },
}))

describe('fuzzySearchWithConnections', () => {
  it('exposes an enabled RISS source to the @ mention picker', () => {
    const app = {
      workspace: {
        getActiveFile: () => null,
        getLeavesOfType: () => [],
      },
      vault: {
        getFiles: () => [],
        getAllFolders: () => [],
      },
    } as unknown as App

    const results = fuzzySearchWithConnections(
      app,
      'riss',
      [],
      [
        {
          type: 'research-source',
          sourceId: 'riss',
          name: 'RISS Linked Data',
        },
      ],
    )

    expect(results).toEqual([
      {
        type: 'research-source',
        sourceId: 'riss',
        name: 'RISS Linked Data',
      },
    ])
  })
})
