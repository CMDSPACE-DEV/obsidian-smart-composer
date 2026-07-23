import { ChatMessage } from '../../types/chat'

export function hasVisibleResponseOutput(messages: ChatMessage[]): boolean {
  return messages.some((message) => {
    if (message.role === 'tool') return true
    if (message.role !== 'assistant') return false
    return (
      message.content.trim().length > 0 ||
      !!message.reasoning?.trim() ||
      !!message.annotations?.length
    )
  })
}
