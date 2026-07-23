import {
  Check,
  CloudUpload,
  Expand,
  LoaderCircle,
  RotateCcw,
  Square,
  X,
} from 'lucide-react'
import { MarkdownView, Notice, TFile } from 'obsidian'
import { useEffect, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { usePlugin } from '../../contexts/plugin-context'
import { uploadWithCmdsEagle } from '../../core/image/CmdsEagleBridge'
import {
  ArtifactRecord,
  BackgroundTaskRecord,
} from '../../types/background-task'

export function BackgroundTaskCards({
  conversationId,
  originMessageId,
}: {
  conversationId: string
  originMessageId: string
}) {
  const app = useApp()
  const plugin = usePlugin()
  const manager = plugin.backgroundTaskManager
  const [tasks, setTasks] = useState<BackgroundTaskRecord[]>([])
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactRecord>>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!manager) return
    return manager.subscribe((allTasks) => {
      const relevant = allTasks.filter(
        (task) =>
          task.conversationId === conversationId &&
          task.originMessageId === originMessageId,
      )
      setTasks(relevant)
      void Promise.all(
        relevant
          .flatMap((task) => task.artifactIds)
          .map((id) => manager.readArtifact(id)),
      ).then((records) => {
        setArtifacts(
          Object.fromEntries(
            records
              .filter((record): record is ArtifactRecord => !!record)
              .map((record) => [record.id, record]),
          ),
        )
      })
    })
  }, [conversationId, manager, originMessageId])

  if (!manager || tasks.length === 0) return null

  const insertMarkdown = (markdown: string) => {
    const view = app.workspace.getActiveViewOfType(MarkdownView)
    if (!view) {
      new Notice('Open a Markdown note before inserting the image.')
      return false
    }
    view.editor.replaceSelection(markdown)
    return true
  }

  const finishLocal = async (
    task: BackgroundTaskRecord,
    artifact: ArtifactRecord,
    embed: boolean,
  ) => {
    if (embed && artifact.localPath) {
      if (!insertMarkdown(`![[${artifact.localPath}]]`)) return
    }
    await manager.complete(task.id, {
      progress: {
        phase: embed ? 'inserted' : 'saved',
        message: embed ? 'Inserted into note' : 'Saved locally',
      },
    })
  }

  const uploadR2 = async (
    task: BackgroundTaskRecord,
    artifact: ArtifactRecord,
  ) => {
    if (!artifact.localPath || !artifact.mimeType) return
    try {
      const url = await uploadWithCmdsEagle(
        app,
        artifact.localPath,
        artifact.mimeType,
      )
      const updated = { ...artifact, remoteUrl: url }
      await manager.saveArtifact(updated)
      const filename = artifact.localPath.split('/').at(-1) ?? 'image'
      insertMarkdown(`![${filename}](${url})`)
      setArtifacts((current) => ({ ...current, [updated.id]: updated }))
      await manager.complete(task.id, {
        progress: { phase: 'uploaded', message: 'Uploaded and inserted' },
      })
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="smtcmp-task-list" aria-live="polite">
      {tasks.map((task) => {
        const artifact = artifacts[task.artifactIds[0]]
        const file = artifact?.localPath
          ? app.vault.getAbstractFileByPath(artifact.localPath)
          : null
        const resourcePath =
          file instanceof TFile ? app.vault.getResourcePath(file) : null
        return (
          <section className="smtcmp-task-card" key={task.id}>
            <div className="smtcmp-task-card__status">
              {['queued', 'running'].includes(task.status) ? (
                <LoaderCircle className="smtcmp-task-spinner" size={16} />
              ) : task.status === 'succeeded' ? (
                <Check size={16} />
              ) : task.status === 'canceled' ? (
                <Square size={14} />
              ) : (
                <X size={16} />
              )}
              <span>
                {task.progress?.message ??
                  task.error ??
                  task.status.replace(/-/g, ' ')}
              </span>
            </div>
            {resourcePath && (
              <button
                className="smtcmp-image-preview"
                onClick={() => setExpanded(resourcePath)}
                aria-label="Open generated image full size"
              >
                <img src={resourcePath} alt="Generated image preview" />
                <Expand size={16} />
                {artifact?.width && artifact.height && (
                  <span>
                    {artifact.width} × {artifact.height}
                  </span>
                )}
              </button>
            )}
            {task.status === 'awaiting-destination' && artifact && (
              <div className="smtcmp-task-card__actions">
                <button onClick={() => void finishLocal(task, artifact, false)}>
                  <Check size={14} /> Keep local
                </button>
                <button onClick={() => void finishLocal(task, artifact, true)}>
                  <Check size={14} /> Insert embed
                </button>
                <button onClick={() => void uploadR2(task, artifact)}>
                  <CloudUpload size={14} /> CMDS R2
                </button>
              </div>
            )}
            {task.status === 'awaiting-approval' && !!task.input.draft && (
              <>
                <ArtifactPreview draft={task.input.draft} />
                <div className="smtcmp-task-card__actions">
                  <button
                    onClick={() =>
                      void manager.updateInput(
                        task.id,
                        { ...task.input, approved: true },
                        'queued',
                      )
                    }
                  >
                    <Check size={14} /> Approve write
                  </button>
                  <button onClick={() => void manager.cancel(task.id)}>
                    <X size={14} /> Reject
                  </button>
                </div>
              </>
            )}
            {['failed', 'interrupted', 'canceled'].includes(task.status) && (
              <button onClick={() => void manager.retry(task.id)}>
                <RotateCcw size={14} /> Retry
              </button>
            )}
            {['queued', 'running'].includes(task.status) && (
              <button onClick={() => void manager.cancel(task.id)}>
                <Square size={14} /> Cancel task
              </button>
            )}
          </section>
        )
      })}
      {expanded && (
        <div
          className="smtcmp-image-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpanded(null)}
        >
          <button aria-label="Close full-size image">
            <X />
          </button>
          <img src={expanded} alt="Generated image full size" />
        </div>
      )}
    </div>
  )
}

function ArtifactPreview({ draft }: { draft: unknown }) {
  if (!draft || typeof draft !== 'object') return null
  const value = draft as {
    kind?: string
    path?: string
    nodes?: unknown[]
    edges?: unknown[]
    elements?: { type?: string }[]
    config?: { views?: unknown[]; filters?: unknown }
  }
  const summary =
    value.kind === 'canvas'
      ? `${value.nodes?.length ?? 0} nodes · ${value.edges?.length ?? 0} edges`
      : value.kind === 'base'
        ? `${value.config?.views?.length ?? 0} views · ${
            value.config?.filters ? 'filtered' : 'no filter'
          }`
        : `${value.elements?.length ?? 0} elements · ${Array.from(
            new Set(value.elements?.map((element) => element.type)),
          )
            .filter(Boolean)
            .join(', ')}`
  return (
    <div className="smtcmp-artifact-preview">
      <strong>{value.kind?.toUpperCase()} preview</strong>
      <span>{value.path}</span>
      <span>{summary}</span>
      <span>No file changes until approval.</span>
    </div>
  )
}
