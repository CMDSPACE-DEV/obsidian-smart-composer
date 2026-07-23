import { StateEffect, StateField } from '@codemirror/state'
import type { ChangeDesc } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { Editor, MarkdownRenderer, MarkdownView, Notice } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import type SmartComposerPlugin from '../../main'
import { getChatModelClient } from '../llm/manager'

type InlineStatus = 'prompt' | 'loading' | 'clarification' | 'preview' | 'error'

export type InlineEditMode = 'auto' | 'replace' | 'insert-after'
export type InlineEditPlacement = 'replace' | 'insert-after'

type InlineSession = {
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
  submit: (prompt: string, mode: InlineEditMode) => void
  accept: () => void
  close: () => void
  renderMarkdown: (content: string, target: HTMLElement) => Promise<void>
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
      other.session.error === this.session.error
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
    panel.setAttribute('aria-live', 'polite')
    panel.setAttribute('aria-label', 'Smart Composer inline edit')
    shadow.appendChild(panel)

    panel.appendChild(makeHeader(doc, this.session))

    if (
      this.session.status === 'prompt' ||
      this.session.status === 'clarification'
    ) {
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
      input.value =
        this.session.status === 'clarification'
          ? ''
          : (this.session.prompt ?? '')
      input.rows = 2
      let selectedMode = this.session.mode
      const modeControl = makeModeControl(doc, selectedMode, (nextMode) => {
        selectedMode = nextMode
      })
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
          if (value) this.session.submit(value, selectedMode)
        },
        'primary',
        'Enter',
      )
      actions.append(cancel, submit)
      panel.append(input, modeControl, actions)
      input.addEventListener('keydown', (event) => {
        event.stopPropagation()
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
    } else if (this.session.status === 'loading') {
      const loading = doc.createElement('div')
      loading.className = 'loading'
      const copy = doc.createElement('span')
      copy.className = 'loading-copy'
      copy.append(
        Object.assign(doc.createElement('strong'), {
          textContent:
            this.session.placement === 'insert-after'
              ? 'Writing below selection'
              : 'Editing in place',
        }),
        Object.assign(doc.createElement('small'), {
          textContent:
            this.session.placement === 'insert-after'
              ? 'The selected source will remain unchanged'
              : 'Preparing a precise Markdown revision',
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

  constructor(private readonly plugin: SmartComposerPlugin) {}

  cleanup(): void {
    for (const controller of this.controllers.values()) {
      controller.abort()
    }
    this.controllers.clear()
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
    const close = () => {
      this.controllers.get(id)?.abort()
      this.controllers.delete(id)
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
      editorView.focus()
    }
    const submit = (prompt: string, mode: InlineEditMode) => {
      void this.generate({
        id,
        from,
        to,
        original,
        snapshot,
        filePath,
        targetLabel,
        prompt,
        mode,
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

  private async generate(input: {
    id: string
    from: number
    to: number
    original: string
    snapshot: string
    filePath: string
    targetLabel: 'Selection' | 'Current line'
    prompt: string
    mode: InlineEditMode
    editorView: EditorView
    submit: (prompt: string, mode: InlineEditMode) => void
    accept: () => void
    close: () => void
    renderMarkdown: (content: string, target: HTMLElement) => Promise<void>
  }): Promise<void> {
    const placement = resolveInlineEditPlacement(input.prompt, input.mode)
    const base: InlineSession = {
      ...input,
      insertAt: input.to,
      ignoredInsertions: [],
      status: 'loading',
      placement,
    }
    this.controllers.get(input.id)?.abort()
    const controller = new AbortController()
    this.controllers.set(input.id, controller)
    this.show(input.editorView, base)
    try {
      const settings = this.plugin.settings
      const modelId = settings.inlineEdit.modelId ?? settings.chatModelId
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
      if (parsed.type === 'clarification') {
        this.show(input.editorView, {
          ...base,
          status: 'clarification',
          clarification: parsed.content,
          submit: (answer) =>
            input.submit(
              `${input.prompt}\n\nClarification answer: ${answer}`,
              input.mode,
            ),
        })
      } else {
        this.show(input.editorView, {
          ...base,
          status: 'preview',
          replacement: parsed.content,
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
    session.status === 'preview'
      ? session.placement === 'insert-after'
        ? 'Review insertion'
        : 'Review inline edit'
      : 'Inline edit'
  identity.append(spark, title)
  const context = doc.createElement('span')
  context.className = 'context'
  context.textContent =
    session.placement === 'insert-after'
      ? `${session.targetLabel} · insert below`
      : session.targetLabel
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
.panel[data-status="loading"]{isolation:isolate}
.panel[data-status="loading"]::before{
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
.panel[data-status="loading"]::after{
  position:absolute;
  z-index:1;
  inset:1.5px;
  pointer-events:none;
  content:"";
  border-radius:inherit;
  background:var(--ach-surface);
}
.panel[data-status="loading"]>*{position:relative;z-index:2}
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
.prompt{
  display:block;
  width:100%;
  min-height:72px;
  max-height:240px;
  padding:10px 11px;
  resize:vertical;
  color:var(--ach-text);
  caret-color:var(--ach-action);
  border:1px solid var(--ach-border);
  border-radius:6px;
  outline:none;
  background:var(--ach-canvas);
  font:inherit;
  line-height:1.5;
}
.prompt::placeholder{color:var(--ach-muted);opacity:.8}
.prompt:focus{
  border-color:var(--ach-action);
  box-shadow:0 0 0 2px color-mix(in srgb,var(--ach-action) 18%,transparent);
}
:host([data-skin="cmds-dark"]) .prompt:focus{
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
@media(max-width:620px){.diff,.insert-preview{grid-template-columns:1fr}.diff section,.insert-preview section{max-height:240px}.context{display:none}.mode-row{align-items:flex-start;flex-direction:column}.mode-control{width:100%;grid-auto-columns:1fr}button{min-height:34px}}
@media(prefers-reduced-motion:reduce){.panel[data-status="loading"]::before{animation:none;background:var(--ach-action);opacity:.4}}
@media(forced-colors:active){.panel,.prompt,.mode-control,.diff section,.insert-preview section,.source-preserved,.word-diff,button{border:1px solid CanvasText}.panel[data-status="loading"]::before{background:CanvasText;filter:none}.spark,.thinking-dots i{background:CanvasText;box-shadow:none}}
`
