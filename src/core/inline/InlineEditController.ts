import { StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view'
import { Editor, MarkdownRenderer, MarkdownView, Notice } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import type SmartComposerPlugin from '../../main'
import { getChatModelClient } from '../llm/manager'

type InlineStatus = 'prompt' | 'loading' | 'clarification' | 'preview' | 'error'

type InlineSession = {
  id: string
  from: number
  to: number
  original: string
  snapshot: string
  filePath: string
  status: InlineStatus
  prompt?: string
  clarification?: string
  replacement?: string
  error?: string
  submit: (prompt: string) => void
  accept: () => void
  close: () => void
  renderMarkdown: (content: string, target: HTMLElement) => Promise<void>
}

const setInlineSession = StateEffect.define<InlineSession | null>()

class InlineEditWidget extends WidgetType {
  constructor(private readonly session: InlineSession) {
    super()
  }

  eq(other: InlineEditWidget): boolean {
    return (
      other.session.id === this.session.id &&
      other.session.status === this.session.status &&
      other.session.replacement === this.session.replacement &&
      other.session.error === this.session.error
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument
    const host = doc.createElement('div')
    host.className = 'smtcmp-inline-host'
    const shadow = host.attachShadow({ mode: 'open' })
    const style = doc.createElement('style')
    style.textContent = INLINE_STYLE
    shadow.appendChild(style)

    const panel = doc.createElement('section')
    panel.className = 'panel'
    panel.setAttribute('aria-live', 'polite')
    shadow.appendChild(panel)

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
      input.placeholder =
        this.session.status === 'clarification'
          ? 'Clarify the change...'
          : 'Describe the edit...'
      input.value =
        this.session.status === 'clarification'
          ? ''
          : (this.session.prompt ?? '')
      input.rows = 2
      const actions = doc.createElement('div')
      actions.className = 'actions'
      const cancel = makeButton(doc, 'Cancel', () => this.session.close())
      const submit = makeButton(doc, 'Generate', () => {
        const value = input.value.trim()
        if (value) this.session.submit(value)
      })
      actions.append(cancel, submit)
      panel.append(input, actions)
      input.addEventListener('keydown', (event) => {
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
      queueMicrotask(() => input.focus())
    } else if (this.session.status === 'loading') {
      const loading = doc.createElement('div')
      loading.className = 'loading'
      loading.innerHTML =
        '<span class="orb"><i></i><i></i><i></i></span><span>Editing selection</span>'
      panel.appendChild(loading)
    } else if (this.session.status === 'preview') {
      const heading = doc.createElement('div')
      heading.className = 'heading'
      heading.textContent = 'Inline edit preview'
      const diff = doc.createElement('div')
      const replacement = this.session.replacement ?? ''
      if (isShortProseEdit(this.session.original, replacement)) {
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
        makeButton(doc, 'Reject Esc', () => this.session.close()),
        makeButton(doc, 'Accept Enter', () => this.session.accept()),
      )
      panel.append(heading, diff, actions)
      host.tabIndex = 0
      host.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') this.session.close()
        if (event.key === 'Enter') this.session.accept()
      })
      queueMicrotask(() => host.focus())
    } else {
      const error = doc.createElement('p')
      error.className = 'error'
      error.textContent = this.session.error ?? 'Inline edit failed.'
      panel.append(
        error,
        makeButton(doc, 'Close', () => this.session.close()),
      )
    }
    return host
  }

  ignoreEvent(): boolean {
    return false
  }
}

const inlineEditField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setInlineSession)) {
        if (!effect.value) return Decoration.none
        return Decoration.set([
          Decoration.widget({
            widget: new InlineEditWidget(effect.value),
            side: 1,
            block: true,
          }).range(effect.value.to),
        ])
      }
    }
    return value.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

export class InlineEditController {
  private controller: AbortController | null = null

  constructor(private readonly plugin: SmartComposerPlugin) {}

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
      this.controller?.abort()
      this.controller = null
      editorView.dispatch({ effects: setInlineSession.of(null) })
      editorView.focus()
    }
    const accept = () => {
      if (
        markdownView.file?.path !== filePath ||
        editorView.state.doc.toString() !== snapshot
      ) {
        new Notice(
          'The note changed while the edit was generated. Review and retry.',
        )
        close()
        return
      }
      const current = editorView.state.field(inlineEditField, false)
      if (!current) return
      const session = this.currentSession
      if (!session?.replacement) return
      editorView.dispatch({
        changes: { from, to, insert: session.replacement },
        effects: setInlineSession.of(null),
      })
      editorView.focus()
    }
    const submit = (prompt: string) => {
      void this.generate({
        id,
        from,
        to,
        original,
        snapshot,
        filePath,
        prompt,
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
      original,
      snapshot,
      filePath,
      status: 'prompt',
      submit,
      accept,
      close,
      renderMarkdown,
    })
  }

  private currentSession: InlineSession | null = null

  private show(editorView: EditorView, session: InlineSession): void {
    this.currentSession = session
    editorView.dispatch({ effects: setInlineSession.of(session) })
  }

  private async generate(input: {
    id: string
    from: number
    to: number
    original: string
    snapshot: string
    filePath: string
    prompt: string
    editorView: EditorView
    submit: (prompt: string) => void
    accept: () => void
    close: () => void
    renderMarkdown: (content: string, target: HTMLElement) => Promise<void>
  }): Promise<void> {
    const base: InlineSession = {
      ...input,
      status: 'loading',
    }
    this.show(input.editorView, base)
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
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
      const response = await providerClient.generateResponse(
        model,
        {
          model: model.model,
          messages: [
            {
              role: 'system',
              content:
                'Edit the selected Markdown in place. Return JSON only: {"type":"replacement","content":"..."} or, only when essential information is missing, {"type":"clarification","content":"question"}. Preserve formatting and do not include fences.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                instruction: input.prompt,
                selection: input.original,
                contextBefore: before,
                contextAfter: after,
              }),
            },
          ],
        },
        { signal: controller.signal },
      )
      const content = response.choices[0]?.message.content?.trim() ?? ''
      const parsed = parseInlineResponse(content)
      if (parsed.type === 'clarification') {
        this.show(input.editorView, {
          ...base,
          status: 'clarification',
          clarification: parsed.content,
          submit: (answer) =>
            input.submit(`${input.prompt}\n\nClarification answer: ${answer}`),
        })
      } else {
        this.show(input.editorView, {
          ...base,
          status: 'preview',
          replacement: parsed.content,
        })
      }
    } catch (error) {
      if (controller.signal.aborted) return
      this.show(input.editorView, {
        ...base,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export function isShortProseEdit(before: string, after: string): boolean {
  if (before.length > 600 || after.length > 600) return false
  if (before.includes('\n') || after.includes('\n')) return false
  return !/(?:^|\s)(?:#{1,6}|[-*>]|\d+\.)\s|`{1,3}|\[\[/.test(
    `${before} ${after}`,
  )
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
  type: 'replacement' | 'clarification'
  content: string
} {
  const stripped = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(stripped) as {
      type?: string
      content?: string
    }
    if (
      (parsed.type === 'replacement' || parsed.type === 'clarification') &&
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

function makeButton(
  doc: Document,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}

const INLINE_STYLE = `
:host{display:block;font:13px/1.45 Inter,system-ui,sans-serif;color:#e8edf0}
.panel{margin:8px 0;padding:10px;border:1px solid #2d7f5e;background:#101512;box-shadow:0 8px 24px #0008}
textarea{box-sizing:border-box;width:100%;resize:vertical;border:1px solid #3f5550;background:#090c0b;color:#eef8f3;padding:8px;outline:none}
textarea:focus{border-color:#54ff9a;box-shadow:0 0 0 2px #54ff9a22}
.actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
button{border:1px solid #3d6554;background:#17231d;color:#dbf9e7;padding:5px 9px;cursor:pointer}
button:hover,button:focus{border-color:#54ff9a;outline:none}
.loading{display:flex;align-items:center;gap:10px}.orb{position:relative;width:20px;height:20px;animation:spin 1.4s linear infinite}
.orb i{position:absolute;width:4px;height:4px;border-radius:50%;background:#54ff9a;box-shadow:0 0 7px #54ff9a}.orb i:nth-child(1){left:8px}.orb i:nth-child(2){right:1px;bottom:2px}.orb i:nth-child(3){left:1px;bottom:2px}
.diff{display:grid;grid-template-columns:1fr 1fr;gap:6px}.diff section{overflow:auto;max-height:280px;margin:6px 0;padding:8px}.before{background:#351719;color:#ffced1}.after{background:#12301f;color:#c8ffdc}.rendered{margin-top:6px}.rendered :first-child{margin-top:0}.rendered :last-child{margin-bottom:0}
.word-diff{margin:7px 0;padding:9px;white-space:pre-wrap;background:#0b0e0c}.word-diff del{background:#6c2429;color:#ffd7da;text-decoration:line-through}.word-diff ins{background:#18512e;color:#d4ffe2;text-decoration:none}
.heading{font-weight:600}.question{color:#bdeed0}.error{color:#ff9da4}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.orb{animation:none}}
`
