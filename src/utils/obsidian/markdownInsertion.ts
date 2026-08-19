import { App, MarkdownView } from 'obsidian'

export function findMarkdownInsertionView(
  app: App,
  preferredFilePath?: string,
): MarkdownView | null {
  const activeView = app.workspace.getActiveViewOfType(MarkdownView)
  if (activeView) return activeView

  const markdownViews = app.workspace
    .getLeavesOfType('markdown')
    .map((leaf) => leaf.view)
    .filter((view): view is MarkdownView => view instanceof MarkdownView)
  const activeFile = app.workspace.getActiveFile()

  if (activeFile) {
    const activeFileView = markdownViews.find(
      (view) => view.file?.path === activeFile.path,
    )
    if (activeFileView) return activeFileView
  }

  if (preferredFilePath) {
    const preferredView = markdownViews.find(
      (view) => view.file?.path === preferredFilePath,
    )
    if (preferredView) return preferredView
  }

  return markdownViews.length === 1 ? markdownViews[0] : null
}

export function insertMarkdownIntoOpenView(
  app: App,
  markdown: string,
  preferredFilePath?: string,
): boolean {
  const view = findMarkdownInsertionView(app, preferredFilePath)
  if (!view) return false
  view.editor.replaceSelection(markdown)
  return true
}
