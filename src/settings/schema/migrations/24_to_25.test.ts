import { migrateFrom24To25 } from './24_to_25'

describe('migrateFrom24To25', () => {
  it('enables full auto and expands the old one-round default', () => {
    const result = migrateFrom24To25({
      version: 24,
      mcp: {
        routingMode: 'auto',
        connections: [{ id: 'connection' }],
      },
      chatOptions: {
        includeCurrentFileContent: true,
        enableTools: true,
        maxAutoIterations: 1,
      },
    })

    expect(result).toEqual(
      expect.objectContaining({
        version: 25,
        mcp: expect.objectContaining({
          routingMode: 'auto',
          executionMode: 'full-auto',
          connections: [{ id: 'connection' }],
        }),
        chatOptions: expect.objectContaining({
          maxAutoIterations: 12,
        }),
      }),
    )
  })

  it('preserves a larger user-defined automatic round limit', () => {
    const result = migrateFrom24To25({
      version: 24,
      mcp: { routingMode: 'on-demand', connections: [] },
      chatOptions: { maxAutoIterations: 24 },
    })

    expect(
      (result.chatOptions as Record<string, unknown>).maxAutoIterations,
    ).toBe(24)
  })
})
