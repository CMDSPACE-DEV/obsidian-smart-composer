import { RequestMessage } from '../../../types/llm/request'

export function buildNativePrompt(messages: RequestMessage[]): {
  systemPrompt: string
  prompt: string
} {
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
  const transcript = messages
    .filter((message) => message.role !== 'system')
    .map((message) => formatMessage(message))
    .join('\n\n')

  return {
    systemPrompt: [
      systemPrompt,
      'You are running inside Smart Composer. Do not read, write, search, or execute files and commands directly. Use only the Smart Composer tools supplied for this request. Return the requested answer in Markdown.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    prompt: [
      'Continue the following conversation and answer the final user request.',
      transcript,
    ].join('\n\n'),
  }
}

function formatMessage(message: Exclude<RequestMessage, { role: 'system' }>) {
  if (message.role === 'tool') {
    return `[TOOL RESULT ${message.tool_call.name}]\n${message.content}`
  }
  if (message.role === 'assistant') {
    return `[ASSISTANT]\n${message.content}`
  }
  const content =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .map((part) =>
            part.type === 'text'
              ? part.text
              : '[Image attachment included separately when supported]',
          )
          .join('\n')
  return `[USER]\n${content}`
}
