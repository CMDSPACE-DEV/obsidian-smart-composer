export type DocumentEditStrategy = 'map-reduce' | 'transform'
export type DocumentEditPlacement = 'replace' | 'insert-after'

export type DocumentEditSpecification = {
  goal: string
  preserve: string[]
  transform: string[]
  outputLanguage?: string
  formattingRules: string[]
  forbiddenChanges: string[]
}

export type DocumentEditUnitStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'

export type DocumentEditUnit = {
  id: string
  index: number
  from: number
  to: number
  headingPath: string[]
  checksum: string
  protected: boolean
  status: DocumentEditUnitStatus
  attempt: number
  outputPath?: string
  error?: string
  completionReason?: string
  reviewChoice?: 'edited' | 'source'
}

export type DocumentReductionCheckpoint = {
  id: string
  level: number
  index: number
  inputPaths: string[]
  status: DocumentEditUnitStatus
  attempt: number
  outputPath?: string
  error?: string
  completionReason?: string
}

export type DocumentEditPhase =
  | 'planning'
  | 'processing'
  | 'reducing'
  | 'assembling'
  | 'blocked'
  | 'review'
  | 'complete'

export type DocumentReferenceSnapshot = {
  path: string
  mtime: number
  size: number
}

export type DocumentEditJobManifest = {
  schemaVersion: 1
  jobId: string
  taskId?: string
  sourcePath: string
  sourceMtime: number
  sourceChecksum: string
  sourceSelectionChecksum: string
  sourceFrom: number
  sourceTo: number
  placement: DocumentEditPlacement
  instruction: string
  modelId: string
  strategy: DocumentEditStrategy
  phase: DocumentEditPhase
  specification?: DocumentEditSpecification
  referenceSnapshots: DocumentReferenceSnapshot[]
  sourceSnapshotPath: string
  referenceSnapshotPath?: string
  units: DocumentEditUnit[]
  reductions: DocumentReductionCheckpoint[]
  reductionLevel: number
  finalResultPath?: string
  draftPath?: string
  warnings: string[]
  createdAt: number
  updatedAt: number
}

export type DocumentEditAnalysis = {
  strategy: DocumentEditStrategy
  estimatedSourceTokens: number
  estimatedOutputTokens: number
  estimatedChunks: number
  shouldPromote: boolean
  reason: string
}

export type CreateDocumentEditJobInput = {
  jobId: string
  sourcePath: string
  sourceMtime: number
  sourceDocumentChecksum: string
  sourceFrom: number
  sourceTo: number
  source: string
  placement: DocumentEditPlacement
  instruction: string
  modelId: string
  strategy: DocumentEditStrategy
  referenceText: string
  referenceSnapshots: DocumentReferenceSnapshot[]
  preserveFrontmatter: boolean
}
