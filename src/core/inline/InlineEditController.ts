import { StateEffect, StateField } from '@codemirror/state'
import type { ChangeDesc } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import {
  App,
  Editor,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  TFile,
} from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import type { QueryProgressState } from '../../components/chat-view/QueryProgress'
import type SmartComposerPlugin from '../../main'
import type { BackgroundTaskRecord } from '../../types/background-task'
import { RetrievalMetadata } from '../../types/chat'
import type {
  ResearchEvidence,
  ResearchSourceId,
} from '../../types/research.types'
import { getNestedFiles } from '../../utils/obsidian'
import { analyzeDocumentEdit } from '../document-edit/analysis'
import { createDocumentEditJob } from '../document-edit/createDocumentEditJob'
import { DocumentJobRepository } from '../document-edit/DocumentJobRepository'
import type {
  DocumentEditAnalysis,
  DocumentEditJobManifest,
  DocumentEditStrategy,
} from '../document-edit/types'
import {
  CompiledVaultReferences,
  VaultReferenceScope,
  compileVaultReferences,
  isExhaustiveReadIntent,
} from '../references/VaultReferenceCompiler'
import {
  RESEARCH_PACKS,
  getResearchSource,
} from '../research/ResearchSourceRegistry'

import {
  InlineVaultReference,
  mountInlineReferencePicker,
} from './InlineReferencePicker'

type InlineStatus =
  | 'prompt'
  | 'loading'
  | 'clarification'
  | 'preview'
  | 'large-confirm'
  | 'document-task'
  | 'document-review'
  | 'error'
type InlineReferencePhase =
  | 'reading'
  | 'selecting'
  | 'exhaustive'
  | 'generating'

export type InlineEditMode = 'auto' | 'replace' | 'insert-after'
export type InlineEditPlacement = 'replace' | 'insert-after'

type InlineDraft = {
  prompt: string
  mode: InlineEditMode
  references: InlineVaultReference[]
  referenceScope: VaultReferenceScope
}

type InlineSession = {
  app: App
  id: string
  from: number
  to: number
  insertAt: number
  ignoredInsertions: InlineEditRange[]
  original: string
  snapshot: string
  filePath: string
  targetLabel: 'Selection' | 'Current line'
  status: InlineStatus
  mode: InlineEditMode
  placement?: InlineEditPlacement
  prompt?: string
  clarification?: string
  replacement?: string
  error?: string
  references: InlineVaultReference[]
  researchOptions: InlineVaultReference[]
  referenceScope: VaultReferenceScope
  referencePhase?: InlineReferencePhase
  retrievalMetadata?: RetrievalMetadata
  referenceWarnings: string[]
  referenceSources: CompiledVaultReferences['sourceFiles']
  documentAnalysis?: DocumentEditAnalysis
  documentStrategy?: DocumentEditStrategy
  documentTask?: BackgroundTaskRecord
  documentJobId?: string
  documentDraftPath?: string
  documentResultPath?: string
  getDraft: () => InlineDraft
  updateDraft: (draft: InlineDraft) => void
  submit: (
    prompt: string,
    mode: InlineEditMode,
    references: InlineVaultReference[],
    referenceScope: VaultReferenceScope,
  ) => void
  accept: () => void
  close: () => void
  startDocumentJob?: () => void
  runSingleResponse?: () => void
  setDocumentStrategy?: (strategy: DocumentEditStrategy) => void
  pauseDocumentJob?: () => void
  resumeDocumentJob?: () => void
  cancelDocumentJob?: () => void
  retryDocumentJob?: () => void
  useSourceForFailed?: () => void
  openDocumentReview?: () => void
  openDocumentDraft?: () => void
  applyDocumentResult?: () => void
  keepDocumentDraft?: () => void
  renderMarkdown: (content: string, target: HTMLElement) => Promise<void>
}

type InlineRequestInput = {
  app: App
  id: string
  from: number
  to: number
  original: string
  snapshot: string
  filePath: string
  targetLabel: 'Selection' | 'Current line'
  prompt: string
  mode: InlineEditMode
  references: InlineVaultReference[]
  researchOptions: InlineVaultReference[]
  referenceScope: VaultReferenceScope
  referenceWarnings: string[]
  referenceSources: CompiledVaultReferences['sourceFiles']
  getDraft: () => InlineDraft
  updateDraft: (draft: InlineDraft) => void
  editorView: EditorView
  submit: InlineSession['submit']
  accept: () => void
  close: () => void
  renderMarkdown: (content: string, target: HTMLElement) => Promise<void>
  compiledReferences?: CompiledVaultReferences
}

type InlineSessionMap = ReadonlyMap<string, InlineSession>

const upsertInlineSession = StateEffect.define<InlineSession>()
const removeInlineSession = StateEffect.define<string>()
const recordInlineInsertion = StateEffect.define<AcceptedInlineInsertion>()

class InlineEditWidget extends WidgetType {
  private themeObserver: MutationObserver | null = null

  constructor(private readonly session: InlineSession) {
    super()
  }

  eq(other: InlineEditWidget): boolean {
    return (
      other.session.id === this.session.id &&
      other.session.status === this.session.status &&
      other.session.mode === this.session.mode &&
      other.session.placement === this.session.placement &&
      other.session.replacement === this.session.replacement &&
      other.session.error === this.session.error &&
      other.session.referencePhase === this.session.referencePhase &&
      other.session.referenceWarnings.join('\n') ===
        this.session.referenceWarnings.join('\n') &&
      other.session.documentStrategy === this.session.documentStrategy &&
      other.session.documentAnalysis?.estimatedSourceTokens ===
        this.session.documentAnalysis?.estimatedSourceTokens &&
      getDocumentTaskSummary(other.session.documentTask) ===
        getDocumentTaskSummary(this.session.documentTask) &&
      other.session.documentDraftPath === this.session.documentDraftPath &&
      other.session.documentResultPath === this.session.documentResultPath &&
      getRetrievalSummary(other.session) === getRetrievalSummary(this.session)
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument
    const host = doc.createElement('div')
    host.className = 'smtcmp-inline-host'
    const applySkin = () => {
      host.dataset.skin = resolveInlineSkin(doc.body.classList)
    }
    applySkin()
    const MutationObserverConstructor = doc.defaultView?.MutationObserver
    if (MutationObserverConstructor) {
      this.themeObserver = new MutationObserverConstructor(applySkin)
      this.themeObserver.observe(doc.body, {
        attributes: true,
        attributeFilter: ['class'],
      })
    }
    const shadow = host.attachShadow({ mode: 'open' })
    const style = doc.createElement('style')
    style.textContent = INLINE_STYLE
    shadow.appendChild(style)

    const panel = doc.createElement('section')
    panel.className = 'panel'
    panel.dataset.status = this.session.status
    if (this.session.documentTask) {
      panel.dataset.taskStatus = this.session.documentTask.status
    }
    panel.setAttribute('aria-live', 'polite')
    panel.setAttribute('aria-label', 'Smart Composer inline edit')
    shadow.appendChild(panel)

    panel.appendChild(makeHeader(doc, this.session))
    if (
      this.session.status !== 'prompt' &&
      this.session.status !== 'clarification' &&
      this.session.references.length > 0
    ) {
      panel.append(makeReferenceStatus(doc, this.session))
    }

    if (
      this.session.status === 'prompt' ||
      this.session.status === 'clarification'
    ) {
      const draft = this.session.getDraft()
      if (this.session.status === 'clarification') {
        const question = doc.createElement('p')
        question.className = 'question'
        question.textContent =
          this.session.clarification ?? 'Please clarify the requested edit.'
        panel.appendChild(question)
      }
      const input = doc.createElement('textarea')
      input.className = 'prompt'
      input.setAttribute('aria-label', 'Inline edit instruction')
      input.placeholder =
        this.session.status === 'clarification'
          ? 'Clarify the change...'
          : 'Describe the edit...'
      input.value = this.session.status === 'clarification' ? '' : draft.prompt
      input.rows = 2
      let selectedMode = draft.mode
      let selectedReferences =
        this.session.status === 'clarification'
          ? [...this.session.references]
          : [...draft.references]
      let selectedReferenceScope =
        this.session.status === 'clarification'
          ? this.session.referenceScope
          : draft.referenceScope
      const promptSurface = doc.createElement('div')
      promptSurface.className = 'prompt-surface'
      const promptReferenceEcho = doc.createElement('div')
      promptReferenceEcho.className = 'prompt-reference-echo'
      promptReferenceEcho.setAttribute('aria-hidden', 'true')
      const refreshPromptReferenceEcho = () => {
        renderPromptReferenceEcho(doc, promptReferenceEcho, selectedReferences)
      }
      promptSurface.append(promptReferenceEcho, input)
      refreshPromptReferenceEcho()
      const persistDraft = () => {
        if (this.session.status !== 'prompt') return
        this.session.updateDraft({
          prompt: input.value,
          mode: selectedMode,
          references: [...selectedReferences],
          referenceScope: selectedReferenceScope,
        })
      }
      const modeControl = makeModeControl(doc, selectedMode, (nextMode) => {
        selectedMode = nextMode
        persistDraft()
      })
      modeControl.hidden = this.session.status === 'clarification'
      const scopeControl = makeReferenceScopeControl(
        doc,
        selectedReferenceScope,
        (nextScope) => {
          selectedReferenceScope = nextScope
          persistDraft()
        },
      )
      scopeControl.setVisible(
        this.session.status === 'prompt' &&
          selectedReferences.some((reference) => reference.type === 'folder'),
      )
      scopeControl.setEstimatedFiles(
        countReferencedMarkdownFiles(this.session.app, selectedReferences),
      )
      const referenceRegion = doc.createElement('div')
      referenceRegion.className = 'reference-region'
      let picker: ReturnType<typeof mountInlineReferencePicker> | null = null
      if (this.session.status === 'prompt') {
        picker = mountInlineReferencePicker({
          app: this.session.app,
          doc,
          input,
          region: referenceRegion,
          initialReferences: selectedReferences,
          researchOptions: this.session.researchOptions,
          onChange: (references) => {
            selectedReferences = references
            refreshPromptReferenceEcho()
            scopeControl.setVisible(
              references.some((reference) => reference.type === 'folder'),
            )
            scopeControl.setEstimatedFiles(
              countReferencedMarkdownFiles(this.session.app, references),
            )
            persistDraft()
          },
        })
      } else {
        referenceRegion.append(
          makeReadOnlyReferenceChips(doc, selectedReferences),
        )
        if (this.session.referenceWarnings.length > 0) {
          referenceRegion.append(makeReferenceStatus(doc, this.session))
        }
      }
      const actions = doc.createElement('div')
      actions.className = 'actions'
      const cancel = makeButton(
        doc,
        'Cancel',
        () => this.session.close(),
        'secondary',
        'Esc',
      )
      const submit = makeButton(
        doc,
        'Generate',
        () => {
          const value = input.value.trim()
          if (value) {
            this.session.submit(
              value,
              selectedMode,
              selectedReferences,
              selectedReferenceScope,
            )
          }
        },
        'primary',
        'Enter',
      )
      actions.append(cancel, submit)
      panel.append(
        referenceRegion,
        promptSurface,
        modeControl,
        scopeControl.element,
        actions,
      )
      input.addEventListener('input', persistDraft)
      input.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (picker?.handleKeyDown(event)) return
        if (event.key === 'Escape') {
          event.preventDefault()
          this.session.close()
        } else if (
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.isComposing
        ) {
          event.preventDefault()
          submit.click()
        }
      })
      for (const eventName of [
        'beforeinput',
        'input',
        'keyup',
        'compositionstart',
        'compositionupdate',
        'compositionend',
        'paste',
        'cut',
        'copy',
      ]) {
        input.addEventListener(eventName, (event) => event.stopPropagation())
      }
      queueMicrotask(() => {
        input.focus({ preventScroll: true })
        input.setSelectionRange(input.value.length, input.value.length)
      })
    } else if (this.session.status === 'large-confirm') {
      const analysis = this.session.documentAnalysis
      if (!analysis) throw new Error('Large-edit analysis is unavailable.')
      const preflight = doc.createElement('div')
      preflight.className = 'document-preflight'
      const message = doc.createElement('p')
      message.className = 'document-preflight__message'
      message.textContent =
        'This selection is safer as a resumable document job. Every section is checkpointed and the original note stays unchanged until you approve a result.'
      const metrics = doc.createElement('div')
      metrics.className = 'document-metrics'
      metrics.append(
        makeMetric(
          doc,
          'Estimated input',
          `~${analysis.estimatedSourceTokens.toLocaleString()} tokens`,
        ),
        makeMetric(
          doc,
          'Planned sections',
          analysis.estimatedChunks.toLocaleString(),
        ),
        makeMetric(
          doc,
          'Result shape',
          analysis.strategy === 'transform'
            ? 'Full rewrite draft'
            : 'Synthesis / insertion',
        ),
      )
      const strategy = doc.createElement('div')
      strategy.className = 'document-strategy'
      strategy.setAttribute('role', 'group')
      strategy.setAttribute('aria-label', 'Document edit strategy')
      const synthesis = makeButton(
        doc,
        'Synthesis',
        () => this.session.setDocumentStrategy?.('map-reduce'),
        analysis.strategy === 'map-reduce' ? 'primary' : 'secondary',
      )
      const transform = makeButton(
        doc,
        'Full rewrite',
        () => this.session.setDocumentStrategy?.('transform'),
        analysis.strategy === 'transform' ? 'primary' : 'secondary',
      )
      strategy.append(synthesis, transform)
      const reason = doc.createElement('small')
      reason.className = 'document-preflight__reason'
      reason.textContent = analysis.reason
      preflight.append(message, metrics, strategy, reason)
      const actions = doc.createElement('div')
      actions.className = 'actions'
      actions.append(
        makeButton(
          doc,
          'Cancel',
          () => this.session.close(),
          'secondary',
          'Esc',
        ),
        makeButton(
          doc,
          'Generate once',
          () => this.session.runSingleResponse?.(),
          'secondary',
        ),
        makeButton(
          doc,
          'Start document job',
          () => this.session.startDocumentJob?.(),
          'primary',
          'Enter',
        ),
      )
      panel.append(preflight, actions)
    } else if (this.session.status === 'document-task') {
      const task = this.session.documentTask
      const progress = doc.createElement('div')
      progress.className = 'document-progress'
      const status = doc.createElement('div')
      status.className = 'document-progress__status'
      const title = doc.createElement('strong')
      title.textContent = getDocumentTaskTitle(task)
      const detail = doc.createElement('small')
      detail.textContent =
        task?.progress?.message ??
        (task ? task.status.replace(/-/g, ' ') : 'Preparing task')
      status.append(title, detail)
      const meter = doc.createElement('progress')
      meter.max = Math.max(1, task?.progress?.total ?? 1)
      meter.value = Math.max(0, task?.progress?.current ?? 0)
      meter.setAttribute(
        'aria-label',
        `${meter.value} of ${meter.max} document sections`,
      )
      progress.append(status, meter)
      if (this.session.referenceWarnings.length > 0) {
        const warnings = doc.createElement('div')
        warnings.className = 'document-warnings'
        warnings.textContent = this.session.referenceWarnings.join(' · ')
        progress.append(warnings)
      }
      const actions = doc.createElement('div')
      actions.className = 'actions'
      if (task?.status === 'running' || task?.status === 'queued') {
        actions.append(
          makeButton(
            doc,
            'Pause',
            () => this.session.pauseDocumentJob?.(),
            'secondary',
          ),
        )
      } else if (
        task &&
        ['paused', 'interrupted', 'waiting-connection'].includes(task.status)
      ) {
        actions.append(
          makeButton(
            doc,
            'Resume',
            () => this.session.resumeDocumentJob?.(),
            'primary',
          ),
        )
      } else if (task && ['failed', 'canceled'].includes(task.status)) {
        actions.append(
          makeButton(
            doc,
            'Retry',
            () => this.session.retryDocumentJob?.(),
            'primary',
          ),
        )
      }
      if (task?.status === 'review' && task.input.phase === 'blocked') {
        actions.append(
          makeButton(
            doc,
            'Retry failed',
            () => this.session.retryDocumentJob?.(),
            'primary',
          ),
          makeButton(
            doc,
            'Review sections',
            () => this.session.openDocumentReview?.(),
            'secondary',
          ),
        )
        if (task.input.strategy === 'transform') {
          actions.append(
            makeButton(
              doc,
              'Keep source for failed',
              () => this.session.useSourceForFailed?.(),
              'secondary',
            ),
          )
        }
      }
      if (task && !['succeeded', 'failed', 'canceled'].includes(task.status)) {
        actions.append(
          makeButton(
            doc,
            'Cancel job',
            () => this.session.cancelDocumentJob?.(),
            'secondary',
          ),
        )
      }
      actions.append(
        makeButton(doc, 'Hide panel', () => this.session.close(), 'secondary'),
      )
      panel.append(progress, actions)
    } else if (this.session.status === 'document-review') {
      const review = doc.createElement('div')
      review.className = 'document-ready'
      const title = doc.createElement('strong')
      title.textContent = 'Document draft ready'
      const detail = doc.createElement('p')
      detail.textContent =
        'The complete result was assembled from checkpointed sections. Review the draft before replacing the source selection.'
      const path = doc.createElement('small')
      path.textContent =
        this.session.documentDraftPath ?? 'Recoverable result saved'
      review.append(title, detail, path)
      const actions = doc.createElement('div')
      actions.className = 'actions'
      actions.append(
        makeButton(
          doc,
          'Open draft',
          () => this.session.openDocumentDraft?.(),
          'secondary',
        ),
        makeButton(
          doc,
          'Review sections',
          () => this.session.openDocumentReview?.(),
          'secondary',
        ),
        makeButton(
          doc,
          'Keep draft',
          () => this.session.keepDocumentDraft?.(),
          'secondary',
        ),
        makeButton(
          doc,
          'Replace selection',
          () => this.session.applyDocumentResult?.(),
          'primary',
        ),
      )
      panel.append(review, actions)
    } else if (this.session.status === 'loading') {
      const loading = doc.createElement('div')
      loading.className = 'loading'
      const copy = doc.createElement('span')
      copy.className = 'loading-copy'
      const loadingCopy = getInlineLoadingCopy(this.session)
      copy.append(
        Object.assign(doc.createElement('strong'), {
          textContent: loadingCopy.title,
        }),
        Object.assign(doc.createElement('small'), {
          textContent: loadingCopy.detail,
        }),
      )
      loading.append(makeThinkingDots(doc), copy)
      const actions = doc.createElement('div')
      actions.className = 'actions'
      actions.append(
        makeButton(
          doc,
          'Cancel generation',
          () => this.session.close(),
          'secondary',
          'Esc',
        ),
      )
      panel.append(loading, actions)
      host.tabIndex = 0
      host.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          this.session.close()
        }
      })
    } else if (this.session.status === 'preview') {
      const diff = doc.createElement('div')
      const replacement = this.session.replacement ?? ''
      const isInsertion = this.session.placement === 'insert-after'
      if (isInsertion) {
        diff.className = 'insert-preview'
        const source = doc.createElement('div')
        source.className = 'source-preserved'
        const sourceTitle = doc.createElement('strong')
        sourceTitle.textContent = 'Selection remains unchanged'
        const sourceDetail = doc.createElement('small')
        sourceDetail.textContent = `${this.session.original.length.toLocaleString()} source characters`
        source.append(sourceTitle, sourceDetail)
        const after = makeRenderedDiffPane(doc, 'Insert below', 'after')
        diff.append(source, after.pane)
        void this.session.renderMarkdown(replacement, after.content)
      } else if (isShortProseEdit(this.session.original, replacement)) {
        diff.className = 'word-diff'
        renderWordDiff(doc, this.session.original, replacement, diff)
      } else {
        diff.className = 'diff'
        const before = makeRenderedDiffPane(doc, 'Before', 'before')
        const after = makeRenderedDiffPane(doc, 'After', 'after')
        diff.append(before.pane, after.pane)
        void this.session.renderMarkdown(this.session.original, before.content)
        void this.session.renderMarkdown(replacement, after.content)
      }
      const actions = doc.createElement('div')
      actions.className = 'actions'
      actions.append(
        makeButton(
          doc,
          'Reject',
          () => this.session.close(),
          'secondary',
          'Esc',
        ),
        makeButton(
          doc,
          isInsertion ? 'Insert' : 'Accept',
          () => this.session.accept(),
          'primary',
          'Enter',
        ),
      )
      panel.append(diff, actions)
      host.tabIndex = 0
      host.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          this.session.close()
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          this.session.accept()
        }
      })
    } else {
      const error = doc.createElement('p')
      error.className = 'error'
      error.textContent = this.session.error ?? 'Inline edit failed.'
      panel.append(
        error,
        Object.assign(doc.createElement('div'), { className: 'actions' }),
      )
      panel
        .querySelector('.actions')
        ?.append(
          makeButton(doc, 'Close', () => this.session.close(), 'primary'),
        )
    }
    return host
  }

  ignoreEvent(): boolean {
    // Interactive widgets must own their events. Returning false lets
    // CodeMirror reinterpret Backspace and IME input as document edits.
    return true
  }

  destroy(): void {
    this.themeObserver?.disconnect()
    this.themeObserver = null
  }
}

const inlineEditField = StateField.define<InlineSessionMap>({
  create: () => new Map(),
  update(value, transaction) {
    const upserts: InlineSession[] = []
    const removals: string[] = []
    const insertions: AcceptedInlineInsertion[] = []
    for (const effect of transaction.effects) {
      if (effect.is(upsertInlineSession)) {
        upserts.push(effect.value)
      } else if (effect.is(removeInlineSession)) {
        removals.push(effect.value)
      } else if (effect.is(recordInlineInsertion)) {
        insertions.push(effect.value)
      }
    }
    let next = updateInlineEditSessionMap(
      value,
      transaction.changes,
      upserts,
      removals,
    )
    for (const insertion of insertions) {
      next = recordAcceptedInlineInsertion(
        value,
        next,
        insertion,
        transaction.changes,
      )
    }
    return next
  },
  provide: (field) =>
    EditorView.decorations.from(field, (sessions) =>
      Decoration.set(
        Array.from(sessions.values())
          .sort(
            (a, b) =>
              getInlineWidgetPosition(a) - getInlineWidgetPosition(b) ||
              a.id.localeCompare(b.id),
          )
          .map((session) => {
            const position = getInlineWidgetPosition(session)
            return Decoration.widget({
              widget: new InlineEditWidget(session),
              side: 1,
              block: true,
            }).range(position)
          }),
        true,
      ),
    ),
})

export class InlineEditController {
  private readonly controllers = new Map<string, AbortController>()
  private readonly drafts = new Map<string, InlineDraft>()
  private readonly documentRepository: DocumentJobRepository
  private readonly documentBindings = new Map<
    string,
    { editorView: EditorView; sessionId: string }
  >()
  private readonly resolvingDocumentTasks = new Set<string>()
  private readonly unsubscribeTasks: () => void

  constructor(private readonly plugin: SmartComposerPlugin) {
    this.documentRepository = new DocumentJobRepository(plugin.app)
    this.unsubscribeTasks =
      plugin.backgroundTaskManager?.subscribe((tasks) => {
        for (const task of tasks) {
          if (task.kind === 'document-edit') {
            void this.handleDocumentTaskUpdate(task)
          }
        }
      }) ?? (() => {})
  }

  cleanup(): void {
    this.unsubscribeTasks()
    for (const controller of this.controllers.values()) {
      controller.abort()
    }
    this.controllers.clear()
    this.drafts.clear()
    this.documentBindings.clear()
    this.resolvingDocumentTasks.clear()
  }

  open(editor: Editor, markdownView: MarkdownView): void {
    const editorView = (editor as unknown as { cm?: EditorView }).cm
    if (!editorView) {
      new Notice('Inline edit requires the live Markdown editor.')
      return
    }
    if (!editorView.state.field(inlineEditField, false)) {
      editorView.dispatch({
        effects: StateEffect.appendConfig.of(inlineEditField),
      })
    }
    const selection = editorView.state.selection.main
    const targetLabel =
      selection.from === selection.to ? 'Current line' : 'Selection'
    let from = selection.from
    let to = selection.to
    if (from === to) {
      const line = editorView.state.doc.lineAt(from)
      from = line.from
      to = line.to
    }
    const snapshot = editorView.state.doc.toString()
    const original = snapshot.slice(from, to)
    const filePath = markdownView.file?.path
    if (!filePath) {
      new Notice('Open a saved Markdown note before using inline edit.')
      return
    }
    const id = uuidv4()
    const researchOptions = getInlineResearchOptions(this.plugin.settings)
    this.drafts.set(id, {
      prompt: '',
      mode: 'auto',
      references: [],
      referenceScope: 'auto',
    })
    const getDraft = () =>
      this.drafts.get(id) ?? {
        prompt: '',
        mode: 'auto' as const,
        references: [],
        referenceScope: 'auto' as const,
      }
    const updateDraft = (draft: InlineDraft) => {
      this.drafts.set(id, {
        ...draft,
        references: [...draft.references],
      })
    }
    const close = () => {
      this.controllers.get(id)?.abort()
      this.controllers.delete(id)
      this.drafts.delete(id)
      this.removeDocumentBinding(id)
      editorView.dispatch({ effects: removeInlineSession.of(id) })
      editorView.focus()
    }
    const accept = () => {
      if (markdownView.file?.path !== filePath) {
        new Notice(
          'The target note changed while the edit was generated. Review and retry.',
        )
        close()
        return
      }
      const sessions = editorView.state.field(inlineEditField, false)
      const session = sessions?.get(id)
      if (!session?.replacement) return
      const changedReferences = getChangedReferencePaths(
        this.plugin.app,
        session.referenceSources,
      )
      if (changedReferences.length > 0) {
        new Notice(
          `Referenced context changed after generation. Applying the reviewed snapshot result (${changedReferences.length} file${changedReferences.length === 1 ? '' : 's'}).`,
        )
      }
      const currentDocument = editorView.state.doc.toString()
      const placement = session.placement ?? 'replace'
      if (placement === 'replace' && session.ignoredInsertions.length > 0) {
        new Notice(
          'Another inline result was inserted inside this source. Use Insert below or retry the replacement.',
        )
        return
      }
      if (
        !isInlineSourceCurrent(
          currentDocument,
          session,
          session.original,
          session.ignoredInsertions,
        )
      ) {
        new Notice(
          'Another edit changed this source. The generated preview was kept for review.',
        )
        return
      }
      const insertion =
        placement === 'insert-after'
          ? buildInlineInsertion(
              currentDocument,
              session.insertAt,
              session.replacement,
            )
          : ''
      const change =
        placement === 'insert-after'
          ? {
              from: session.insertAt,
              to: session.insertAt,
              insert: insertion,
            }
          : {
              from: session.from,
              to: session.to,
              insert: session.replacement,
            }
      this.controllers.delete(id)
      this.drafts.delete(id)
      this.removeDocumentBinding(id)
      editorView.dispatch({
        changes: change,
        effects:
          placement === 'insert-after' && insertion
            ? [
                removeInlineSession.of(id),
                recordInlineInsertion.of({
                  sessionId: id,
                  at: session.insertAt,
                }),
              ]
            : removeInlineSession.of(id),
      })
      if (session.documentJobId && session.documentTask) {
        void this.finishDocumentJob(
          session.documentJobId,
          session.documentTask.id,
        )
      }
      editorView.focus()
    }
    const submit = (
      prompt: string,
      mode: InlineEditMode,
      references: InlineVaultReference[],
      referenceScope: VaultReferenceScope,
    ) => {
      updateDraft({ prompt, mode, references, referenceScope })
      this.routeRequest({
        app: this.plugin.app,
        id,
        from,
        to,
        original,
        snapshot,
        filePath,
        targetLabel,
        prompt,
        mode,
        references,
        researchOptions,
        referenceScope,
        referenceWarnings: [],
        referenceSources: [],
        getDraft,
        updateDraft,
        editorView,
        submit,
        accept,
        close,
        renderMarkdown,
      })
    }
    const renderMarkdown = async (content: string, target: HTMLElement) => {
      target.replaceChildren()
      await MarkdownRenderer.render(
        this.plugin.app,
        content,
        target,
        filePath,
        markdownView,
      )
    }
    this.show(editorView, {
      app: this.plugin.app,
      id,
      from,
      to,
      insertAt: to,
      ignoredInsertions: [],
      original,
      snapshot,
      filePath,
      targetLabel,
      status: 'prompt',
      mode: 'auto',
      references: [],
      researchOptions,
      referenceScope: 'auto',
      referenceWarnings: [],
      referenceSources: [],
      getDraft,
      updateDraft,
      submit,
      accept,
      close,
      renderMarkdown,
    })
  }

  private show(editorView: EditorView, session: InlineSession): void {
    const current = editorView.state
      .field(inlineEditField, false)
      ?.get(session.id)
    editorView.dispatch({
      effects: upsertInlineSession.of({
        ...session,
        from: current?.from ?? session.from,
        to: current?.to ?? session.to,
        insertAt: current?.insertAt ?? session.insertAt,
        ignoredInsertions:
          current?.ignoredInsertions ?? session.ignoredInsertions,
      }),
    })
  }

  private routeRequest(input: InlineRequestInput): void {
    const placement = resolveInlineEditPlacement(input.prompt, input.mode)
    const analysis = analyzeDocumentEdit({
      source: input.original,
      instruction: input.prompt,
      placement,
    })
    const routing = this.plugin.settings.documentEditing.largeEditRouting
    if (
      routing === 'single-response' ||
      (routing === 'auto-confirm' && !analysis.shouldPromote)
    ) {
      void this.generate(input)
      return
    }
    this.showDocumentPreflight(input, analysis.strategy)
  }

  private showDocumentPreflight(
    input: InlineRequestInput,
    strategy: DocumentEditStrategy,
  ): void {
    const placement = resolveInlineEditPlacement(input.prompt, input.mode)
    const analysis = analyzeDocumentEdit({
      source: input.original,
      instruction: input.prompt,
      placement,
      strategy,
    })
    const showStrategy = (next: DocumentEditStrategy) =>
      this.showDocumentPreflight(input, next)
    this.show(input.editorView, {
      ...input,
      insertAt: input.to,
      ignoredInsertions: [],
      status: 'large-confirm',
      placement,
      documentAnalysis: analysis,
      documentStrategy: analysis.strategy,
      startDocumentJob: () => {
        void this.startDocumentJob(input, analysis)
      },
      runSingleResponse: () => {
        void this.generate(input)
      },
      setDocumentStrategy: showStrategy,
    })
  }

  private async startDocumentJob(
    input: InlineRequestInput,
    analysis: DocumentEditAnalysis,
  ): Promise<void> {
    const placement = resolveInlineEditPlacement(input.prompt, input.mode)
    this.controllers.get(input.id)?.abort()
    const controller = new AbortController()
    this.controllers.set(input.id, controller)
    const base: InlineSession = {
      ...input,
      insertAt: input.to,
      ignoredInsertions: [],
      status: 'loading',
      placement,
      documentAnalysis: analysis,
      documentStrategy: analysis.strategy,
      referencePhase: input.references.length > 0 ? 'reading' : 'generating',
    }
    this.show(input.editorView, base)
    try {
      const settings = this.plugin.settings
      const modelId = settings.inlineEdit.modelId ?? settings.chatModelId
      const resolvedReferenceScope =
        input.referenceScope === 'auto' && isExhaustiveReadIntent(input.prompt)
          ? 'entire'
          : input.referenceScope
      const compiledReferences = await compileInlineReferences({
        plugin: this.plugin,
        query: input.prompt,
        references: input.references,
        targetFilePath: input.filePath,
        modelId,
        scope: input.referenceScope,
        signal: controller.signal,
        onProgress: (state) => {
          if (
            controller.signal.aborted ||
            !this.hasSession(input.editorView, input.id)
          ) {
            return
          }
          this.show(input.editorView, {
            ...base,
            referencePhase: getReferencePhase(
              state.type,
              resolvedReferenceScope,
            ),
          })
        },
      })
      if (
        controller.signal.aborted ||
        !this.hasSession(input.editorView, input.id)
      ) {
        return
      }
      const created = await createDocumentEditJob({
        plugin: this.plugin,
        sessionId: input.id,
        sourcePath: input.filePath,
        sourceDocument: input.snapshot,
        sourceFrom: input.from,
        sourceTo: input.to,
        sourceSelection: input.original,
        instruction: input.prompt,
        placement,
        strategy: analysis.strategy,
        modelId,
        references: compiledReferences,
      })
      this.documentBindings.set(created.task.id, {
        editorView: input.editorView,
        sessionId: input.id,
      })
      const session = this.makeDocumentTaskSession({
        input,
        analysis,
        task: created.task,
        manifest: created.manifest,
        compiledReferences,
      })
      this.show(input.editorView, session)
      await this.handleDocumentTaskUpdate(
        this.plugin.backgroundTaskManager?.getTask(created.task.id) ??
          created.task,
      )
    } catch (error) {
      if (
        controller.signal.aborted ||
        !this.hasSession(input.editorView, input.id)
      ) {
        return
      }
      this.show(input.editorView, {
        ...base,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (this.controllers.get(input.id) === controller) {
        this.controllers.delete(input.id)
      }
    }
  }

  private makeDocumentTaskSession(input: {
    input: InlineRequestInput
    analysis: DocumentEditAnalysis
    task: BackgroundTaskRecord
    manifest: DocumentEditJobManifest
    compiledReferences?: CompiledVaultReferences
  }): InlineSession {
    const { task, manifest } = input
    const base: InlineSession = {
      ...input.input,
      insertAt: input.input.to,
      ignoredInsertions: [],
      status: 'document-task',
      placement: manifest.placement,
      documentAnalysis: input.analysis,
      documentStrategy: manifest.strategy,
      documentTask: task,
      documentJobId: manifest.jobId,
      documentDraftPath: manifest.draftPath,
      documentResultPath: manifest.finalResultPath,
      retrievalMetadata: input.compiledReferences?.retrievalMetadata,
      referenceWarnings: Array.from(
        new Set([
          ...(input.compiledReferences?.warnings ?? []),
          ...manifest.warnings,
        ]),
      ),
      referenceSources:
        input.compiledReferences?.sourceFiles ?? manifest.referenceSnapshots,
    }
    return {
      ...base,
      pauseDocumentJob: () => {
        void this.plugin.backgroundTaskManager?.pause(task.id)
      },
      resumeDocumentJob: () => {
        void this.plugin.backgroundTaskManager?.resume(task.id)
      },
      cancelDocumentJob: () => {
        void this.plugin.backgroundTaskManager?.cancel(task.id)
      },
      retryDocumentJob: () => {
        void this.retryDocumentJob(task.id, manifest.jobId)
      },
      useSourceForFailed: () => {
        void this.useSourceForFailed(task.id, manifest.jobId)
      },
      openDocumentReview: () =>
        this.openDocumentReview(manifest.jobId, task.id),
      openDocumentDraft: () => {
        void this.openDocumentDraft(manifest.jobId)
      },
      applyDocumentResult: () => {
        void this.applyDocumentResult(
          input.input.editorView,
          input.input.id,
          manifest.jobId,
          task.id,
        )
      },
      keepDocumentDraft: () => {
        void this.keepDocumentDraft(
          input.input.editorView,
          input.input.id,
          manifest.jobId,
          task.id,
        )
      },
    }
  }

  private async handleDocumentTaskUpdate(
    task: BackgroundTaskRecord,
  ): Promise<void> {
    const binding = this.documentBindings.get(task.id)
    if (!binding || !this.hasSession(binding.editorView, binding.sessionId)) {
      return
    }
    const current = binding.editorView.state
      .field(inlineEditField, false)
      ?.get(binding.sessionId)
    if (!current) return
    const jobId =
      current.documentJobId ??
      (typeof task.input.jobId === 'string' ? task.input.jobId : undefined)
    if (!jobId) return

    if (
      task.status === 'review' &&
      task.input.phase === 'review' &&
      !this.resolvingDocumentTasks.has(task.id)
    ) {
      this.resolvingDocumentTasks.add(task.id)
      try {
        const manifest = await this.documentRepository.readManifest(jobId)
        if (!manifest.finalResultPath) return
        if (manifest.strategy === 'map-reduce') {
          const replacement = await this.documentRepository.readText(
            manifest.finalResultPath,
          )
          this.show(binding.editorView, {
            ...current,
            status: 'preview',
            replacement,
            placement: manifest.placement,
            documentTask: task,
            documentJobId: jobId,
            documentResultPath: manifest.finalResultPath,
            referenceWarnings: Array.from(
              new Set([...current.referenceWarnings, ...manifest.warnings]),
            ),
          })
        } else {
          this.show(binding.editorView, {
            ...current,
            status: 'document-review',
            documentTask: task,
            documentJobId: jobId,
            documentDraftPath: manifest.draftPath,
            documentResultPath: manifest.finalResultPath,
            referenceWarnings: Array.from(
              new Set([...current.referenceWarnings, ...manifest.warnings]),
            ),
          })
        }
      } finally {
        this.resolvingDocumentTasks.delete(task.id)
      }
      return
    }

    this.show(binding.editorView, {
      ...current,
      status: 'document-task',
      documentTask: task,
      referenceWarnings: Array.from(
        new Set([
          ...current.referenceWarnings,
          ...readStringArray(task.input.warnings),
        ]),
      ),
    })
  }

  private async retryDocumentJob(taskId: string, jobId: string): Promise<void> {
    const manager = this.plugin.backgroundTaskManager
    const task = manager?.getTask(taskId)
    if (!manager || !task) return
    if (task.status === 'review' && task.input.phase === 'blocked') {
      const manifest = await this.documentRepository.resetFailed(jobId)
      await manager.updateInput(
        taskId,
        {
          ...task.input,
          phase: manifest.phase,
          failedSections: 0,
        },
        'queued',
      )
      return
    }
    if (['failed', 'canceled', 'interrupted'].includes(task.status)) {
      await manager.retry(taskId)
    }
  }

  private async useSourceForFailed(
    taskId: string,
    jobId: string,
  ): Promise<void> {
    const manager = this.plugin.backgroundTaskManager
    const task = manager?.getTask(taskId)
    if (!manager || !task) return
    const manifest = await this.documentRepository.useSourceForFailed(jobId)
    await manager.updateInput(
      taskId,
      {
        ...task.input,
        phase: manifest.phase,
        failedSections: 0,
      },
      'queued',
    )
  }

  private openDocumentReview(jobId: string, taskId: string): void {
    void import('../document-edit/DocumentEditReviewModal').then(
      ({ DocumentEditReviewModal }) => {
        new DocumentEditReviewModal(this.plugin, jobId, (manifest) => {
          const task = this.plugin.backgroundTaskManager?.getTask(taskId)
          if (task) void this.handleDocumentTaskUpdate(task)
          if (manifest.draftPath) {
            new Notice('Document draft choices updated.')
          }
        }).open()
      },
    )
  }

  private async openDocumentDraft(jobId: string): Promise<void> {
    const manifest = await this.documentRepository.ensureVisibleResult(
      jobId,
      this.plugin.settings.documentEditing.destinationFolder,
    )
    const file = manifest.draftPath
      ? this.plugin.app.vault.getFileByPath(manifest.draftPath)
      : null
    if (!(file instanceof TFile)) {
      new Notice('The document draft could not be opened.')
      return
    }
    await this.plugin.app.workspace.getLeaf('tab').openFile(file)
  }

  private async keepDocumentDraft(
    editorView: EditorView,
    sessionId: string,
    jobId: string,
    taskId: string,
  ): Promise<void> {
    await this.documentRepository.ensureVisibleResult(
      jobId,
      this.plugin.settings.documentEditing.destinationFolder,
    )
    await this.finishDocumentJob(jobId, taskId)
    this.removeDocumentBinding(sessionId)
    this.drafts.delete(sessionId)
    editorView.dispatch({ effects: removeInlineSession.of(sessionId) })
    new Notice('Document draft kept. The source note was not changed.')
  }

  private async applyDocumentResult(
    editorView: EditorView,
    sessionId: string,
    jobId: string,
    taskId: string,
  ): Promise<void> {
    const session = editorView.state
      .field(inlineEditField, false)
      ?.get(sessionId)
    if (!session) return
    const manifest = await this.documentRepository.readManifest(jobId)
    if (!manifest.finalResultPath) {
      new Notice('The document result is not ready.')
      return
    }
    const currentDocument = editorView.state.doc.toString()
    if (
      !isInlineSourceCurrent(
        currentDocument,
        session,
        session.original,
        session.ignoredInsertions,
      )
    ) {
      new Notice(
        'The selected source changed after the document job started. The separate draft was preserved.',
      )
      return
    }
    const result = await this.documentRepository.readText(
      manifest.finalResultPath,
    )
    const insertion =
      manifest.placement === 'insert-after'
        ? buildInlineInsertion(currentDocument, session.insertAt, result)
        : ''
    editorView.dispatch({
      changes:
        manifest.placement === 'insert-after'
          ? { from: session.insertAt, insert: insertion }
          : { from: session.from, to: session.to, insert: result },
      effects:
        manifest.placement === 'insert-after' && insertion
          ? [
              removeInlineSession.of(sessionId),
              recordInlineInsertion.of({
                sessionId,
                at: session.insertAt,
              }),
            ]
          : removeInlineSession.of(sessionId),
    })
    this.removeDocumentBinding(sessionId)
    this.drafts.delete(sessionId)
    await this.finishDocumentJob(jobId, taskId)
    editorView.focus()
  }

  private async finishDocumentJob(
    jobId: string,
    taskId: string,
  ): Promise<void> {
    await this.documentRepository.markComplete(jobId)
    await this.plugin.backgroundTaskManager?.complete(taskId, {})
  }

  private removeDocumentBinding(sessionId: string): void {
    for (const [taskId, binding] of this.documentBindings) {
      if (binding.sessionId === sessionId) {
        this.documentBindings.delete(taskId)
      }
    }
  }

  private async generate(input: InlineRequestInput): Promise<void> {
    const placement = resolveInlineEditPlacement(input.prompt, input.mode)
    const base: InlineSession = {
      ...input,
      insertAt: input.to,
      ignoredInsertions: [],
      status: 'loading',
      placement,
      referencePhase:
        input.references.length > 0 && !input.compiledReferences
          ? 'reading'
          : 'generating',
    }
    this.controllers.get(input.id)?.abort()
    const controller = new AbortController()
    this.controllers.set(input.id, controller)
    this.show(input.editorView, base)
    try {
      const settings = this.plugin.settings
      const modelId = settings.inlineEdit.modelId ?? settings.chatModelId
      const resolvedReferenceScope =
        input.referenceScope === 'auto' && isExhaustiveReadIntent(input.prompt)
          ? 'entire'
          : input.referenceScope
      const compiledReferences =
        input.compiledReferences ??
        (await compileInlineReferences({
          plugin: this.plugin,
          query: input.prompt,
          references: input.references,
          targetFilePath: input.filePath,
          modelId,
          scope: input.referenceScope,
          signal: controller.signal,
          onProgress: (state) => {
            if (
              controller.signal.aborted ||
              this.controllers.get(input.id) !== controller ||
              !this.hasSession(input.editorView, input.id)
            ) {
              return
            }
            this.show(input.editorView, {
              ...base,
              referencePhase: getReferencePhase(
                state.type,
                resolvedReferenceScope,
              ),
            })
          },
        }))
      if (
        controller.signal.aborted ||
        this.controllers.get(input.id) !== controller ||
        !this.hasSession(input.editorView, input.id)
      ) {
        return
      }
      const requestSession: InlineSession = {
        ...base,
        referencePhase: 'generating',
        retrievalMetadata: compiledReferences.retrievalMetadata,
        referenceWarnings: compiledReferences.warnings,
        referenceSources: compiledReferences.sourceFiles,
      }
      this.show(input.editorView, requestSession)
      const { getChatModelClient } = await import('../llm/manager')
      const { providerClient, model } = getChatModelClient({
        modelId,
        settings,
        setSettings: (next) => this.plugin.setSettings(next),
      })
      const contextLimit = settings.inlineEdit.contextCharacters
      const before = input.snapshot.slice(
        Math.max(0, input.from - contextLimit),
        input.from,
      )
      const after = input.snapshot.slice(input.to, input.to + contextLimit)
      const systemPrompt = getInlineEditSystemPrompt(placement)
      const response = await providerClient.generateResponse(
        model,
        {
          model: model.model,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: JSON.stringify({
                instruction: input.prompt,
                selection: input.original,
                contextBefore: before,
                contextAfter: after,
                placement,
                referencedVaultContext:
                  compiledReferences.promptText || undefined,
              }),
            },
          ],
        },
        { signal: controller.signal },
      )
      if (
        controller.signal.aborted ||
        this.controllers.get(input.id) !== controller ||
        !this.hasSession(input.editorView, input.id)
      ) {
        return
      }
      const content = response.choices[0]?.message.content?.trim() ?? ''
      const parsed = parseInlineResponse(content)
      const changedReferences = getChangedReferencePaths(
        this.plugin.app,
        compiledReferences.sourceFiles,
      )
      const warnings = Array.from(
        new Set([
          ...compiledReferences.warnings,
          ...(changedReferences.length > 0
            ? [
                `Referenced context changed after this result started: ${changedReferences.join(', ')}`,
              ]
            : []),
        ]),
      )
      if (parsed.type === 'clarification') {
        this.show(input.editorView, {
          ...requestSession,
          status: 'clarification',
          clarification: parsed.content,
          referenceWarnings: warnings,
          submit: (answer) => {
            const nextPrompt = `${input.prompt}\n\nClarification answer: ${answer}`
            input.updateDraft({
              prompt: nextPrompt,
              mode: input.mode,
              references: [...input.references],
              referenceScope: input.referenceScope,
            })
            void this.generate({
              ...input,
              prompt: nextPrompt,
              compiledReferences,
            })
          },
        })
      } else {
        this.show(input.editorView, {
          ...requestSession,
          status: 'preview',
          replacement: parsed.content,
          referenceWarnings: warnings,
        })
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        this.controllers.get(input.id) !== controller ||
        !this.hasSession(input.editorView, input.id)
      ) {
        return
      }
      this.show(input.editorView, {
        ...base,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (this.controllers.get(input.id) === controller) {
        this.controllers.delete(input.id)
      }
    }
  }

  private hasSession(editorView: EditorView, id: string): boolean {
    return editorView.state.field(inlineEditField, false)?.has(id) ?? false
  }
}

async function compileInlineReferences({
  plugin,
  query,
  references,
  targetFilePath,
  modelId,
  scope,
  signal,
  onProgress,
}: {
  plugin: SmartComposerPlugin
  query: string
  references: readonly InlineVaultReference[]
  targetFilePath: string
  modelId: string
  scope: VaultReferenceScope
  signal?: AbortSignal
  onProgress?: (state: QueryProgressState) => void
}): Promise<CompiledVaultReferences> {
  const vaultReferences = references.filter(
    (
      reference,
    ): reference is Extract<
      InlineVaultReference,
      { type: 'file' | 'folder' }
    > => reference.type === 'file' || reference.type === 'folder',
  )
  const compiled = await compileVaultReferences({
    app: plugin.app,
    settings: plugin.settings,
    setSettings: (next) => plugin.setSettings(next),
    getRagEngine: () => plugin.getRAGEngine(),
    query,
    references: vaultReferences,
    targetFilePath,
    modelId,
    scope,
    signal,
    onProgress,
  })

  const explicitSourceIds = references.flatMap((reference) =>
    reference.type === 'research-source' ? [reference.sourceId] : [],
  )
  const explicitPackIds = references.flatMap((reference) =>
    reference.type === 'research-pack' ? [reference.packId] : [],
  )
  const researchEnabled =
    plugin.settings.research.routingMode !== 'off' &&
    Object.values(plugin.settings.research.sources).some(
      (source) => source.enabled,
    )
  if (!researchEnabled && explicitSourceIds.length === 0) return compiled

  onProgress?.({ type: 'reading-mentionables' })
  const manager = await plugin.getResearchManager()
  const resolvedExplicitIds = Array.from(
    new Set([...explicitSourceIds, ...manager.resolvePackIds(explicitPackIds)]),
  )
  const selectedIds = manager.selectSourceIds(query, resolvedExplicitIds)
  if (selectedIds.length === 0) return compiled

  const mcpSources = selectedIds.filter(
    (sourceId) => getResearchSource(sourceId).protocol === 'mcp',
  )
  const warnings = [...compiled.warnings]
  if (mcpSources.length > 0) {
    warnings.push(
      `Inline edit cannot auto-execute MCP tools yet: ${mcpSources
        .map((sourceId) => getResearchSource(sourceId).name)
        .join(', ')}. Use the side chat for those MCP sources.`,
    )
  }

  let evidence: ResearchEvidence[] = []
  try {
    const research = await manager.searchSources({
      query,
      explicitSourceIds: selectedIds,
      limit: 8,
      signal,
    })
    evidence = research.records
    warnings.push(...research.warnings)
  } catch (error) {
    warnings.push(
      `Research context was unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  const researchText = formatInlineResearchEvidence(evidence)
  return {
    ...compiled,
    promptText: [compiled.promptText, researchText]
      .filter(Boolean)
      .join('\n\n'),
    warnings: Array.from(new Set(warnings)),
  }
}

function formatInlineResearchEvidence(
  records: readonly ResearchEvidence[],
): string {
  if (records.length === 0) return ''
  const groups = new Map<string, ResearchEvidence[]>()
  for (const record of records) {
    const key = `${record.sourceName} (${record.operator})`
    groups.set(key, [...(groups.get(key) ?? []), record])
  }
  const sections = [...groups.entries()].map(([source, entries]) => {
    const items = entries.map((entry, index) => {
      const details = [
        entry.authors?.slice(0, 5).join(', '),
        entry.publicationName,
        entry.publishedAt,
        entry.identifiers.doi ? `DOI ${entry.identifiers.doi}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
      const caveats = entry.caveats?.length
        ? `\n  Caveat: ${entry.caveats.join(' ')}`
        : ''
      const snippet = entry.snippet
        ? `\n  Evidence: ${entry.snippet.slice(0, 800)}`
        : ''
      return `${index + 1}. ${entry.title}\n  URL: ${entry.url}${
        details ? `\n  Metadata: ${details}` : ''
      }${snippet}${caveats}`
    })
    return `### ${source}\n${items.join('\n')}`
  })
  return [
    '<external_research_evidence>',
    'Use this retrieved metadata as a dated evidence snapshot. Cite its URLs, preserve caveats, and never imply that a discovery snippet is verified full text.',
    ...sections,
    '</external_research_evidence>',
  ].join('\n')
}

export function isShortProseEdit(before: string, after: string): boolean {
  if (before.length > 600 || after.length > 600) return false
  if (before.includes('\n') || after.includes('\n')) return false
  return !/(?:^|\s)(?:#{1,6}|[-*>]|\d+\.)\s|`{1,3}|\[\[/.test(
    `${before} ${after}`,
  )
}

export type InlineEditRange = {
  from: number
  to: number
}

export type AcceptedInlineInsertion = {
  sessionId: string
  at: number
}

export function mapInlineEditRange(
  range: InlineEditRange,
  changes: Pick<ChangeDesc, 'mapPos'>,
): InlineEditRange {
  const mappedFrom = changes.mapPos(range.from, 1)
  const mappedTo = changes.mapPos(range.to, -1)
  return {
    from: Math.min(mappedFrom, mappedTo),
    to: Math.max(mappedFrom, mappedTo),
  }
}

export function rebaseInlineEditSessions<T extends InlineEditRange>(
  sessions: ReadonlyMap<string, T>,
  changes: Pick<ChangeDesc, 'mapPos'>,
): Map<string, T> {
  const next = new Map<string, T>()
  for (const [id, session] of sessions) {
    const tracked = session as T & {
      insertAt?: unknown
      ignoredInsertions?: unknown
    }
    const rebased = {
      ...session,
      ...mapInlineEditRange(session, changes),
    } as T & {
      insertAt?: number
      ignoredInsertions?: InlineEditRange[]
    }
    if (typeof tracked.insertAt === 'number') {
      rebased.insertAt = changes.mapPos(tracked.insertAt, 1)
    }
    if (Array.isArray(tracked.ignoredInsertions)) {
      rebased.ignoredInsertions = tracked.ignoredInsertions.map((range) =>
        mapInlineEditRange(range as InlineEditRange, changes),
      )
    }
    next.set(id, rebased as T)
  }
  return next
}

export function updateInlineEditSessionMap<
  T extends InlineEditRange & { id: string },
>(
  sessions: ReadonlyMap<string, T>,
  changes: Pick<ChangeDesc, 'mapPos'>,
  upserts: readonly T[],
  removals: readonly string[],
): Map<string, T> {
  const next = rebaseInlineEditSessions(sessions, changes)
  for (const session of upserts) {
    next.set(session.id, session)
  }
  for (const id of removals) {
    next.delete(id)
  }
  return next
}

export function recordAcceptedInlineInsertion<
  T extends InlineEditRange & {
    id: string
    ignoredInsertions?: readonly InlineEditRange[]
  },
>(
  previousSessions: ReadonlyMap<string, T>,
  rebasedSessions: ReadonlyMap<string, T>,
  insertion: AcceptedInlineInsertion,
  changes: Pick<ChangeDesc, 'mapPos'>,
): Map<string, T> {
  const next = new Map(rebasedSessions)
  const insertedRange = {
    from: changes.mapPos(insertion.at, -1),
    to: changes.mapPos(insertion.at, 1),
  }
  if (insertedRange.from === insertedRange.to) return next

  for (const [id, previous] of previousSessions) {
    if (
      id === insertion.sessionId ||
      insertion.at <= previous.from ||
      insertion.at >= previous.to
    ) {
      continue
    }
    const current = next.get(id)
    if (!current) continue
    next.set(id, {
      ...current,
      ignoredInsertions: [...(current.ignoredInsertions ?? []), insertedRange],
    })
  }
  return next
}

export function isInlineSourceCurrent(
  documentText: string,
  range: InlineEditRange,
  original: string,
  ignoredInsertions: readonly InlineEditRange[] = [],
): boolean {
  return (
    getInlineSourceWithoutInsertions(documentText, range, ignoredInsertions) ===
    original
  )
}

export function getInlineSourceWithoutInsertions(
  documentText: string,
  range: InlineEditRange,
  ignoredInsertions: readonly InlineEditRange[],
): string {
  const insertions = ignoredInsertions
    .map((insertion) => ({
      from: Math.max(range.from, insertion.from),
      to: Math.min(range.to, insertion.to),
    }))
    .filter((insertion) => insertion.from < insertion.to)
    .sort((a, b) => a.from - b.from || a.to - b.to)

  let cursor = range.from
  let source = ''
  for (const insertion of insertions) {
    if (insertion.to <= cursor) continue
    source += documentText.slice(cursor, Math.max(cursor, insertion.from))
    cursor = Math.max(cursor, insertion.to)
  }
  source += documentText.slice(cursor, range.to)
  return source
}

function getInlineWidgetPosition(session: InlineSession): number {
  return session.placement === 'insert-after' ? session.insertAt : session.to
}

export function resolveInlineEditPlacement(
  prompt: string,
  mode: InlineEditMode,
): InlineEditPlacement {
  if (mode !== 'auto') return mode
  const koreanInsertAfter =
    /(?:아래|밑|뒤|다음|하단|끝)\s*(?:에|로|으로)?\s*(?:추가|삽입|붙여|덧붙|작성|써|넣)|(?:추가|삽입|붙여|덧붙|작성|써|넣)\S*\s*(?:아래|밑|뒤|다음|하단|끝)/i
  const englishInsertAfter =
    /\b(?:append|add|insert|write|place)\b[\s\S]{0,48}\b(?:below|after|under|at the end)\b|\b(?:below|after|under)\b[\s\S]{0,48}\b(?:append|add|insert|write|place)\b/i
  return koreanInsertAfter.test(prompt) || englishInsertAfter.test(prompt)
    ? 'insert-after'
    : 'replace'
}

export function buildInlineInsertion(
  documentText: string,
  position: number,
  content: string,
): string {
  const normalized = content.trim()
  if (!normalized) return ''
  const before = documentText.slice(0, position)
  const after = documentText.slice(position)
  const prefix =
    before.length === 0 || before.endsWith('\n\n')
      ? ''
      : before.endsWith('\n')
        ? '\n'
        : '\n\n'
  const suffix =
    after.length === 0 || after.startsWith('\n\n')
      ? ''
      : after.startsWith('\n')
        ? '\n'
        : '\n\n'
  return `${prefix}${normalized}${suffix}`
}

export function getInlineEditSystemPrompt(
  placement: InlineEditPlacement,
): string {
  return placement === 'insert-after'
    ? 'Use the selected Markdown as read-only source material. Generate only the new Markdown to insert immediately after the selection; never repeat, rewrite, or quote the source. Return JSON only: {"type":"insertion","content":"..."} or, only when essential information is missing, {"type":"clarification","content":"question"}. Preserve useful Markdown formatting and do not include fences.'
    : 'Edit the selected Markdown in place. Return JSON only: {"type":"replacement","content":"..."} or, only when essential information is missing, {"type":"clarification","content":"question"}. Preserve formatting and do not include fences.'
}

function makeRenderedDiffPane(
  doc: Document,
  label: string,
  className: string,
): { pane: HTMLElement; content: HTMLElement } {
  const pane = doc.createElement('section')
  pane.className = className
  const heading = doc.createElement('strong')
  heading.textContent = label
  const content = doc.createElement('div')
  content.className = 'rendered'
  pane.append(heading, content)
  return { pane, content }
}

function renderWordDiff(
  doc: Document,
  before: string,
  after: string,
  target: HTMLElement,
): void {
  const beforeTokens = tokenize(before)
  const afterTokens = tokenize(after)
  const shared = longestCommonTokenSubsequence(beforeTokens, afterTokens)
  let beforeIndex = 0
  let afterIndex = 0
  for (const token of [...shared, null]) {
    const nextBefore =
      token === null
        ? beforeTokens.length
        : beforeTokens.indexOf(token, beforeIndex)
    const nextAfter =
      token === null
        ? afterTokens.length
        : afterTokens.indexOf(token, afterIndex)
    appendDiffTokens(
      doc,
      target,
      beforeTokens.slice(beforeIndex, nextBefore),
      'removed',
    )
    appendDiffTokens(
      doc,
      target,
      afterTokens.slice(afterIndex, nextAfter),
      'added',
    )
    if (token !== null) target.append(doc.createTextNode(token))
    beforeIndex = nextBefore + 1
    afterIndex = nextAfter + 1
  }
}

function tokenize(value: string): string[] {
  return value.match(/\s+|[^\s]+/g) ?? []
}

function longestCommonTokenSubsequence(
  before: string[],
  after: string[],
): string[] {
  const table = Array.from({ length: before.length + 1 }, () =>
    Array<number>(after.length + 1).fill(0),
  )
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const shared: string[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      shared.push(before[i])
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }
  return shared
}

function appendDiffTokens(
  doc: Document,
  target: HTMLElement,
  tokens: string[],
  className: 'added' | 'removed',
): void {
  if (tokens.length === 0) return
  const span = doc.createElement(className === 'added' ? 'ins' : 'del')
  span.className = className
  span.textContent = tokens.join('')
  target.append(span)
}

export function parseInlineResponse(value: string): {
  type: 'replacement' | 'insertion' | 'clarification'
  content: string
} {
  const stripped = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(stripped) as {
      type?: string
      content?: string
    }
    if (
      (parsed.type === 'replacement' ||
        parsed.type === 'insertion' ||
        parsed.type === 'clarification') &&
      typeof parsed.content === 'string'
    ) {
      return {
        type: parsed.type,
        content: parsed.content,
      }
    }
  } catch {
    // Older and custom models may return the replacement directly.
  }
  return { type: 'replacement', content: stripped }
}

function makeModeControl(
  doc: Document,
  initialMode: InlineEditMode,
  onChange: (mode: InlineEditMode) => void,
): HTMLElement {
  const row = doc.createElement('div')
  row.className = 'mode-row'
  const label = doc.createElement('span')
  label.className = 'mode-label'
  label.textContent = 'Result placement'
  const group = doc.createElement('div')
  group.className = 'mode-control'
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', 'Inline edit result placement')
  const options: { mode: InlineEditMode; label: string }[] = [
    { mode: 'auto', label: 'Auto' },
    { mode: 'replace', label: 'Replace' },
    { mode: 'insert-after', label: 'Insert below' },
  ]
  const buttons: HTMLButtonElement[] = []
  const selectMode = (mode: InlineEditMode) => {
    for (const button of buttons) {
      const active = button.dataset.mode === mode
      button.dataset.active = active ? 'true' : 'false'
      button.setAttribute('aria-checked', active ? 'true' : 'false')
    }
    onChange(mode)
  }
  for (const option of options) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'mode-option'
    button.dataset.mode = option.mode
    button.setAttribute('role', 'radio')
    button.textContent = option.label
    button.addEventListener('click', () => selectMode(option.mode))
    buttons.push(button)
    group.append(button)
  }
  row.append(label, group)
  selectMode(initialMode)
  return row
}

function makeReferenceScopeControl(
  doc: Document,
  initialScope: VaultReferenceScope,
  onChange: (scope: VaultReferenceScope) => void,
): {
  element: HTMLElement
  setVisible: (visible: boolean) => void
  setEstimatedFiles: (count: number) => void
} {
  const row = doc.createElement('div')
  row.className = 'mode-row reference-scope-row'
  const label = doc.createElement('span')
  label.className = 'mode-label'
  label.textContent = 'Folder context'
  const group = doc.createElement('div')
  group.className = 'mode-control'
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', 'Folder reference context scope')
  const options: { scope: VaultReferenceScope; label: string }[] = [
    { scope: 'auto', label: 'Auto' },
    { scope: 'focused', label: 'Focused' },
    { scope: 'entire', label: 'Entire' },
  ]
  const buttons: HTMLButtonElement[] = []
  const selectScope = (scope: VaultReferenceScope) => {
    for (const button of buttons) {
      const active = button.dataset.scope === scope
      button.dataset.active = active ? 'true' : 'false'
      button.setAttribute('aria-checked', active ? 'true' : 'false')
    }
    onChange(scope)
  }
  for (const option of options) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'mode-option'
    button.dataset.scope = option.scope
    button.setAttribute('role', 'radio')
    button.textContent = option.label
    button.title =
      option.scope === 'auto'
        ? 'Use request intent to choose focused or entire-folder reading'
        : option.scope === 'focused'
          ? 'Select only the most relevant folder snippets'
          : 'Process every Markdown file in the selected folders'
    button.addEventListener('click', () => selectScope(option.scope))
    buttons.push(button)
    group.append(button)
  }
  row.append(label, group)
  selectScope(initialScope)
  return {
    element: row,
    setVisible(visible) {
      row.hidden = !visible
    },
    setEstimatedFiles(count) {
      label.textContent =
        count > 0 ? `Folder context / ${count} files` : 'Folder context'
    },
  }
}

function makeReadOnlyReferenceChips(
  doc: Document,
  references: readonly InlineVaultReference[],
): HTMLElement {
  const row = doc.createElement('div')
  row.className = 'reference-chips reference-chips-readonly'
  row.hidden = references.length === 0
  for (const reference of references) {
    const chip = doc.createElement('span')
    chip.className = 'reference-chip'
    chip.title = getInlineReferenceDescription(reference)
    chip.textContent = `${getInlineReferenceKind(reference)} · ${getInlineReferenceName(reference)}`
    row.append(chip)
  }
  return row
}

function renderPromptReferenceEcho(
  doc: Document,
  region: HTMLElement,
  references: readonly InlineVaultReference[],
): void {
  region.replaceChildren()
  region.hidden = references.length === 0
  for (const reference of references) {
    const token = doc.createElement('span')
    token.className = 'prompt-reference-token'
    token.title = getInlineReferenceDescription(reference)
    token.textContent = `@${getInlineReferenceName(reference)}`
    region.append(token)
  }
}

function makeReferenceStatus(
  doc: Document,
  session: InlineSession,
): HTMLElement {
  const region = doc.createElement('div')
  region.className = 'reference-status'
  const summary = doc.createElement('span')
  summary.className = 'reference-summary'
  summary.textContent = getRetrievalSummary(session)
  region.append(summary)
  if (session.referenceWarnings.length > 0) {
    const warnings = doc.createElement('ul')
    warnings.className = 'reference-warnings'
    for (const warning of session.referenceWarnings) {
      const item = doc.createElement('li')
      item.textContent = warning
      warnings.append(item)
    }
    region.append(warnings)
  }
  return region
}

function getRetrievalSummary(session: InlineSession): string {
  if (session.references.length === 0) return ''
  const metadata = session.retrievalMetadata
  const parts = [`${session.references.length} refs`]
  if (metadata) {
    parts.push(`${metadata.totalFilesRead} files`)
    parts.push(
      metadata.exhaustive
        ? 'entire scope processed'
        : `${metadata.selectedChunks} snippets`,
    )
    if (metadata.fallbackUsed) parts.push('local fallback')
  } else if (session.referenceSources.length > 0) {
    parts.push(`${session.referenceSources.length} files`)
    parts.push('direct context')
  } else {
    parts.push(
      session.referenceScope === 'entire'
        ? 'entire scope'
        : session.referenceScope,
    )
  }
  return parts.join(' / ')
}

function getInlineLoadingCopy(session: InlineSession): {
  title: string
  detail: string
} {
  switch (session.referencePhase) {
    case 'reading':
      return {
        title: 'Reading references',
        detail: 'Resolving this session\u2019s notes and folders',
      }
    case 'selecting':
      return {
        title: 'Selecting relevant sections',
        detail: 'Preparing focused vault context for this edit',
      }
    case 'exhaustive':
      return {
        title: 'Processing entire folder',
        detail: 'Every scoped Markdown file will be covered',
      }
    case 'generating':
    default:
      return {
        title:
          session.placement === 'insert-after'
            ? 'Writing below selection'
            : 'Editing in place',
        detail:
          session.placement === 'insert-after'
            ? 'The selected source will remain unchanged'
            : 'Preparing a precise Markdown revision',
      }
  }
}

function getReferencePhase(
  progressType: QueryProgressState['type'],
  scope: VaultReferenceScope,
): InlineReferencePhase {
  if (progressType === 'reading-mentionables') return 'reading'
  if (progressType === 'idle') return 'generating'
  return scope === 'entire' ? 'exhaustive' : 'selecting'
}

export function getChangedReferencePaths(
  app: App,
  sources: readonly CompiledVaultReferences['sourceFiles'][number][],
): string[] {
  return sources
    .filter((source) => {
      const file = app.vault.getFileByPath(source.path)
      return (
        !file ||
        file.stat.mtime !== source.mtime ||
        file.stat.size !== source.size
      )
    })
    .map((source) => source.path)
}

function getReferenceName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function countReferencedMarkdownFiles(
  app: App,
  references: readonly InlineVaultReference[],
): number {
  const paths = new Set<string>()
  for (const reference of references) {
    if (reference.type === 'file') {
      const file = app.vault.getFileByPath(reference.path)
      if (file?.extension === 'md') paths.add(file.path)
      continue
    }
    if (reference.type !== 'folder') continue
    const folder = app.vault.getFolderByPath(reference.path)
    if (!folder) continue
    for (const file of getNestedFiles(folder, app.vault)) {
      if (file.extension === 'md') paths.add(file.path)
    }
  }
  return paths.size
}

function getInlineResearchOptions(
  settings: SmartComposerPlugin['settings'],
): InlineVaultReference[] {
  const sourceOptions = (
    Object.keys(settings.research.sources) as ResearchSourceId[]
  )
    .filter((sourceId) => settings.research.sources[sourceId]?.enabled)
    .map((sourceId) => ({
      type: 'research-source' as const,
      sourceId,
      name: getResearchSource(sourceId).name,
    }))
  const packOptions = RESEARCH_PACKS.filter((pack) =>
    pack.sourceIds.some(
      (sourceId) => settings.research.sources[sourceId]?.enabled,
    ),
  ).map((pack) => ({
    type: 'research-pack' as const,
    packId: pack.id,
    name: pack.name,
  }))
  return [...sourceOptions, ...packOptions]
}

function getInlineReferenceName(reference: InlineVaultReference): string {
  switch (reference.type) {
    case 'file':
    case 'folder':
      return getReferenceName(reference.path)
    case 'research-source':
    case 'research-pack':
      return reference.name
  }
}

function getInlineReferenceDescription(
  reference: InlineVaultReference,
): string {
  switch (reference.type) {
    case 'file':
    case 'folder':
      return reference.path
    case 'research-source':
      return `${reference.name} research source`
    case 'research-pack':
      return `${reference.name} research pack`
  }
}

function getInlineReferenceKind(reference: InlineVaultReference): string {
  switch (reference.type) {
    case 'file':
      return 'Note'
    case 'folder':
      return 'Folder'
    case 'research-source':
      return 'Source'
    case 'research-pack':
      return 'Pack'
  }
}

function makeMetric(doc: Document, label: string, value: string): HTMLElement {
  const metric = doc.createElement('div')
  const heading = doc.createElement('small')
  heading.textContent = label
  const content = doc.createElement('strong')
  content.textContent = value
  metric.append(heading, content)
  return metric
}

function getDocumentTaskTitle(task?: BackgroundTaskRecord): string {
  if (!task) return 'Starting document job'
  if (task.status === 'review' && task.input.phase === 'blocked') {
    return 'Document job needs review'
  }
  if (task.status === 'paused') return 'Document job paused'
  if (task.status === 'waiting-connection') return 'Reconnect to continue'
  if (task.status === 'failed') return 'Document job failed'
  if (task.status === 'interrupted') return 'Document job interrupted'
  if (task.status === 'canceled') return 'Document job canceled'
  return task.progress?.phase === 'assembling'
    ? 'Assembling document draft'
    : task.progress?.phase === 'reducing'
      ? 'Combining all section results'
      : task.progress?.phase === 'planning'
        ? 'Planning document edit'
        : 'Editing document in sections'
}

function getDocumentTaskSummary(task?: BackgroundTaskRecord): string {
  if (!task) return ''
  return [
    task.status,
    task.updatedAt,
    task.progress?.phase,
    task.progress?.current,
    task.progress?.total,
    task.progress?.message,
    task.error,
    task.input.phase,
    task.input.completedSections,
    task.input.failedSections,
  ].join('|')
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function makeButton(
  doc: Document,
  label: string,
  onClick: () => void,
  variant: 'primary' | 'secondary' = 'secondary',
  shortcut?: string,
): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = variant
  const text = doc.createElement('span')
  text.textContent = label
  button.append(text)
  if (shortcut) {
    const key = doc.createElement('kbd')
    key.textContent = shortcut
    button.append(key)
  }
  button.addEventListener('click', onClick)
  return button
}

function makeHeader(doc: Document, session: InlineSession): HTMLElement {
  const header = doc.createElement('header')
  const identity = doc.createElement('span')
  identity.className = 'identity'
  const spark = doc.createElement('i')
  spark.className = 'spark'
  spark.setAttribute('aria-hidden', 'true')
  const title = doc.createElement('strong')
  title.textContent =
    session.status === 'large-confirm'
      ? 'Large document edit'
      : session.status === 'document-task'
        ? 'Document edit job'
        : session.status === 'document-review'
          ? 'Review document draft'
          : session.status === 'preview'
            ? session.placement === 'insert-after'
              ? 'Review insertion'
              : 'Review inline edit'
            : 'Inline edit'
  identity.append(spark, title)
  const context = doc.createElement('span')
  context.className = 'context'
  context.textContent = [
    session.targetLabel,
    ...(session.placement === 'insert-after' ? ['insert below'] : []),
    ...(session.references.length > 0
      ? [`${session.references.length} refs`]
      : []),
  ].join(' / ')
  header.append(identity, context)
  return header
}

function makeThinkingDots(doc: Document): HTMLElement {
  const dots = doc.createElement('span')
  dots.className = 'thinking-dots'
  dots.setAttribute('aria-hidden', 'true')
  dots.append(
    doc.createElement('i'),
    doc.createElement('i'),
    doc.createElement('i'),
  )
  return dots
}

export type InlineSkin = 'hallym-light' | 'cmds-dark'

export function resolveInlineSkin(classList: {
  contains: (className: string) => boolean
}): InlineSkin {
  return classList.contains('theme-dark') ? 'cmds-dark' : 'hallym-light'
}

const INLINE_STYLE = `
:host{
  --ach-canvas:#f7f9fc;
  --ach-surface:#ffffff;
  --ach-surface-raised:#f0f5fa;
  --ach-border:#d7e1ec;
  --ach-text:#00102e;
  --ach-muted:#526174;
  --ach-heading:#002e6e;
  --ach-action:#0066b3;
  --ach-action-hover:#00528f;
  --ach-motion:#00b5ad;
  --ach-danger:#a52834;
  --ach-before:#fff5f6;
  --ach-before-border:#efd3d7;
  --ach-before-text:#672a31;
  --ach-after:#effaf6;
  --ach-after-border:#cce9dd;
  --ach-after-text:#123f31;
  display:block;
  min-width:0;
  color:var(--ach-text);
  color-scheme:light;
  font:13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  letter-spacing:0;
}
:host([data-skin="cmds-dark"]){
  --ach-canvas:#0a0a0a;
  --ach-surface:#141414;
  --ach-surface-raised:#1f1f1f;
  --ach-border:#333333;
  --ach-text:#d4d4d4;
  --ach-muted:#888888;
  --ach-heading:#b6ff00;
  --ach-action:#b6ff00;
  --ach-action-hover:#d0ff5b;
  --ach-motion:#00b5ad;
  --ach-danger:#ff6675;
  --ach-before:#261516;
  --ach-before-border:#573238;
  --ach-before-text:#f5c5ca;
  --ach-after:#101a12;
  --ach-after-border:#40542d;
  --ach-after-text:#dfffb3;
  color-scheme:dark;
  font-family:"IBM Plex Sans",Inter,ui-sans-serif,system-ui,sans-serif;
}
*,*::before,*::after{box-sizing:border-box}
.panel{
  position:relative;
  min-width:0;
  margin:8px 0 10px;
  padding:12px;
  overflow:hidden;
  border:1px solid var(--ach-border);
  border-radius:7px;
  background:var(--ach-surface);
  box-shadow:0 8px 24px rgba(0,46,110,.09);
}
:host([data-skin="cmds-dark"]) .panel{
  border-radius:5px 14px 5px 14px;
  box-shadow:inset 2px 0 0 #b6ff00,0 10px 28px rgba(0,0,0,.6);
}
.panel[data-status="loading"],
.panel[data-status="document-task"][data-task-status="running"],
.panel[data-status="document-task"][data-task-status="queued"]{isolation:isolate}
.panel[data-status="loading"]::before,
.panel[data-status="document-task"][data-task-status="running"]::before,
.panel[data-status="document-task"][data-task-status="queued"]::before{
  position:absolute;
  z-index:0;
  top:50%;
  left:50%;
  width:160%;
  aspect-ratio:1;
  pointer-events:none;
  content:"";
  background:conic-gradient(
    transparent 0 58%,
    color-mix(in srgb,var(--ach-action) 16%,transparent) 67%,
    var(--ach-action) 76%,
    var(--ach-motion) 85%,
    transparent 94% 100%
  );
  filter:drop-shadow(0 0 4px color-mix(in srgb,var(--ach-motion) 36%,transparent));
  transform:translate(-50%,-50%) rotate(0deg);
  animation:inline-panel-border-orbit 1.8s linear infinite;
}
.panel[data-status="loading"]::after,
.panel[data-status="document-task"][data-task-status="running"]::after,
.panel[data-status="document-task"][data-task-status="queued"]::after{
  position:absolute;
  z-index:1;
  inset:1.5px;
  pointer-events:none;
  content:"";
  border-radius:inherit;
  background:var(--ach-surface);
}
.panel[data-status="loading"]>*,
.panel[data-status="document-task"][data-task-status="running"]>*,
.panel[data-status="document-task"][data-task-status="queued"]>*{position:relative;z-index:2}
:host([data-skin="cmds-dark"]) .panel[data-status="loading"]{
  box-shadow:0 10px 28px rgba(0,0,0,.6);
}
:host([data-skin="cmds-dark"]) .panel[data-status="loading"]::before{
  filter:drop-shadow(0 0 4px rgba(182,255,0,.38)) drop-shadow(0 0 8px rgba(0,181,173,.16));
}
header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  min-height:24px;
  margin:-2px 0 10px;
  padding:0 0 8px;
  border-bottom:1px solid var(--ach-border);
}
.identity{display:inline-flex;align-items:center;gap:7px;min-width:0;color:var(--ach-heading)}
.identity strong{font-size:13px;font-weight:650;letter-spacing:0}
.spark{
  width:9px;
  height:9px;
  flex:0 0 auto;
  border-radius:2px;
  background:var(--ach-action);
  box-shadow:0 0 9px color-mix(in srgb,var(--ach-action) 42%,transparent);
  transform:rotate(45deg);
}
.context{
  overflow:hidden;
  color:var(--ach-muted);
  font:10px/1.2 ui-monospace,"Cascadia Code",monospace;
  text-overflow:ellipsis;
  text-transform:uppercase;
  white-space:nowrap;
}
.reference-region{min-width:0}
.reference-chips{
  display:flex;
  min-width:0;
  flex-wrap:wrap;
  gap:5px;
  margin:0 0 7px;
}
.reference-chip{
  display:inline-flex;
  max-width:min(100%,260px);
  min-height:25px;
  align-items:center;
  gap:5px;
  padding:3px 5px 3px 7px;
  overflow:hidden;
  border:1px solid color-mix(in srgb,var(--ach-action) 35%,var(--ach-border));
  border-radius:5px;
  background:color-mix(in srgb,var(--ach-action) 7%,var(--ach-surface));
  color:var(--ach-heading);
  font-size:11px;
}
.reference-icon{display:inline-flex;width:14px;height:14px;flex:0 0 auto}
.reference-icon svg,.reference-remove svg{width:100%;height:100%;stroke-width:1.8}
.reference-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.reference-remove{
  width:20px;
  min-width:20px;
  min-height:20px;
  padding:3px;
  border:0;
}
.reference-list{
  max-height:220px;
  margin:0 0 7px;
  padding:4px;
  overflow:auto;
  border:1px solid var(--ach-border);
  border-radius:6px;
  background:var(--ach-surface);
  box-shadow:0 10px 28px rgba(0,46,110,.15);
  scrollbar-color:var(--ach-border) transparent;
}
button.reference-option{
  display:grid;
  width:100%;
  min-height:38px;
  grid-template-columns:16px minmax(0,1fr);
  justify-content:stretch;
  padding:5px 7px;
  border:0;
  text-align:left;
}
button.reference-option[data-active="true"]{
  background:var(--ach-surface-raised);
  color:var(--ach-action);
}
.reference-option-copy{display:flex;min-width:0;flex-direction:column;align-items:flex-start}
.reference-option-copy strong,.reference-option-copy small{
  display:block;
  max-width:100%;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.reference-option-copy strong{font-size:11px}
.reference-option-copy small{color:var(--ach-muted);font-size:9px;font-weight:400}
.reference-chips-readonly{margin-bottom:9px}
.reference-status{
  display:flex;
  min-width:0;
  flex-direction:column;
  gap:5px;
  margin:-2px 0 8px;
}
.reference-summary{
  overflow:hidden;
  color:var(--ach-muted);
  font:10px/1.35 ui-monospace,"Cascadia Code",monospace;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.reference-warnings{
  margin:0;
  padding:6px 8px 6px 24px;
  border-left:2px solid var(--ach-danger);
  background:var(--ach-before);
  color:var(--ach-danger);
  font-size:10px;
}
.prompt-surface{
  width:100%;
  overflow:hidden;
  border:1px solid var(--ach-border);
  border-radius:6px;
  background:var(--ach-canvas);
}
.prompt-reference-echo{
  display:flex;
  min-width:0;
  flex-wrap:wrap;
  gap:5px;
  padding:8px 10px 0;
}
.prompt-reference-token{
  display:inline-block;
  max-width:min(100%,280px);
  padding:1px 6px;
  overflow:hidden;
  border-radius:4px;
  background:color-mix(in srgb,var(--ach-action) 10%,var(--ach-surface));
  color:var(--ach-action);
  font-size:11px;
  font-weight:650;
  line-height:1.65;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.prompt{
  display:block;
  width:100%;
  min-height:72px;
  max-height:240px;
  padding:10px 11px;
  resize:vertical;
  color:var(--ach-text);
  caret-color:var(--ach-action);
  border:0;
  border-radius:0;
  outline:none;
  background:transparent;
  font:inherit;
  line-height:1.5;
}
.prompt-reference-echo:not([hidden]) + .prompt{padding-top:6px}
.prompt::placeholder{color:var(--ach-muted);opacity:.8}
.prompt-surface:focus-within{
  border-color:var(--ach-action);
  box-shadow:0 0 0 2px color-mix(in srgb,var(--ach-action) 18%,transparent);
}
:host([data-skin="cmds-dark"]) .prompt-surface:focus-within{
  box-shadow:0 0 0 1px rgba(182,255,0,.27),0 0 18px rgba(182,255,0,.1);
}
.mode-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-top:8px;
}
.mode-label{
  color:var(--ach-muted);
  font:10px/1.2 ui-monospace,"Cascadia Code",monospace;
  text-transform:uppercase;
}
.mode-control{
  display:inline-grid;
  grid-auto-flow:column;
  overflow:hidden;
  border:1px solid var(--ach-border);
  border-radius:5px;
  background:var(--ach-canvas);
}
button.mode-option{
  min-height:27px;
  padding:4px 8px;
  border:0;
  border-left:1px solid var(--ach-border);
  border-radius:0;
  font-size:11px;
}
button.mode-option:first-child{border-left:0}
button.mode-option[data-active="true"]{
  background:var(--ach-action);
  color:#fff;
}
:host([data-skin="cmds-dark"]) button.mode-option[data-active="true"]{color:#0a0a0a}
.actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;margin-top:10px}
button{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  min-height:32px;
  padding:5px 10px;
  border:1px solid var(--ach-border);
  border-radius:5px;
  outline:none;
  background:transparent;
  color:var(--ach-muted);
  font:inherit;
  font-weight:560;
  cursor:pointer;
}
button:hover,button:focus-visible{
  border-color:var(--ach-action);
  color:var(--ach-action);
  background:var(--ach-surface-raised);
}
button:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--ach-action) 24%,transparent)}
button.primary{
  border-color:var(--ach-action);
  background:var(--ach-action);
  color:#fff;
}
button.primary:hover,button.primary:focus-visible{border-color:var(--ach-action-hover);background:var(--ach-action-hover);color:#fff}
:host([data-skin="cmds-dark"]) button.primary{color:#0a0a0a}
kbd{
  padding:1px 4px;
  border:1px solid currentColor;
  border-radius:3px;
  font:9px/1.25 ui-monospace,"Cascadia Code",monospace;
  opacity:.67;
}
.question{
  margin:0 0 9px;
  padding:8px 10px;
  border-left:2px solid var(--ach-motion);
  background:var(--ach-surface-raised);
  color:var(--ach-text);
}
.loading{display:flex;align-items:center;gap:12px;min-height:54px;padding:4px 2px}
.loading-copy{display:flex;min-width:0;flex-direction:column;gap:1px}
.loading-copy strong{color:var(--ach-heading);font-size:13px;font-weight:650}
.loading-copy small{overflow:hidden;color:var(--ach-muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.thinking-dots{display:flex;align-items:center;justify-content:center;gap:3px;width:28px;height:28px;flex:0 0 auto}
.thinking-dots i{width:4px;height:4px;border-radius:50%;background:var(--ach-heading);box-shadow:0 0 5px color-mix(in srgb,var(--ach-action) 34%,transparent);opacity:.58}
.thinking-dots i:nth-child(2){opacity:1}
.document-preflight,.document-progress,.document-ready{display:flex;min-width:0;flex-direction:column;gap:9px}
.document-preflight__message,.document-ready p{margin:0;color:var(--ach-text)}
.document-preflight__reason,.document-ready small,.document-progress__status small{color:var(--ach-muted);font-size:10px}
.document-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.document-metrics>div{display:flex;min-width:0;flex-direction:column;gap:2px;padding:8px;border:1px solid var(--ach-border);border-radius:6px;background:var(--ach-canvas)}
.document-metrics small{color:var(--ach-muted);font-size:9px;text-transform:uppercase}
.document-metrics strong{overflow:hidden;color:var(--ach-heading);font-size:11px;text-overflow:ellipsis}
.document-strategy{display:flex;gap:7px}
.document-progress__status{display:flex;min-width:0;flex-direction:column;gap:2px}
.document-progress__status strong,.document-ready>strong{color:var(--ach-heading);font-size:13px}
.document-progress progress{width:100%;height:6px;overflow:hidden;border:0;border-radius:999px;background:var(--ach-surface-raised);accent-color:var(--ach-action)}
.document-warnings{padding:7px 8px;border-left:2px solid var(--ach-danger);background:var(--ach-before);color:var(--ach-danger);font-size:10px}
.document-ready{padding:10px;border:1px solid var(--ach-after-border);border-radius:6px;background:var(--ach-after);color:var(--ach-after-text)}
.diff{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
.insert-preview{display:grid;grid-template-columns:minmax(145px,.42fr) minmax(0,1fr);gap:8px}
.diff section,.insert-preview section{
  min-width:0;
  max-height:320px;
  margin:0;
  padding:10px;
  overflow:auto;
  border:1px solid;
  border-radius:6px;
  scrollbar-color:var(--ach-border) transparent;
}
.diff section>strong,.insert-preview section>strong{display:block;margin-bottom:7px;font-size:11px;text-transform:uppercase}
.source-preserved{
  display:flex;
  min-width:0;
  flex-direction:column;
  align-items:flex-start;
  justify-content:center;
  gap:3px;
  padding:10px;
  border:1px solid var(--ach-border);
  border-radius:6px;
  background:var(--ach-surface-raised);
}
.source-preserved strong{color:var(--ach-heading);font-size:12px}
.source-preserved small{color:var(--ach-muted);font-size:10px}
.before{border-color:var(--ach-before-border)!important;background:var(--ach-before);color:var(--ach-before-text)}
.after{border-color:var(--ach-after-border)!important;background:var(--ach-after);color:var(--ach-after-text)}
.rendered{overflow-wrap:anywhere}
.rendered :first-child{margin-top:0}.rendered :last-child{margin-bottom:0}
.rendered p,.rendered ul,.rendered ol,.rendered blockquote,.rendered pre{margin:0 0 9px}
.rendered h1,.rendered h2,.rendered h3,.rendered h4{margin:10px 0 6px;color:inherit;font-size:1em}
.rendered a{color:var(--ach-action)}
.rendered code{padding:1px 3px;border-radius:3px;background:color-mix(in srgb,var(--ach-surface) 70%,transparent);font:11px/1.4 ui-monospace,"Cascadia Code",monospace}
.rendered pre{overflow:auto;padding:8px;border-radius:4px;background:var(--ach-canvas)}
.rendered table{width:100%;border-collapse:collapse}.rendered th,.rendered td{padding:5px;border:1px solid currentColor}
.word-diff{
  margin:0;
  padding:11px;
  white-space:pre-wrap;
  border:1px solid var(--ach-border);
  border-radius:6px;
  background:var(--ach-canvas);
  overflow-wrap:anywhere;
}
.word-diff del{background:var(--ach-before);color:var(--ach-danger);text-decoration:line-through}
.word-diff ins{background:var(--ach-after);color:var(--ach-after-text);text-decoration:none}
.error{margin:0;padding:9px 10px;border-left:2px solid var(--ach-danger);background:var(--ach-before);color:var(--ach-danger)}
@keyframes inline-panel-border-orbit{to{transform:translate(-50%,-50%) rotate(360deg)}}
@media(max-width:620px){.diff,.insert-preview{grid-template-columns:1fr}.diff section,.insert-preview section{max-height:240px}.document-metrics{grid-template-columns:1fr}.actions{flex-wrap:wrap}.context{display:none}.mode-row{align-items:flex-start;flex-direction:column}.mode-control{width:100%;grid-auto-columns:1fr}button{min-height:34px}}
@media(prefers-reduced-motion:reduce){.panel[data-status="loading"]::before,.panel[data-status="document-task"]::before{animation:none;background:var(--ach-action);opacity:.4}}
@media(forced-colors:active){.panel,.prompt,.mode-control,.reference-chip,.reference-list,.diff section,.insert-preview section,.source-preserved,.word-diff,.document-metrics>div,.document-ready,button{border:1px solid CanvasText}.panel[data-status="loading"]::before,.panel[data-status="document-task"]::before{background:CanvasText;filter:none}.spark,.thinking-dots i{background:CanvasText;box-shadow:none}}
`
