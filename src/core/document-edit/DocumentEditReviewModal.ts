import { Modal, Notice, TFile } from 'obsidian'

import type SmartComposerPlugin from '../../main'
import type { BackgroundTaskRecord } from '../../types/background-task'

import { DocumentJobRepository } from './DocumentJobRepository'
import type { DocumentEditJobManifest, DocumentEditUnit } from './types'

export class DocumentEditReviewModal extends Modal {
  private readonly repository: DocumentJobRepository
  private selectedIndex = 0

  constructor(
    private readonly plugin: SmartComposerPlugin,
    private readonly jobId: string,
    private readonly onUpdated?: (manifest: DocumentEditJobManifest) => void,
  ) {
    super(plugin.app)
    this.repository = new DocumentJobRepository(plugin.app)
  }

  onOpen(): void {
    this.titleEl.setText('Review document edit')
    void this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private async render(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.addClass('smtcmp-document-review-modal')
    try {
      const manifest = await this.repository.readManifest(this.jobId)
      const source = await this.repository.readSource(manifest)
      const reviewable = manifest.units.filter((unit) => !unit.protected)
      this.selectedIndex = Math.max(
        0,
        Math.min(this.selectedIndex, Math.max(0, reviewable.length - 1)),
      )

      const summary = this.contentEl.createDiv({
        cls: 'smtcmp-document-review-summary',
      })
      summary.createEl('strong', {
        text: `${manifest.strategy === 'transform' ? 'Document rewrite' : 'Document synthesis'} · ${formatPhase(manifest.phase)}`,
      })
      summary.createEl('span', {
        text: `${manifest.units.filter((unit) => unit.status === 'succeeded').length}/${manifest.units.length} sections checkpointed`,
      })
      const sourceFile = this.app.vault.getFileByPath(manifest.sourcePath)
      if (!sourceFile || sourceFile.stat.mtime !== manifest.sourceMtime) {
        summary.createEl('span', {
          cls: 'smtcmp-document-review-warning',
          text: 'The source note changed after this job started. The draft still uses the immutable snapshot.',
        })
      }
      for (const warning of manifest.warnings) {
        summary.createEl('span', {
          cls: 'smtcmp-document-review-warning',
          text: warning,
        })
      }

      if (reviewable.length > 0) {
        const unit = reviewable[this.selectedIndex]
        this.renderSectionPicker(reviewable)
        await this.renderSection(manifest, source, unit)
      } else {
        this.contentEl.createEl('p', {
          text: 'No editable sections are available in this job.',
        })
      }

      const footer = this.contentEl.createDiv({
        cls: 'modal-button-container smtcmp-document-review-footer',
      })
      if (manifest.draftPath || manifest.finalResultPath) {
        footer
          .createEl('button', { text: 'Open result draft' })
          .addEventListener('click', () => {
            void this.openResult(manifest)
          })
      }
      footer
        .createEl('button', { text: 'Close', cls: 'mod-cta' })
        .addEventListener('click', () => this.close())
    } catch (error) {
      this.contentEl.createEl('p', {
        cls: 'smtcmp-document-review-warning',
        text: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private renderSectionPicker(units: DocumentEditUnit[]): void {
    const navigation = this.contentEl.createDiv({
      cls: 'smtcmp-document-review-navigation',
    })
    const previous = navigation.createEl('button', { text: 'Previous' })
    previous.disabled = this.selectedIndex === 0
    previous.addEventListener('click', () => {
      this.selectedIndex -= 1
      void this.render()
    })
    const select = navigation.createEl('select')
    units.forEach((unit, index) => {
      const label = unit.headingPath.at(-1) ?? `Section ${unit.index + 1}`
      const option = select.createEl('option', {
        text: `${index + 1}/${units.length} · ${label}`,
        value: index.toString(),
      })
      option.selected = index === this.selectedIndex
    })
    select.addEventListener('change', () => {
      this.selectedIndex = Number.parseInt(select.value, 10)
      void this.render()
    })
    const next = navigation.createEl('button', { text: 'Next' })
    next.disabled = this.selectedIndex >= units.length - 1
    next.addEventListener('click', () => {
      this.selectedIndex += 1
      void this.render()
    })
  }

  private async renderSection(
    manifest: DocumentEditJobManifest,
    source: string,
    unit: DocumentEditUnit,
  ): Promise<void> {
    const comparison = this.contentEl.createDiv({
      cls: 'smtcmp-document-review-comparison',
    })
    const before = comparison.createDiv({
      cls: 'smtcmp-document-review-pane',
    })
    before.createEl('strong', { text: 'Source snapshot' })
    before.createEl('pre', { text: source.slice(unit.from, unit.to) })
    const after = comparison.createDiv({
      cls: 'smtcmp-document-review-pane',
    })
    after.createEl('strong', {
      text:
        unit.status === 'failed'
          ? 'Section failed'
          : unit.reviewChoice === 'source'
            ? 'Source selected'
            : 'Edited result',
    })
    after.createEl('pre', {
      text: unit.outputPath
        ? await this.repository.readText(unit.outputPath)
        : (unit.error ?? 'No generated section is available.'),
    })

    if (manifest.strategy !== 'transform') return
    const actions = this.contentEl.createDiv({
      cls: 'modal-button-container smtcmp-document-review-choice',
    })
    const useEdited = actions.createEl('button', {
      text: 'Use edited section',
      cls: unit.reviewChoice === 'edited' ? 'mod-cta' : undefined,
    })
    useEdited.disabled = !unit.outputPath
    useEdited.addEventListener('click', () => {
      void this.selectChoice(unit.id, 'edited')
    })
    const keepSource = actions.createEl('button', {
      text: 'Keep source section',
      cls: unit.reviewChoice === 'source' ? 'mod-cta' : undefined,
    })
    keepSource.addEventListener('click', () => {
      void this.selectChoice(unit.id, 'source')
    })
  }

  private async selectChoice(
    unitId: string,
    choice: 'edited' | 'source',
  ): Promise<void> {
    try {
      await this.repository.setUnitReviewChoice(this.jobId, unitId, choice)
      const manifest = await this.repository.rebuildTransformDraft(
        this.jobId,
        this.plugin.settings.documentEditing.destinationFolder,
      )
      this.onUpdated?.(manifest)
      await this.render()
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    }
  }

  private async openResult(manifest: DocumentEditJobManifest): Promise<void> {
    try {
      const ready = await this.repository.ensureVisibleResult(
        manifest.jobId,
        this.plugin.settings.documentEditing.destinationFolder,
      )
      this.onUpdated?.(ready)
      const file = ready.draftPath
        ? this.app.vault.getFileByPath(ready.draftPath)
        : null
      if (!(file instanceof TFile)) {
        throw new Error('The result draft could not be opened.')
      }
      await this.app.workspace.getLeaf('tab').openFile(file)
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    }
  }
}

export class DocumentEditJobsModal extends Modal {
  private readonly repository: DocumentJobRepository

  constructor(private readonly plugin: SmartComposerPlugin) {
    super(plugin.app)
    this.repository = new DocumentJobRepository(plugin.app)
  }

  onOpen(): void {
    this.titleEl.setText('Document edit jobs')
    void this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private async render(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.addClass('smtcmp-document-jobs-modal')
    const manifests = await this.repository.listJobs()
    if (manifests.length === 0) {
      this.contentEl.createEl('p', {
        text: 'No document edit jobs have been created.',
      })
      return
    }
    for (const manifest of manifests) {
      this.renderJob(manifest)
    }
  }

  private renderJob(manifest: DocumentEditJobManifest): void {
    const task = manifest.taskId
      ? this.plugin.backgroundTaskManager?.getTask(manifest.taskId)
      : null
    const card = this.contentEl.createDiv({ cls: 'smtcmp-document-job-card' })
    const heading = card.createDiv({ cls: 'smtcmp-document-job-card__heading' })
    heading.createEl('strong', {
      text: manifest.sourcePath.split('/').at(-1) ?? manifest.sourcePath,
    })
    heading.createEl('span', {
      text: `${formatPhase(manifest.phase)} · ${manifest.strategy}`,
    })
    card.createEl('span', {
      text: `${manifest.units.filter((unit) => unit.status === 'succeeded').length}/${manifest.units.length} sections · ${new Date(manifest.updatedAt).toLocaleString()}`,
    })
    const actions = card.createDiv({
      cls: 'modal-button-container smtcmp-document-job-card__actions',
    })
    if (manifest.phase === 'review' || manifest.phase === 'blocked') {
      actions
        .createEl('button', { text: 'Review' })
        .addEventListener('click', () => {
          new DocumentEditReviewModal(this.plugin, manifest.jobId, () => {
            void this.render()
          }).open()
        })
    }
    if (manifest.finalResultPath) {
      actions
        .createEl('button', { text: 'Open result' })
        .addEventListener('click', () => void this.openResult(manifest))
    }
    if (
      task &&
      ['paused', 'interrupted', 'waiting-connection'].includes(task.status)
    ) {
      actions
        .createEl('button', { text: 'Resume', cls: 'mod-cta' })
        .addEventListener('click', () => {
          void this.plugin.backgroundTaskManager
            ?.resume(task.id)
            .then(() => this.render())
        })
    }
    if (task && manifest.phase === 'blocked') {
      actions
        .createEl('button', { text: 'Retry failed' })
        .addEventListener('click', () => {
          void this.retryFailed(task, manifest)
        })
      if (manifest.strategy === 'transform') {
        actions
          .createEl('button', { text: 'Keep source for failed' })
          .addEventListener('click', () => {
            void this.keepSourceForFailed(task, manifest)
          })
      }
    }
    if (
      task &&
      ['queued', 'running', 'waiting-connection', 'paused'].includes(
        task.status,
      )
    ) {
      actions
        .createEl('button', { text: 'Cancel' })
        .addEventListener('click', () => {
          void this.plugin.backgroundTaskManager
            ?.cancel(task.id)
            .then(() => this.render())
        })
    }
  }

  private async openResult(manifest: DocumentEditJobManifest): Promise<void> {
    try {
      const ready = await this.repository.ensureVisibleResult(
        manifest.jobId,
        this.plugin.settings.documentEditing.destinationFolder,
      )
      const file = ready.draftPath
        ? this.app.vault.getFileByPath(ready.draftPath)
        : null
      if (!(file instanceof TFile)) throw new Error('Result draft not found.')
      await this.app.workspace.getLeaf('tab').openFile(file)
      await this.render()
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    }
  }

  private async retryFailed(
    task: BackgroundTaskRecord,
    manifest: DocumentEditJobManifest,
  ): Promise<void> {
    const reset = await this.repository.resetFailed(manifest.jobId)
    await this.plugin.backgroundTaskManager?.updateInput(
      task.id,
      { ...task.input, phase: reset.phase },
      'queued',
    )
    await this.render()
  }

  private async keepSourceForFailed(
    task: BackgroundTaskRecord,
    manifest: DocumentEditJobManifest,
  ): Promise<void> {
    const next = await this.repository.useSourceForFailed(manifest.jobId)
    await this.plugin.backgroundTaskManager?.updateInput(
      task.id,
      { ...task.input, phase: next.phase },
      'queued',
    )
    await this.render()
  }
}

function formatPhase(value: string): string {
  return value
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
