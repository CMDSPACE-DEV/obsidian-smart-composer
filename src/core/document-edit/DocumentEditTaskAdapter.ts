import { v4 as uuidv4 } from 'uuid'

import type SmartComposerPlugin from '../../main'
import type {
  ArtifactRecord,
  BackgroundTaskAdapter,
  BackgroundTaskRecord,
  BackgroundTaskRunContext,
  BackgroundTaskRunResult,
} from '../../types/background-task'
import type { BackgroundTaskManager } from '../tasks/BackgroundTaskManager'

import { DocumentJobRepository } from './DocumentJobRepository'
import { splitMarkdownForDocumentEdit } from './markdownSplitter'
import {
  buildChunkSystemPrompt,
  buildFallbackSpecification,
  buildReductionSystemPrompt,
  buildSpecificationSystemPrompt,
  parseSpecification,
} from './prompts'
import type {
  DocumentEditJobManifest,
  DocumentEditUnit,
  DocumentReductionCheckpoint,
} from './types'
import { validateDocumentAssembly } from './validation'

const OVERLAP_CHARACTERS = 1_500
const REDUCTION_BATCH_CHARACTERS = 30_000
const MIN_SPLIT_CHARACTERS = 2_000

class OutputLimitedError extends Error {}
class ContentRefusalError extends Error {}

export class DocumentEditTaskAdapter implements BackgroundTaskAdapter {
  readonly kind = 'document-edit' as const
  private readonly repository: DocumentJobRepository

  constructor(
    private readonly plugin: SmartComposerPlugin,
    private readonly taskManager: BackgroundTaskManager,
  ) {
    this.repository = new DocumentJobRepository(plugin.app)
  }

  getMaxConcurrency(): number {
    return this.plugin.settings.documentEditing.concurrency
  }

  async run(
    task: BackgroundTaskRecord,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult> {
    const jobId = readString(task.input.jobId, 'Document job ID is missing.')
    let manifest = await this.repository.readManifest(jobId)
    if (!manifest.taskId) {
      manifest = await this.repository.saveManifest({
        ...manifest,
        taskId: task.id,
      })
    }
    switch (manifest.phase) {
      case 'planning':
        return this.plan(task, manifest, context)
      case 'processing':
        return this.processUnit(task, manifest, context)
      case 'reducing':
        return this.reduce(task, manifest, context)
      case 'assembling':
        return this.assemble(task, manifest, context)
      case 'blocked':
      case 'review':
        return {
          status: 'review',
          input: this.taskInput(task, manifest),
        }
      case 'complete':
        return {
          status: 'succeeded',
          artifactIds: task.artifactIds,
          input: this.taskInput(task, manifest),
        }
    }
  }

  private async plan(
    task: BackgroundTaskRecord,
    manifest: DocumentEditJobManifest,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult> {
    await context.updateProgress({
      phase: 'planning',
      current: 0,
      total: manifest.units.length,
      message: 'Preparing one stable edit specification',
    })
    const references = await this.repository.readReferences(manifest)
    let specification = buildFallbackSpecification(manifest.instruction)
    try {
      const response = await this.generate(
        manifest.modelId,
        buildSpecificationSystemPrompt(),
        JSON.stringify({
          instruction: manifest.instruction,
          placement: manifest.placement,
          referencedGuidance: references.slice(0, 24_000) || undefined,
        }),
        context.signal,
      )
      if (response.reason !== 'length' && response.content) {
        specification = parseSpecification(
          response.content,
          manifest.instruction,
        )
      }
    } catch (error) {
      if (context.signal.aborted) throw error
      manifest.warnings.push(
        `The planning response failed; the original instruction is being used directly: ${errorMessage(error)}`,
      )
    }
    const next = await this.repository.saveManifest({
      ...manifest,
      specification,
      phase: 'processing',
    })
    return { status: 'queued', input: this.taskInput(task, next) }
  }

  private async processUnit(
    task: BackgroundTaskRecord,
    manifest: DocumentEditJobManifest,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult> {
    const pending = manifest.units.find((unit) => unit.status === 'pending')
    if (!pending) {
      const failed = manifest.units.filter((unit) => unit.status === 'failed')
      if (failed.length > 0) {
        const blocked = await this.repository.saveManifest({
          ...manifest,
          phase: 'blocked',
          warnings: unique([
            ...manifest.warnings,
            `${failed.length} section${failed.length === 1 ? '' : 's'} require retry or source fallback.`,
          ]),
        })
        return { status: 'review', input: this.taskInput(task, blocked) }
      }
      const next = await this.repository.saveManifest({
        ...manifest,
        phase: manifest.strategy === 'map-reduce' ? 'reducing' : 'assembling',
      })
      return { status: 'queued', input: this.taskInput(task, next) }
    }

    const completed = manifest.units.filter(
      (unit) => unit.status === 'succeeded',
    ).length
    await context.updateProgress({
      phase: 'processing',
      current: completed,
      total: manifest.units.length,
      message: `Editing section ${pending.index + 1} of ${manifest.units.length}`,
    })
    const source = await this.repository.readSource(manifest)
    const references = await this.repository.readReferences(manifest)
    const running: DocumentEditUnit = {
      ...pending,
      status: 'running',
      attempt: pending.attempt + 1,
      error: undefined,
    }
    manifest = await this.replaceUnit(manifest, running)
    const sourceChunk = source.slice(running.from, running.to)
    try {
      const response = await this.generateWithRetries({
        modelId: manifest.modelId,
        system: buildChunkSystemPrompt(
          manifest.strategy,
          manifest.specification ??
            buildFallbackSpecification(manifest.instruction),
        ),
        user: JSON.stringify({
          headingPath: running.headingPath,
          source: sourceChunk,
          before: source.slice(
            Math.max(0, running.from - OVERLAP_CHARACTERS),
            running.from,
          ),
          after: source.slice(running.to, running.to + OVERLAP_CHARACTERS),
          referencedGuidance: references.slice(0, 32_000) || undefined,
        }),
        signal: context.signal,
        retryLimit: this.plugin.settings.documentEditing.retryLimit,
      })
      if (response.reason === 'length') {
        if (sourceChunk.length > MIN_SPLIT_CHARACTERS * 2) {
          const split = await this.splitUnit(manifest, running, sourceChunk)
          return { status: 'queued', input: this.taskInput(task, split) }
        }
        throw new OutputLimitedError(
          'The provider output limit was reached for the smallest safe section.',
        )
      }
      if (isRefusalReason(response.reason)) {
        throw new ContentRefusalError(
          `The provider did not complete this section (${response.reason ?? 'unknown reason'}).`,
        )
      }
      if (!response.content.trim()) {
        throw new Error('The model returned an empty section.')
      }
      const output = preserveTransformBoundaries(
        sourceChunk,
        response.content,
        manifest.strategy,
      )
      const outputPath = await this.repository.writeUnitOutput(
        manifest.jobId,
        running.id,
        output,
      )
      const succeeded: DocumentEditUnit = {
        ...running,
        status: 'succeeded',
        outputPath,
        completionReason: response.reason ?? undefined,
        reviewChoice: 'edited',
      }
      const next = await this.replaceUnit(manifest, succeeded)
      return { status: 'queued', input: this.taskInput(task, next) }
    } catch (error) {
      if (context.signal.aborted) {
        await this.replaceUnit(manifest, {
          ...running,
          status: 'pending',
          error: undefined,
        })
        throw error
      }
      if (isAuthenticationError(error)) {
        const reset = await this.replaceUnit(manifest, {
          ...running,
          status: 'pending',
          error: errorMessage(error),
        })
        return {
          status: 'waiting-connection',
          input: this.taskInput(task, reset),
        }
      }
      const failed = await this.replaceUnit(manifest, {
        ...running,
        status: 'failed',
        error: errorMessage(error),
        completionReason:
          error instanceof OutputLimitedError
            ? 'length'
            : error instanceof ContentRefusalError
              ? 'refusal'
              : 'error',
      })
      return { status: 'queued', input: this.taskInput(task, failed) }
    }
  }

  private async reduce(
    task: BackgroundTaskRecord,
    manifest: DocumentEditJobManifest,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult> {
    if (manifest.reductions.length === 0) {
      const paths = manifest.units
        .filter((unit) => !unit.protected)
        .map((unit) => unit.outputPath)
        .filter((path): path is string => !!path)
      if (paths.length === 0) {
        throw new Error(
          'The document job produced no reducible section output.',
        )
      }
      if (paths.length === 1) {
        const next = await this.repository.saveManifest({
          ...manifest,
          finalResultPath: paths[0],
          phase: 'assembling',
        })
        return { status: 'queued', input: this.taskInput(task, next) }
      }
      const reductions = await this.createReductionRound(
        manifest.jobId,
        paths,
        1,
      )
      const next = await this.repository.saveManifest({
        ...manifest,
        reductions,
        reductionLevel: 1,
      })
      return { status: 'queued', input: this.taskInput(task, next) }
    }

    const current = manifest.reductions.filter(
      (checkpoint) => checkpoint.level === manifest.reductionLevel,
    )
    const pending = current.find(
      (checkpoint) => checkpoint.status === 'pending',
    )
    if (pending) {
      await context.updateProgress({
        phase: 'reducing',
        current: current.filter(
          (checkpoint) => checkpoint.status === 'succeeded',
        ).length,
        total: current.length,
        message: `Combining summary batch ${pending.index + 1} of ${current.length}`,
      })
      const running = {
        ...pending,
        status: 'running' as const,
        attempt: pending.attempt + 1,
      }
      manifest = await this.replaceReduction(manifest, running)
      const parts = await Promise.all(
        running.inputPaths.map((path) => this.repository.readText(path)),
      )
      try {
        const response = await this.generateWithRetries({
          modelId: manifest.modelId,
          system: buildReductionSystemPrompt(
            manifest.specification ??
              buildFallbackSpecification(manifest.instruction),
          ),
          user: parts
            .map((part, index) => `## PART ${index + 1}\n\n${part}`)
            .join('\n\n'),
          signal: context.signal,
          retryLimit: this.plugin.settings.documentEditing.retryLimit,
        })
        if (response.reason === 'length') {
          throw new OutputLimitedError(
            'The summary reduction reached the provider output limit.',
          )
        }
        const outputPath = await this.repository.writeReductionOutput(
          manifest.jobId,
          running.id,
          response.content.trim(),
        )
        const next = await this.replaceReduction(manifest, {
          ...running,
          status: 'succeeded',
          outputPath,
          completionReason: response.reason ?? undefined,
        })
        return { status: 'queued', input: this.taskInput(task, next) }
      } catch (error) {
        if (context.signal.aborted) {
          await this.replaceReduction(manifest, {
            ...running,
            status: 'pending',
            error: undefined,
          })
          throw error
        }
        if (isAuthenticationError(error)) {
          const reset = await this.replaceReduction(manifest, {
            ...running,
            status: 'pending',
            error: errorMessage(error),
          })
          return {
            status: 'waiting-connection',
            input: this.taskInput(task, reset),
          }
        }
        const failed = await this.replaceReduction(manifest, {
          ...running,
          status: 'failed',
          error: errorMessage(error),
          completionReason:
            error instanceof OutputLimitedError ? 'length' : 'error',
        })
        return { status: 'queued', input: this.taskInput(task, failed) }
      }
    }

    const failures = current.filter(
      (checkpoint) => checkpoint.status === 'failed',
    )
    if (failures.length > 0) {
      const blocked = await this.repository.saveManifest({
        ...manifest,
        phase: 'blocked',
        warnings: unique([
          ...manifest.warnings,
          `${failures.length} summary batch${failures.length === 1 ? '' : 'es'} require retry.`,
        ]),
      })
      return { status: 'review', input: this.taskInput(task, blocked) }
    }

    const outputPaths = current
      .map((checkpoint) => checkpoint.outputPath)
      .filter((path): path is string => !!path)
    if (outputPaths.length === 1) {
      const next = await this.repository.saveManifest({
        ...manifest,
        finalResultPath: outputPaths[0],
        phase: 'assembling',
      })
      return { status: 'queued', input: this.taskInput(task, next) }
    }
    const nextLevel = manifest.reductionLevel + 1
    const reductions = await this.createReductionRound(
      manifest.jobId,
      outputPaths,
      nextLevel,
    )
    const next = await this.repository.saveManifest({
      ...manifest,
      reductions: [...manifest.reductions, ...reductions],
      reductionLevel: nextLevel,
    })
    return { status: 'queued', input: this.taskInput(task, next) }
  }

  private async assemble(
    task: BackgroundTaskRecord,
    manifest: DocumentEditJobManifest,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult> {
    await context.updateProgress({
      phase: 'assembling',
      current: manifest.units.length,
      total: manifest.units.length,
      message: 'Validating and writing the recoverable draft',
    })
    const source = await this.repository.readSource(manifest)
    let assembled = ''
    if (manifest.strategy === 'map-reduce') {
      if (!manifest.finalResultPath) {
        throw new Error('The summary job has no final reduction result.')
      }
      assembled = await this.repository.readText(manifest.finalResultPath)
    } else {
      const parts: string[] = []
      for (const unit of [...manifest.units].sort(
        (left, right) => left.index - right.index,
      )) {
        if (unit.protected || unit.reviewChoice === 'source') {
          parts.push(source.slice(unit.from, unit.to))
        } else if (unit.outputPath) {
          parts.push(await this.repository.readText(unit.outputPath))
        }
      }
      assembled = parts.join('')
      const validation = validateDocumentAssembly(manifest, assembled)
      if (!validation.valid) {
        const blocked = await this.repository.saveManifest({
          ...manifest,
          phase: 'blocked',
          warnings: unique([
            ...manifest.warnings,
            ...validation.warnings,
            ...validation.errors,
          ]),
        })
        return { status: 'review', input: this.taskInput(task, blocked) }
      }
      manifest.warnings = unique([...manifest.warnings, ...validation.warnings])
    }

    const finalResultPath = await this.repository.writeFinalResult(
      manifest.jobId,
      assembled,
    )
    const draftPath =
      manifest.strategy === 'transform'
        ? await this.repository.writeVisibleDraft({
            sourcePath: manifest.sourcePath,
            destinationFolder:
              this.plugin.settings.documentEditing.destinationFolder,
            content: assembled,
          })
        : undefined
    const artifact: ArtifactRecord = {
      schemaVersion: 1,
      id: uuidv4(),
      taskId: task.id,
      kind: 'markdown-draft',
      createdAt: Date.now(),
      localPath: draftPath ?? finalResultPath,
      mimeType: 'text/markdown',
      byteSize: new TextEncoder().encode(assembled).byteLength,
      checksum: await sha256Text(assembled),
      metadata: {
        jobId: manifest.jobId,
        strategy: manifest.strategy,
      },
    }
    await this.taskManager.saveArtifact(artifact)
    const review = await this.repository.saveManifest({
      ...manifest,
      finalResultPath,
      draftPath,
      phase: 'review',
    })
    return {
      status: 'review',
      artifactIds: [artifact.id],
      input: this.taskInput(task, review),
    }
  }

  private async generateWithRetries(input: {
    modelId: string
    system: string
    user: string
    signal: AbortSignal
    retryLimit: number
  }): Promise<{ content: string; reason: string | null }> {
    let lastError: unknown
    for (let attempt = 0; attempt <= input.retryLimit; attempt += 1) {
      try {
        return await this.generate(
          input.modelId,
          input.system,
          input.user,
          input.signal,
        )
      } catch (error) {
        if (input.signal.aborted || isAuthenticationError(error)) throw error
        lastError = error
        if (attempt < input.retryLimit) {
          await wait(Math.min(4_000, 500 * 2 ** attempt), input.signal)
        }
      }
    }
    throw lastError
  }

  private async generate(
    modelId: string,
    system: string,
    user: string,
    signal: AbortSignal,
  ): Promise<{ content: string; reason: string | null }> {
    const { getChatModelClient } = await import('../llm/manager')
    const { providerClient, model } = getChatModelClient({
      modelId,
      settings: this.plugin.settings,
      setSettings: (settings) => this.plugin.setSettings(settings),
    })
    const response = await providerClient.generateResponse(
      model,
      {
        model: model.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      { signal },
    )
    const choice = response.choices[0]
    return {
      content: choice?.message.content?.trim() ?? '',
      reason: choice?.finish_reason ?? null,
    }
  }

  private async splitUnit(
    manifest: DocumentEditJobManifest,
    unit: DocumentEditUnit,
    sourceChunk: string,
  ): Promise<DocumentEditJobManifest> {
    const target = Math.max(
      MIN_SPLIT_CHARACTERS,
      Math.floor(sourceChunk.length / 2),
    )
    const local = splitMarkdownForDocumentEdit(sourceChunk, {
      preserveFrontmatter: false,
      targetCharacters: target,
      maxAtomicCharacters: target,
    })
    if (local.length < 2) {
      return this.replaceUnit(manifest, {
        ...unit,
        status: 'failed',
        error:
          'The output limit was reached and this atomic block cannot be split safely.',
        completionReason: 'length',
      })
    }
    const replacements = local.map((part, index) => ({
      ...part,
      id: `${unit.id}.${index + 1}`,
      from: unit.from + part.from,
      to: unit.from + part.to,
      headingPath:
        part.headingPath.length > 0 ? part.headingPath : unit.headingPath,
      protected: false,
      status: 'pending' as const,
      attempt: 0,
      reviewChoice: 'edited' as const,
    }))
    const units = manifest.units
      .flatMap((candidate) =>
        candidate.id === unit.id ? replacements : [candidate],
      )
      .map((candidate, index) => ({ ...candidate, index }))
    return this.repository.saveManifest({ ...manifest, units })
  }

  private async createReductionRound(
    jobId: string,
    paths: string[],
    level: number,
  ): Promise<DocumentReductionCheckpoint[]> {
    const groups: string[][] = []
    let current: string[] = []
    let currentCharacters = 0
    for (const path of paths) {
      const length = (await this.repository.readText(path)).length
      if (
        current.length > 0 &&
        currentCharacters + length > REDUCTION_BATCH_CHARACTERS
      ) {
        groups.push(current)
        current = []
        currentCharacters = 0
      }
      current.push(path)
      currentCharacters += length
    }
    if (current.length > 0) groups.push(current)
    if (groups.length === paths.length && paths.length > 1) {
      groups.length = 0
      for (let index = 0; index < paths.length; index += 2) {
        groups.push(paths.slice(index, index + 2))
      }
    }
    return groups.map((inputPaths, index) => ({
      id: `${jobId}-reduce-${level}-${index + 1}`,
      level,
      index,
      inputPaths,
      status: 'pending',
      attempt: 0,
    }))
  }

  private replaceUnit(
    manifest: DocumentEditJobManifest,
    replacement: DocumentEditUnit,
  ): Promise<DocumentEditJobManifest> {
    return this.repository.saveManifest({
      ...manifest,
      units: manifest.units.map((unit) =>
        unit.id === replacement.id ? replacement : unit,
      ),
    })
  }

  private replaceReduction(
    manifest: DocumentEditJobManifest,
    replacement: DocumentReductionCheckpoint,
  ): Promise<DocumentEditJobManifest> {
    return this.repository.saveManifest({
      ...manifest,
      reductions: manifest.reductions.map((checkpoint) =>
        checkpoint.id === replacement.id ? replacement : checkpoint,
      ),
    })
  }

  private taskInput(
    task: BackgroundTaskRecord,
    manifest: DocumentEditJobManifest,
  ): Record<string, unknown> {
    return {
      ...task.input,
      jobId: manifest.jobId,
      sourcePath: manifest.sourcePath,
      strategy: manifest.strategy,
      placement: manifest.placement,
      phase: manifest.phase,
      totalSections: manifest.units.length,
      completedSections: manifest.units.filter(
        (unit) => unit.status === 'succeeded',
      ).length,
      failedSections: manifest.units.filter((unit) => unit.status === 'failed')
        .length,
      draftPath: manifest.draftPath,
      finalResultPath: manifest.finalResultPath,
      warnings: manifest.warnings,
    }
  }
}

function readString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) throw new Error(message)
  return value
}

function isRefusalReason(reason: string | null): boolean {
  return !!reason && /content|filter|refusal|safety/i.test(reason)
}

function isAuthenticationError(error: unknown): boolean {
  return /(?:401|403|auth|login|oauth|token.*expired)/i.test(
    errorMessage(error),
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

async function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

export function preserveTransformBoundaries(
  source: string,
  generated: string,
  strategy: 'map-reduce' | 'transform',
): string {
  const content = generated.trim()
  if (strategy === 'map-reduce') return content
  const leading = source.match(/^\s*/)?.[0] ?? ''
  const trailing = source.match(/\s*$/)?.[0] ?? ''
  if (leading.length === source.length) return source
  return `${leading}${content}${trailing}`
}

async function sha256Text(value: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    )
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return `unavailable-${value.length}`
  }
}
