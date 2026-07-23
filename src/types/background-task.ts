export type BackgroundTaskKind =
  | 'image-generation'
  | 'artifact-draft'
  | 'artifact-write'
  | 'mcp-reserved'

export type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting-destination'
  | 'awaiting-approval'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'interrupted'

export type BackgroundTaskRecord = {
  schemaVersion: 1
  id: string
  conversationId: string
  originMessageId: string
  kind: BackgroundTaskKind
  status: BackgroundTaskStatus
  attempt: number
  createdAt: number
  updatedAt: number
  progress?: {
    phase: string
    current?: number
    total?: number
    message?: string
  }
  input: Record<string, unknown>
  artifactIds: string[]
  error?: string
}

export type ArtifactKind = 'image' | 'canvas' | 'base' | 'excalidraw'

export type ArtifactRecord = {
  schemaVersion: 1
  id: string
  taskId: string
  kind: ArtifactKind
  createdAt: number
  localPath?: string
  remoteUrl?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  checksum?: string
  metadata?: Record<string, string | number | boolean>
}

export type BackgroundTaskRunResult = {
  status: 'awaiting-destination' | 'awaiting-approval' | 'succeeded'
  artifactIds?: string[]
  input?: Record<string, unknown>
}

export type BackgroundTaskRunContext = {
  signal: AbortSignal
  updateProgress: (
    progress: NonNullable<BackgroundTaskRecord['progress']>,
  ) => Promise<void>
}

export type BackgroundTaskAdapter = {
  readonly kind: BackgroundTaskKind
  run(
    task: BackgroundTaskRecord,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult>
}
