import {
  Check,
  CircleAlert,
  CircleEllipsis,
  CloudUpload,
  Expand,
  FolderOpen,
  LoaderCircle,
  LocateFixed,
  RotateCcw,
  Square,
  X,
} from 'lucide-react'
import { Notice, TFile } from 'obsidian'
import { useMemo, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { useBackgroundTasks } from '../../contexts/background-tasks-context'
import { uploadWithCmdsEagle } from '../../core/image/CmdsEagleBridge'
import {
  ArtifactRecord,
  BackgroundTaskRecord,
} from '../../types/background-task'
import { selectVisibleImageTasks } from '../../utils/chat/imageQueue'
import { insertMarkdownIntoOpenView } from '../../utils/obsidian/markdownInsertion'

export function BackgroundTaskCards({
  conversationId,
  originMessageId,
  taskScope = 'message',
  onLocateOrigin,
  onUseResult,
}: {
  conversationId: string
  originMessageId?: string
  taskScope?: 'message' | 'image-queue'
  onLocateOrigin?: (messageId: string) => void
  onUseResult?: (
    task: BackgroundTaskRecord,
    result: string,
  ) => boolean | Promise<boolean>
}) {
  const app = useApp()
  const { artifacts, manager, tasks: allTasks } = useBackgroundTasks()
  const [expanded, setExpanded] = useState<string | null>(null)

  const tasks = useMemo(
    () =>
      taskScope === 'image-queue'
        ? selectVisibleImageTasks(allTasks, conversationId)
        : allTasks.filter(
            (task) =>
              task.conversationId === conversationId &&
              task.originMessageId === originMessageId &&
              task.kind !== 'image-generation',
          ),
    [allTasks, conversationId, originMessageId, taskScope],
  )

  if (!manager || tasks.length === 0) return null

  const insertMarkdown = (task: BackgroundTaskRecord, markdown: string) => {
    const preferredFilePath =
      typeof task.input.targetFilePath === 'string'
        ? task.input.targetFilePath
        : undefined
    if (!insertMarkdownIntoOpenView(app, markdown, preferredFilePath)) {
      new Notice('Open a Markdown note before inserting the image.')
      return false
    }
    return true
  }

  const finishLocal = async (
    task: BackgroundTaskRecord,
    artifact: ArtifactRecord,
    embed: boolean,
  ) => {
    if (embed && artifact.localPath) {
      if (!insertMarkdown(task, `![[${artifact.localPath}]]`)) return
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
      const url =
        artifact.remoteUrl ??
        (await uploadWithCmdsEagle(app, artifact.localPath, artifact.mimeType))
      const updated = { ...artifact, remoteUrl: url }
      await manager.saveArtifact(updated)
      const filename = artifact.localPath.split('/').at(-1) ?? 'image'
      if (!insertMarkdown(task, `![${filename}](${url})`)) {
        await manager.updateProgress(task.id, {
          phase: 'uploaded-awaiting-insert',
          message: 'Uploaded to R2 · select an open note to insert',
        })
        return
      }
      await manager.complete(task.id, {
        progress: {
          phase: 'uploaded-inserted',
          message: 'Uploaded to R2 and inserted',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await manager.updateProgress(task.id, {
        phase: 'upload-failed',
        message: 'R2 upload failed · local image preserved',
      })
      new Notice(message)
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
        const legacyUnverifiedR2Insert =
          !!artifact?.remoteUrl &&
          task.status === 'succeeded' &&
          task.progress?.phase === 'uploaded'
        const terminalError =
          ['failed', 'interrupted'].includes(task.status) && task.error
            ? task.error
            : null
        const statusMessage = legacyUnverifiedR2Insert
          ? 'Uploaded to R2 · insertion not verified'
          : task.status === 'failed'
            ? task.kind === 'image-generation'
              ? 'Image generation failed'
              : 'Task failed'
            : task.status === 'interrupted'
              ? task.kind === 'image-generation'
                ? 'Image generation interrupted'
                : 'Task interrupted'
              : task.status === 'canceled'
                ? task.kind === 'image-generation'
                  ? 'Image generation canceled'
                  : 'Task canceled'
                : task.kind === 'mcp-tool-call' && task.status === 'succeeded'
                  ? 'MCP result ready'
                  : task.status === 'waiting-connection'
                    ? 'Waiting for MCP connection'
                    : (task.progress?.message ??
                      task.error ??
                      task.status.replace(/-/g, ' '))
        const dismissibleImageTask =
          task.kind === 'image-generation' &&
          ['succeeded', 'failed', 'canceled', 'interrupted'].includes(
            task.status,
          )
        const dismissibleMcpTask =
          task.kind === 'mcp-tool-call' && isTerminalTask(task)
        const dismissLabel =
          task.status === 'succeeded'
            ? 'Dismiss completed image task'
            : `Dismiss ${task.status} image task`
        const displayPrompt =
          typeof task.input.displayPrompt === 'string'
            ? task.input.displayPrompt
            : typeof task.input.prompt === 'string'
              ? task.input.prompt
              : null
        return (
          <section
            className="smtcmp-task-card"
            data-task-kind={task.kind}
            data-task-status={task.status}
            key={task.id}
          >
            <div className="smtcmp-task-card__status">
              {legacyUnverifiedR2Insert ? (
                <CloudUpload size={15} />
              ) : ['queued', 'running'].includes(task.status) ? (
                <LoaderCircle className="smtcmp-task-spinner" size={16} />
              ) : task.status === 'succeeded' ? (
                <Check size={16} />
              ) : [
                  'awaiting-destination',
                  'awaiting-approval',
                  'waiting-connection',
                ].includes(task.status) ? (
                <CircleEllipsis size={15} />
              ) : task.status === 'canceled' ? (
                <Square size={14} />
              ) : ['failed', 'interrupted'].includes(task.status) ? (
                <CircleAlert size={15} />
              ) : (
                <X size={16} />
              )}
              <span>{statusMessage}</span>
              {taskScope === 'image-queue' &&
                task.conversationId === conversationId &&
                onLocateOrigin && (
                  <button
                    className="smtcmp-task-card__locate"
                    onClick={() => onLocateOrigin(task.originMessageId)}
                    aria-label="Go to image request"
                  >
                    <LocateFixed size={13} />
                  </button>
                )}
              {taskScope === 'image-queue' && dismissibleImageTask && (
                <button
                  type="button"
                  className="smtcmp-task-card__dismiss"
                  onClick={() => void manager.dismiss(task.id)}
                  aria-label={dismissLabel}
                  title={dismissLabel}
                >
                  <X size={13} />
                </button>
              )}
              {taskScope === 'message' && dismissibleMcpTask && (
                <button
                  type="button"
                  className="smtcmp-task-card__dismiss"
                  onClick={() => void manager.dismiss(task.id)}
                  aria-label="Dismiss MCP task"
                  title="Dismiss MCP task"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {task.kind === 'mcp-tool-call' &&
              typeof task.input.displayName === 'string' && (
                <div className="smtcmp-task-card__prompt">
                  {task.input.displayName}
                  {task.input.execution === 'server-task'
                    ? ' · server task'
                    : ' · background wrapper'}
                </div>
              )}
            {taskScope === 'image-queue' && displayPrompt && (
              <div className="smtcmp-task-card__prompt" title={displayPrompt}>
                {displayPrompt}
              </div>
            )}
            {taskScope === 'image-queue' && terminalError && (
              <div className="smtcmp-task-card__error" title={terminalError}>
                {terminalError}
              </div>
            )}
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
            {artifact?.localPath && (
              <div className="smtcmp-task-card__location">
                <span title={artifact.localPath}>
                  Vault: {artifact.localPath}
                </span>
                {file instanceof TFile && (
                  <button
                    aria-label="Open generated image file"
                    onClick={() =>
                      void app.workspace.getLeaf('tab').openFile(file)
                    }
                  >
                    <FolderOpen size={13} />
                  </button>
                )}
              </div>
            )}
            {artifact?.remoteUrl && (
              <a
                className="smtcmp-task-card__remote"
                href={artifact.remoteUrl}
                target="_blank"
                rel="noreferrer"
                title={artifact.remoteUrl}
              >
                R2: {artifact.remoteUrl}
              </a>
            )}
            {task.status === 'awaiting-destination' && artifact && (
              <div className="smtcmp-task-card__actions">
                <button onClick={() => void finishLocal(task, artifact, false)}>
                  <Check size={14} /> Keep in folder
                </button>
                <button onClick={() => void finishLocal(task, artifact, true)}>
                  <Check size={14} /> Insert embed
                </button>
                <button onClick={() => void uploadR2(task, artifact)}>
                  <CloudUpload size={14} />
                  {artifact.remoteUrl ? 'Insert R2 link' : 'CMDS R2'}
                </button>
              </div>
            )}
            {legacyUnverifiedR2Insert && artifact && (
              <div className="smtcmp-task-card__actions">
                <button onClick={() => void uploadR2(task, artifact)}>
                  <CloudUpload size={14} /> Insert R2 link
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
            {task.kind === 'mcp-tool-call' &&
              task.status === 'succeeded' &&
              typeof task.input.resultText === 'string' && (
                <>
                  <div className="smtcmp-mcp-task-result">
                    {task.input.resultText.slice(0, 4000)}
                    {task.input.resultText.length > 4000
                      ? '\n\n[Preview truncated]'
                      : ''}
                  </div>
                  <div className="smtcmp-task-card__actions">
                    {onUseResult && task.input.usedResult !== true && (
                      <button
                        onClick={() =>
                          void Promise.resolve(
                            onUseResult(task, task.input.resultText as string),
                          ).then((used) => {
                            if (!used) return
                            return manager.updateInput(
                              task.id,
                              { ...task.input, usedResult: true },
                              'succeeded',
                            )
                          })
                        }
                      >
                        <Check size={14} /> Use result
                      </button>
                    )}
                    <button
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          task.input.resultText as string,
                        )
                      }
                    >
                      Copy result
                    </button>
                  </div>
                </>
              )}
            {task.status === 'waiting-connection' && (
              <div className="smtcmp-task-card__actions">
                <button onClick={() => void manager.resume(task.id)}>
                  <RotateCcw size={14} /> Reconnect and resume
                </button>
                <button onClick={() => void manager.cancel(task.id)}>
                  <Square size={14} /> Cancel task
                </button>
              </div>
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

function isTerminalTask(task: BackgroundTaskRecord): boolean {
  return ['succeeded', 'failed', 'canceled', 'interrupted'].includes(
    task.status,
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
