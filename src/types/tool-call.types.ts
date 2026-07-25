export type ToolCallRequest = {
  id: string
  name: string
  arguments?: string
}

export type ToolCallResponse =
  | {
      status:
        | ToolCallResponseStatus.PendingApproval
        | ToolCallResponseStatus.Rejected
        | ToolCallResponseStatus.Running
    }
  | {
      status: ToolCallResponseStatus.Success
      data: {
        type: 'text'
        text: string
        structuredContent?: Record<string, unknown>
        artifactIds?: string[]
        truncated?: boolean
      }
    }
  | {
      status: ToolCallResponseStatus.Error
      error: string
    }
  | {
      status: ToolCallResponseStatus.Aborted
    }

export enum ToolCallResponseStatus {
  PendingApproval = 'pending_approval',
  Rejected = 'rejected',
  Running = 'running',
  Success = 'success',
  Error = 'error',
  Aborted = 'aborted',
}
