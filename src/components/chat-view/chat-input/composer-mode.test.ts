import {
  getComposerSendLabel,
  getComposerSubmission,
  toggleComposerMode,
} from './composer-mode'

describe('composer mode', () => {
  it('toggles one-shot modes and keeps vault and image mutually exclusive', () => {
    expect(toggleComposerMode('chat', 'vault')).toBe('vault')
    expect(toggleComposerMode('vault', 'vault')).toBe('chat')
    expect(toggleComposerMode('vault', 'image')).toBe('image')
    expect(toggleComposerMode('image', 'vault')).toBe('vault')
  })

  it('maps the visual mode to the existing submission contract', () => {
    expect(getComposerSubmission('chat')).toEqual({
      useVaultSearch: false,
      mode: 'chat',
    })
    expect(getComposerSubmission('vault')).toEqual({
      useVaultSearch: true,
      mode: 'chat',
    })
    expect(getComposerSubmission('image')).toEqual({
      useVaultSearch: false,
      mode: 'image',
    })
  })

  it('describes whether send will run now or join a queue', () => {
    expect(getComposerSendLabel('chat', false)).toBe('Send message')
    expect(getComposerSendLabel('vault', false)).toBe('Send with vault search')
    expect(getComposerSendLabel('chat', true)).toBe('Add prompt to queue')
    expect(getComposerSendLabel('image', true)).toBe(
      'Add image generation to queue',
    )
  })
})
