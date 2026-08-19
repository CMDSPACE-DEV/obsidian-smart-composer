export type ComposerMode = 'chat' | 'vault' | 'image'

export function toggleComposerMode(
  currentMode: ComposerMode,
  requestedMode: Exclude<ComposerMode, 'chat'>,
): ComposerMode {
  return currentMode === requestedMode ? 'chat' : requestedMode
}

export function getComposerSubmission(mode: ComposerMode): {
  useVaultSearch: boolean
  mode: 'chat' | 'image'
} {
  return {
    useVaultSearch: mode === 'vault',
    mode: mode === 'image' ? 'image' : 'chat',
  }
}

export function getComposerSendLabel(
  mode: ComposerMode,
  foregroundPending: boolean,
): string {
  if (mode === 'image') {
    return 'Add image generation to queue'
  }
  if (foregroundPending) {
    return 'Add prompt to queue'
  }
  if (mode === 'vault') {
    return 'Send with vault search'
  }
  return 'Send message'
}
