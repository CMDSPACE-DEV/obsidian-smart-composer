import { App, normalizePath } from 'obsidian'

import { stableTextHash } from './markdownSplitter'
import type {
  CreateDocumentEditJobInput,
  DocumentEditJobManifest,
} from './types'

const ROOT_DIR = '.smtcmp_json_db/document-jobs'

export class DocumentJobRepository {
  constructor(private readonly app: App) {}

  async createJob(
    input: CreateDocumentEditJobInput,
    units: DocumentEditJobManifest['units'],
  ): Promise<DocumentEditJobManifest> {
    const now = Date.now()
    const directory = this.getJobDirectory(input.jobId)
    await this.ensureDirectory(directory)
    await this.ensureDirectory(`${directory}/outputs`)
    await this.ensureDirectory(`${directory}/reductions`)
    const sourceSnapshotPath = normalizePath(`${directory}/source.md`)
    const referenceSnapshotPath = input.referenceText
      ? normalizePath(`${directory}/references.md`)
      : undefined
    await this.atomicWrite(sourceSnapshotPath, input.source)
    if (referenceSnapshotPath) {
      await this.atomicWrite(referenceSnapshotPath, input.referenceText)
    }
    const manifest: DocumentEditJobManifest = {
      schemaVersion: 1,
      jobId: input.jobId,
      sourcePath: input.sourcePath,
      sourceMtime: input.sourceMtime,
      sourceChecksum: input.sourceDocumentChecksum,
      sourceSelectionChecksum: stableTextHash(input.source),
      sourceFrom: input.sourceFrom,
      sourceTo: input.sourceTo,
      placement: input.placement,
      instruction: input.instruction,
      modelId: input.modelId,
      strategy: input.strategy,
      phase: 'planning',
      referenceSnapshots: input.referenceSnapshots,
      sourceSnapshotPath,
      referenceSnapshotPath,
      units,
      reductions: [],
      reductionLevel: 0,
      warnings: [],
      createdAt: now,
      updatedAt: now,
    }
    await this.saveManifest(manifest)
    return manifest
  }

  async listJobs(): Promise<DocumentEditJobManifest[]> {
    await this.ensureDirectory(ROOT_DIR)
    const { folders } = await this.app.vault.adapter.list(ROOT_DIR)
    const jobs = await Promise.all(
      folders.map(async (folder) => {
        try {
          return await this.readManifest(folder.split('/').pop() ?? '')
        } catch {
          return null
        }
      }),
    )
    return jobs
      .filter((job): job is DocumentEditJobManifest => !!job)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async readManifest(jobId: string): Promise<DocumentEditJobManifest> {
    const path = this.getManifestPath(jobId)
    return JSON.parse(
      await this.app.vault.adapter.read(path),
    ) as DocumentEditJobManifest
  }

  async saveManifest(
    manifest: DocumentEditJobManifest,
  ): Promise<DocumentEditJobManifest> {
    const next = { ...manifest, updatedAt: Date.now() }
    await this.atomicWrite(
      this.getManifestPath(manifest.jobId),
      JSON.stringify(next, null, 2),
    )
    return next
  }

  async readSource(manifest: DocumentEditJobManifest): Promise<string> {
    return this.app.vault.adapter.read(manifest.sourceSnapshotPath)
  }

  async readReferences(manifest: DocumentEditJobManifest): Promise<string> {
    return manifest.referenceSnapshotPath
      ? this.app.vault.adapter.read(manifest.referenceSnapshotPath)
      : ''
  }

  async writeUnitOutput(
    jobId: string,
    unitId: string,
    content: string,
  ): Promise<string> {
    const path = normalizePath(
      `${this.getJobDirectory(jobId)}/outputs/${unitId}.md`,
    )
    await this.atomicWrite(path, content)
    return path
  }

  async writeReductionOutput(
    jobId: string,
    checkpointId: string,
    content: string,
  ): Promise<string> {
    const path = normalizePath(
      `${this.getJobDirectory(jobId)}/reductions/${checkpointId}.md`,
    )
    await this.atomicWrite(path, content)
    return path
  }

  async readText(path: string): Promise<string> {
    return this.app.vault.adapter.read(normalizePath(path))
  }

  async writeFinalResult(jobId: string, content: string): Promise<string> {
    const path = normalizePath(`${this.getJobDirectory(jobId)}/result.md`)
    await this.atomicWrite(path, content)
    return path
  }

  async writeVisibleDraft(input: {
    sourcePath: string
    destinationFolder: string
    content: string
    existingPath?: string
  }): Promise<string> {
    if (input.existingPath) {
      await this.atomicWrite(input.existingPath, input.content)
      return normalizePath(input.existingPath)
    }
    const folder = normalizePath(
      input.destinationFolder.trim() || 'Smart Composer/Document Drafts',
    )
    await this.ensureDirectory(folder)
    const sourceName =
      input.sourcePath.split('/').pop()?.replace(/\.md$/i, '') ?? 'Document'
    const base = normalizePath(`${folder}/${sourceName} - Smart Composer draft`)
    let path = `${base}.md`
    let suffix = 2
    while (await this.app.vault.adapter.exists(path)) {
      path = `${base} ${suffix}.md`
      suffix += 1
    }
    await this.atomicWrite(path, input.content)
    return path
  }

  async setUnitReviewChoice(
    jobId: string,
    unitId: string,
    choice: 'edited' | 'source',
  ): Promise<DocumentEditJobManifest> {
    const manifest = await this.readManifest(jobId)
    return this.saveManifest({
      ...manifest,
      units: manifest.units.map((unit) =>
        unit.id === unitId ? { ...unit, reviewChoice: choice } : unit,
      ),
    })
  }

  async useSourceForFailed(jobId: string): Promise<DocumentEditJobManifest> {
    const manifest = await this.readManifest(jobId)
    return this.saveManifest({
      ...manifest,
      phase: 'assembling',
      units: manifest.units.map((unit) =>
        unit.status === 'failed'
          ? {
              ...unit,
              status: 'succeeded' as const,
              reviewChoice: 'source' as const,
              error: undefined,
            }
          : unit,
      ),
    })
  }

  async rebuildTransformDraft(
    jobId: string,
    destinationFolder: string,
  ): Promise<DocumentEditJobManifest> {
    const manifest = await this.readManifest(jobId)
    if (manifest.strategy !== 'transform') {
      throw new Error('Only transform jobs have section-level draft choices.')
    }
    const source = await this.readSource(manifest)
    const parts: string[] = []
    for (const unit of [...manifest.units].sort(
      (left, right) => left.index - right.index,
    )) {
      if (
        unit.protected ||
        unit.reviewChoice === 'source' ||
        !unit.outputPath
      ) {
        parts.push(source.slice(unit.from, unit.to))
      } else {
        parts.push(await this.readText(unit.outputPath))
      }
    }
    const content = parts.join('')
    const finalResultPath = await this.writeFinalResult(jobId, content)
    const draftPath = await this.writeVisibleDraft({
      sourcePath: manifest.sourcePath,
      destinationFolder,
      content,
      existingPath: manifest.draftPath,
    })
    return this.saveManifest({
      ...manifest,
      phase: 'review',
      finalResultPath,
      draftPath,
    })
  }

  async markComplete(jobId: string): Promise<DocumentEditJobManifest> {
    const manifest = await this.readManifest(jobId)
    return this.saveManifest({ ...manifest, phase: 'complete' })
  }

  async ensureVisibleResult(
    jobId: string,
    destinationFolder: string,
  ): Promise<DocumentEditJobManifest> {
    const manifest = await this.readManifest(jobId)
    if (manifest.draftPath) return manifest
    if (!manifest.finalResultPath) {
      throw new Error('This document job has no assembled result yet.')
    }
    const content = await this.readText(manifest.finalResultPath)
    const draftPath = await this.writeVisibleDraft({
      sourcePath: manifest.sourcePath,
      destinationFolder,
      content,
    })
    return this.saveManifest({ ...manifest, draftPath })
  }

  async resetFailed(jobId: string): Promise<DocumentEditJobManifest> {
    const manifest = await this.readManifest(jobId)
    return this.saveManifest({
      ...manifest,
      phase:
        manifest.strategy === 'map-reduce' &&
        manifest.units.every((unit) => unit.status === 'succeeded')
          ? 'reducing'
          : 'processing',
      units: manifest.units.map((unit) =>
        unit.status === 'failed'
          ? {
              ...unit,
              status: 'pending' as const,
              error: undefined,
              completionReason: undefined,
            }
          : unit,
      ),
      reductions: manifest.reductions.map((checkpoint) =>
        checkpoint.status === 'failed'
          ? {
              ...checkpoint,
              status: 'pending' as const,
              error: undefined,
              completionReason: undefined,
            }
          : checkpoint,
      ),
    })
  }

  async deleteJob(jobId: string): Promise<void> {
    const path = this.getJobDirectory(jobId)
    if (await this.app.vault.adapter.exists(path)) {
      await this.app.vault.adapter.rmdir(path, true)
    }
  }

  private getJobDirectory(jobId: string): string {
    return normalizePath(`${ROOT_DIR}/${jobId}`)
  }

  private getManifestPath(jobId: string): string {
    return normalizePath(`${this.getJobDirectory(jobId)}/manifest.json`)
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path)
    const temporary = `${normalized}.tmp`
    const backup = `${normalized}.bak`
    await this.app.vault.adapter.write(temporary, content)
    const hadExisting = await this.app.vault.adapter.exists(normalized)
    if (await this.app.vault.adapter.exists(backup)) {
      await this.app.vault.adapter.remove(backup)
    }
    if (hadExisting) {
      await this.app.vault.adapter.rename(normalized, backup)
    }
    try {
      await this.app.vault.adapter.rename(temporary, normalized)
      if (hadExisting && (await this.app.vault.adapter.exists(backup))) {
        await this.app.vault.adapter.remove(backup)
      }
    } catch (error) {
      if (await this.app.vault.adapter.exists(temporary)) {
        await this.app.vault.adapter.remove(temporary)
      }
      if (
        hadExisting &&
        (await this.app.vault.adapter.exists(backup)) &&
        !(await this.app.vault.adapter.exists(normalized))
      ) {
        await this.app.vault.adapter.rename(backup, normalized)
      }
      throw error
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    const normalized = normalizePath(path)
    const segments = normalized.split('/')
    let current = ''
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current)
      }
    }
  }
}
