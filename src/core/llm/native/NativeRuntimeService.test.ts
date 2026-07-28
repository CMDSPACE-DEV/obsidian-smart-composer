jest.mock('obsidian', () => ({
  Platform: { isDesktop: true },
}))

import { parseAntigravityModels } from './NativeRuntimeService'

describe('parseAntigravityModels', () => {
  it('parses a JSON model catalog with stable slugs', () => {
    expect(
      parseAntigravityModels(
        JSON.stringify({
          models: [
            {
              slug: 'gemini-3.5-flash',
              displayName: 'Gemini 3.5 Flash',
              description: 'Fast model',
            },
            {
              slug: 'gemini-3.1-pro',
              displayName: 'Gemini 3.1 Pro',
            },
          ],
        }),
      ),
    ).toEqual([
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        description: 'Fast model',
      },
      {
        id: 'gemini-3.1-pro',
        label: 'Gemini 3.1 Pro',
        description: undefined,
      },
    ])
  })

  it('parses the human-readable models command without headings', () => {
    expect(
      parseAntigravityModels(`
Available models
  Gemini 3.5 Flash (High)   gemini-3.5-flash
  Gemini 3.1 Pro (High)     gemini-3.1-pro
      `),
    ).toEqual([
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash (High)',
      },
      {
        id: 'gemini-3.1-pro',
        label: 'Gemini 3.1 Pro (High)',
      },
    ])
  })

  it('deduplicates repeated catalog rows', () => {
    expect(
      parseAntigravityModels(
        JSON.stringify([
          { id: 'gemini-pro', name: 'Gemini Pro' },
          { id: 'gemini-pro', name: 'Gemini Pro duplicate' },
        ]),
      ),
    ).toHaveLength(1)
  })
})
