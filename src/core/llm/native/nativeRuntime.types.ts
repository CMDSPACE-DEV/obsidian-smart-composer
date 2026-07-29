import {
  ToolCallRequest,
  ToolCallResponse,
} from '../../../types/tool-call.types'

export type NativeRuntimeProvider = 'claude' | 'gemini'

export type NativeRuntimeStatus =
  | 'not-installed'
  | 'login-required'
  | 'ready'
  | 'update-available'
  | 'error'

export type NativeRuntimeModel = {
  id: string
  label: string
  description?: string
}

export type NativeRuntimeDiagnostics = {
  provider: NativeRuntimeProvider
  status: NativeRuntimeStatus
  executablePath?: string
  version?: string
  models: NativeRuntimeModel[]
  error?: string
  warning?: string
}

export type NativeToolExecutor = (
  request: ToolCallRequest,
) => Promise<ToolCallResponse>
