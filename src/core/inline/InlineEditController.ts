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
  targetLabel: 'Selection' | 'Current line'
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
  private themeObserver: MutationObserver | null = null

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
          if (value) this.session.submit(value)
        },
        'primary',
        'Enter',
      )
      actions.append(cancel, submit)
      panel.append(input, actions)
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
          textContent: 'Editing in place',
        }),
        Object.assign(doc.createElement('small'), {
          textContent: 'Preparing a precise Markdown revision',
        }),
      )
      loading.append(makeOrbitalLoader(doc), copy)
      panel.append(loading)
    } else if (this.session.status === 'preview') {
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
        makeButton(
          doc,
          'Reject',
          () => this.session.close(),
          'secondary',
          'Esc',
        ),
        makeButton(
          doc,
          'Accept',
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
      queueMicrotask(() => host.focus({ preventScroll: true }))
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
        targetLabel,
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
      targetLabel,
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
    targetLabel: 'Selection' | 'Current line'
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
    session.status === 'preview' ? 'Review inline edit' : 'Inline edit'
  identity.append(spark, title)
  const context = doc.createElement('span')
  context.className = 'context'
  context.textContent = session.targetLabel
  header.append(identity, context)
  return header
}

function makeOrbitalLoader(doc: Document): HTMLElement {
  const orbital = doc.createElement('span')
  orbital.className = 'orb'
  orbital.setAttribute('aria-hidden', 'true')
  const ring = doc.createElement('span')
  ring.className = 'orb-ring'
  const dots = doc.createElement('span')
  dots.className = 'orb-dots'
  dots.append(
    doc.createElement('i'),
    doc.createElement('i'),
    doc.createElement('i'),
  )
  orbital.append(ring, dots)
  return orbital
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
.orb{position:relative;width:28px;height:28px;flex:0 0 auto}
.orb-ring{
  position:absolute;
  inset:0;
  border-radius:50%;
  background:conic-gradient(from 0deg,transparent 0 14%,var(--ach-action) 36%,var(--ach-motion) 64%,transparent 88%);
  filter:drop-shadow(0 0 5px color-mix(in srgb,var(--ach-action) 42%,transparent));
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 1.5px));
  mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 1.5px));
  animation:orbit 1.15s linear infinite;
}
.orb-dots{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:2px}
.orb-dots i{width:3px;height:3px;border-radius:50%;background:var(--ach-heading);box-shadow:0 0 5px color-mix(in srgb,var(--ach-action) 48%,transparent);animation:pulse 1s ease-in-out infinite}
.orb-dots i:nth-child(2){animation-delay:.12s}.orb-dots i:nth-child(3){animation-delay:.24s}
.diff{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
.diff section{
  min-width:0;
  max-height:320px;
  margin:0;
  padding:10px;
  overflow:auto;
  border:1px solid;
  border-radius:6px;
  scrollbar-color:var(--ach-border) transparent;
}
.diff section>strong{display:block;margin-bottom:7px;font-size:11px;text-transform:uppercase}
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
@keyframes orbit{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:.35;transform:translateY(0)}50%{opacity:1;transform:translateY(-1px)}}
@media(max-width:620px){.diff{grid-template-columns:1fr}.diff section{max-height:240px}.context{display:none}button{min-height:34px}}
@media(prefers-reduced-motion:reduce){.orb-ring,.orb-dots i{animation:none}}
@media(forced-colors:active){.panel,.prompt,.diff section,.word-diff,button{border:1px solid CanvasText}.orb-ring{background:CanvasText;filter:none}.spark,.orb-dots i{background:CanvasText;box-shadow:none}}
`
