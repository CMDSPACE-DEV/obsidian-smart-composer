import { TFile } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import type SmartComposerPlugin from '../../main'
import type { BackgroundTaskRecord } from '../../types/background-task'
import type { CompiledVaultReferences } from '../references/VaultReferenceCompiler'

import { DocumentJobRepository } from './DocumentJobRepository'
import {
  splitMarkdownForDocumentEdit,
  stableTextHash,
} from './markdownSplitter'
import type {
  DocumentEditJobManifest,
  DocumentEditPlacement,
  DocumentEditStrategy,
} from './types'

export async function createDocumentEditJob(input: {
  plugin: SmartComposerPlugin
  sessionId: string
  sourcePath: string
  sourceDocument: string
  sourceFrom: number
  sourceTo: number
  sourceSelection: string
  instruction: string
  placement: DocumentEditPlacement
  strategy: DocumentEditStrategy
  modelId: string
  references: CompiledVaultReferences
}): Promise<{
  task: BackgroundTaskRecord
  manifest: DocumentEditJobManifest
}> {
  const manager = input.plugin.backgroundTaskManager
  if (!manager) throw new Error('The background task manager is unavailable.')

  const file = input.plugin.app.vault.getFileByPath(input.sourcePath)
  if (!(file instanceof TFile)) {
    throw new Error('The source note is no longer available.')
  }

  const jobId = uuidv4()
  let units = splitMarkdownForDocumentEdit(input.sourceSelection, {
    preserveFrontmatter:
      input.plugin.settings.documentEditing.preserveFrontmatter &&
      input.sourceFrom === 0,
  })
  if (input.strategy === 'map-reduce') {
    units = units.map((unit) =>
      unit.protected
        ? {
            ...unit,
            protected: false,
            status: 'pending' as const,
            reviewChoice: 'edited' as const,
          }
        : unit,
    )
  }
  if (units.length === 0) {
    throw new Error('The selected document range contains no editable text.')
  }

  const repository = new DocumentJobRepository(input.plugin.app)
  let manifest = await repository.createJob(
    {
      jobId,
      sourcePath: input.sourcePath,
      sourceMtime: file.stat.mtime,
      sourceDocumentChecksum: stableTextHash(input.sourceDocument),
      sourceFrom: input.sourceFrom,
      sourceTo: input.sourceTo,
      source: input.sourceSelection,
      placement: input.placement,
      instruction: input.instruction,
      modelId: input.modelId,
      strategy: input.strategy,
      referenceText: input.references.promptText,
      referenceSnapshots: input.references.sourceFiles,
      preserveFrontmatter:
        input.plugin.settings.documentEditing.preserveFrontmatter,
    },
    units,
  )
  const task = await manager.enqueue({
    conversationId: `inline:${input.sourcePath}`,
    originMessageId: input.sessionId,
    kind: 'document-edit',
    payload: {
      jobId,
      sourcePath: input.sourcePath,
      strategy: input.strategy,
      placement: input.placement,
      phase: manifest.phase,
      instruction: input.instruction,
      totalSections: units.length,
      completedSections: 0,
      failedSections: 0,
      warnings: input.references.warnings,
    },
  })
  manifest = await repository.saveManifest({
    ...manifest,
    taskId: task.id,
    warnings: Array.from(new Set(input.references.warnings)),
  })
  return { task, manifest }
}
