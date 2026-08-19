import {
  ToolCallResponse,
  ToolCallResponseStatus,
} from '../../../types/tool-call.types'

export function nativeToolResultToText(response: ToolCallResponse): {
  text: string
  isError: boolean
} {
  switch (response.status) {
    case ToolCallResponseStatus.Success:
      return {
        text: response.data.text,
        isError: false,
      }
    case ToolCallResponseStatus.Error:
      return {
        text: response.error,
        isError: true,
      }
    case ToolCallResponseStatus.Aborted:
      return {
        text: 'Tool execution was canceled.',
        isError: true,
      }
    case ToolCallResponseStatus.PendingApproval:
      return {
        text: 'Tool execution requires approval in Smart Composer.',
        isError: true,
      }
    case ToolCallResponseStatus.Rejected:
      return {
        text: 'Tool execution was rejected.',
        isError: true,
      }
    case ToolCallResponseStatus.Running:
      return {
        text: 'Tool execution did not reach a terminal state.',
        isError: true,
      }
  }
}
