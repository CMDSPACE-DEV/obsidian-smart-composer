import { SmartComposerSettings } from '../../settings/schema/setting.types'

import { getProviderClient } from './manager'
import { AntigravityProvider } from './native/AntigravityProvider'
import { ClaudeAgentProvider } from './native/ClaudeAgentProvider'

describe('getProviderClient native Plan runtimes', () => {
  it('selects the Claude Agent SDK provider', () => {
    const provider = getProviderClient({
      providerId: 'anthropic-plan',
      settings: {
        providers: [{ type: 'anthropic-plan', id: 'anthropic-plan' }],
      } as SmartComposerSettings,
    })

    expect(provider).toBeInstanceOf(ClaudeAgentProvider)
  })

  it('selects the Antigravity CLI provider', () => {
    const provider = getProviderClient({
      providerId: 'gemini-plan',
      settings: {
        providers: [{ type: 'gemini-plan', id: 'gemini-plan' }],
      } as SmartComposerSettings,
    })

    expect(provider).toBeInstanceOf(AntigravityProvider)
  })
})
