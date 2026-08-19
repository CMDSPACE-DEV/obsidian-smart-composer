import { App, MarkdownView } from 'obsidian'
import type { WorkspaceLeaf } from 'obsidian'

import {
  findMarkdownInsertionView,
  insertMarkdownIntoOpenView,
} from './markdownInsertion'

function markdownView(path: string, replaceSelection = jest.fn()) {
  const view = Object.assign(new MarkdownView({} as WorkspaceLeaf), {
    file: { path },
    editor: { replaceSelection },
  })
  return view as MarkdownView
}

function appWithWorkspace(input: {
  activeView?: MarkdownView | null
  activeFilePath?: string | null
  views?: MarkdownView[]
}) {
  const views = input.views ?? []
  return {
    workspace: {
      getActiveViewOfType: jest.fn(() => input.activeView ?? null),
      getActiveFile: jest.fn(() =>
        input.activeFilePath ? { path: input.activeFilePath } : null,
      ),
      getLeavesOfType: jest.fn(() => views.map((view) => ({ view }))),
    },
  } as unknown as App
}

describe('markdown insertion target', () => {
  it('uses the active Markdown view directly', () => {
    const active = markdownView('active.md')
    const app = appWithWorkspace({ activeView: active })

    expect(findMarkdownInsertionView(app)).toBe(active)
  })

  it('finds the active file when the chat side pane owns focus', () => {
    const first = markdownView('first.md')
    const target = markdownView('target.md')
    const app = appWithWorkspace({
      activeFilePath: 'target.md',
      views: [first, target],
    })

    expect(findMarkdownInsertionView(app)).toBe(target)
  })

  it('uses the only open Markdown view when no active file is reported', () => {
    const only = markdownView('only.md')
    const app = appWithWorkspace({ views: [only] })

    expect(findMarkdownInsertionView(app)).toBe(only)
  })

  it('does not guess between multiple notes without an active file', () => {
    const app = appWithWorkspace({
      views: [markdownView('first.md'), markdownView('second.md')],
    })

    expect(findMarkdownInsertionView(app)).toBeNull()
  })

  it('falls back to the request origin note when the chat owns focus', () => {
    const first = markdownView('first.md')
    const origin = markdownView('origin.md')
    const app = appWithWorkspace({ views: [first, origin] })

    expect(findMarkdownInsertionView(app, 'origin.md')).toBe(origin)
  })

  it('inserts at the resolved editor selection', () => {
    const replaceSelection = jest.fn()
    const target = markdownView('target.md', replaceSelection)
    const app = appWithWorkspace({
      activeFilePath: 'target.md',
      views: [target],
    })

    expect(insertMarkdownIntoOpenView(app, '![[image.png]]')).toBe(true)
    expect(replaceSelection).toHaveBeenCalledWith('![[image.png]]')
  })
})
