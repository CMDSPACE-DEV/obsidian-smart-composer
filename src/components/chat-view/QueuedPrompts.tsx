import { Pencil, Play, Send, X } from 'lucide-react'

import { QueuedPrompt } from '../../core/conversation/ConversationRunManager'

export function QueuedPrompts({
  prompts,
  onCancel,
  onEdit,
  onSendNow,
  paused,
  onResume,
}: {
  prompts: QueuedPrompt[]
  onCancel: (prompt: QueuedPrompt) => void
  onEdit: (prompt: QueuedPrompt) => void
  onSendNow: (prompt: QueuedPrompt) => void
  paused: boolean
  onResume: () => void
}) {
  if (prompts.length === 0) return null
  return (
    <div className="smtcmp-prompt-queue" aria-label="Queued prompts">
      <div className="smtcmp-prompt-queue__title">
        Queue · {prompts.length}
        {paused && (
          <button onClick={onResume}>
            <Play size={13} /> Resume
          </button>
        )}
      </div>
      {prompts.map((prompt, index) => (
        <div className="smtcmp-prompt-queue__item" key={prompt.id}>
          <span>{index + 1}</span>
          <div>Prompt waiting</div>
          <button onClick={() => onEdit(prompt)} aria-label="Edit prompt">
            <Pencil size={13} />
          </button>
          <button onClick={() => onSendNow(prompt)} aria-label="Send now">
            <Send size={13} />
          </button>
          <button onClick={() => onCancel(prompt)} aria-label="Cancel prompt">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
