import { App } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import {
  ArtifactRecord,
  BackgroundTaskAdapter,
  BackgroundTaskKind,
  BackgroundTaskRecord,
} from '../../types/background-task'

import { TaskRepository } from './TaskRepository'

const ACTIVE_STATUSES = new Set(['queued', 'running', 'waiting-connection'])

export class BackgroundTaskManager {
  private readonly repository: TaskRepository
  private readonly tasks = new Map<string, BackgroundTaskRecord>()
  private readonly adapters = new Map<
    BackgroundTaskKind,
    BackgroundTaskAdapter
  >()
  private readonly controllers = new Map<string, AbortController>()
  private readonly runningIds = new Set<string>()
  private readonly artifactCache = new Map<string, ArtifactRecord>()
  private readonly artifactReadPromises = new Map<
    string,
    Promise<ArtifactRecord | null>
  >()
  private readonly subscribers = new Set<
    (tasks: BackgroundTaskRecord[]) => void
  >()
  private pumping = false

  constructor(app: App) {
    this.repository = new TaskRepository(app)
  }

  async initialize(): Promise<void> {
    await this.repository.initialize()
    for (const storedTask of await this.repository.listTasks()) {
      const resumableMcpTask =
        storedTask.kind === 'mcp-tool-call' &&
        typeof storedTask.input.externalTaskId === 'string' &&
        storedTask.input.resumable === true
      const task = ACTIVE_STATUSES.has(storedTask.status)
        ? {
            ...storedTask,
            schemaVersion: 3 as const,
            status: resumableMcpTask
              ? ('waiting-connection' as const)
              : ('interrupted' as const),
            updatedAt: Date.now(),
            error: resumableMcpTask
              ? undefined
              : 'Obsidian closed before this task completed.',
          }
        : {
            ...storedTask,
            schemaVersion: 3 as const,
          }
      this.tasks.set(task.id, task)
      if (task !== storedTask) await this.repository.saveTask(task)
    }
    this.emit()
  }

  registerAdapter(adapter: BackgroundTaskAdapter): () => void {
    this.adapters.set(adapter.kind, adapter)
    void this.resumeWaitingTasks(adapter.kind)
    return () => {
      if (this.adapters.get(adapter.kind) === adapter) {
        this.adapters.delete(adapter.kind)
      }
    }
  }

  subscribe(callback: (tasks: BackgroundTaskRecord[]) => void): () => void {
    this.subscribers.add(callback)
    callback(this.getTasks())
    return () => this.subscribers.delete(callback)
  }

  getTasks(conversationId?: string): BackgroundTaskRecord[] {
    return Array.from(this.tasks.values())
      .filter(
        (task) => !conversationId || task.conversationId === conversationId,
      )
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  getTask(id: string): BackgroundTaskRecord | null {
    return this.tasks.get(id) ?? null
  }

  async saveArtifact(artifact: ArtifactRecord): Promise<void> {
    await this.repository.saveArtifact(artifact)
    this.artifactCache.set(artifact.id, artifact)
    this.artifactReadPromises.delete(artifact.id)
    this.emit()
  }

  async readArtifact(id: string): Promise<ArtifactRecord | null> {
    const cached = this.artifactCache.get(id)
    if (cached) return cached

    const pending = this.artifactReadPromises.get(id)
    if (pending) return pending

    const read = this.repository.readArtifact(id).then((artifact) => {
      if (artifact) this.artifactCache.set(id, artifact)
      this.artifactReadPromises.delete(id)
      return artifact
    })
    this.artifactReadPromises.set(id, read)
    return read
  }

  async updateProgress(
    id: string,
    progress: NonNullable<BackgroundTaskRecord['progress']>,
  ): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    await this.replace({
      ...task,
      progress,
      updatedAt: Date.now(),
    })
  }

  async complete(
    id: string,
    update: Partial<Pick<BackgroundTaskRecord, 'artifactIds' | 'progress'>>,
  ): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    await this.replace({
      ...task,
      ...update,
      status: 'succeeded',
      error: undefined,
      updatedAt: Date.now(),
    })
  }

  async enqueue(input: {
    conversationId: string
    originMessageId: string
    kind: BackgroundTaskKind
    payload: Record<string, unknown>
  }): Promise<BackgroundTaskRecord> {
    const now = Date.now()
    const task: BackgroundTaskRecord = {
      schemaVersion: 3,
      id: uuidv4(),
      conversationId: input.conversationId,
      originMessageId: input.originMessageId,
      kind: input.kind,
      status: 'queued',
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      input: input.payload,
      artifactIds: [],
    }
    this.tasks.set(task.id, task)
    await this.repository.saveTask(task)
    this.emit()
    void this.pump()
    return task
  }

  async cancel(id: string): Promise<void> {
    this.controllers.get(id)?.abort()
    const task = this.tasks.get(id)
    if (!task || isTerminal(task.status)) return
    await this.replace({
      ...task,
      status: 'canceled',
      updatedAt: Date.now(),
      error: undefined,
    })
  }

  async pause(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task || !['queued', 'running'].includes(task.status)) return
    this.controllers.get(id)?.abort()
    await this.replace({
      ...task,
      status: 'paused',
      updatedAt: Date.now(),
      error: undefined,
    })
  }

  async retry(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task || !['failed', 'interrupted', 'canceled'].includes(task.status)) {
      return
    }
    await this.replace({
      ...task,
      status: 'queued',
      attempt: task.attempt + 1,
      updatedAt: Date.now(),
      progress: undefined,
      error: undefined,
    })
    void this.pump()
  }

  async resume(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (
      !task ||
      !['waiting-connection', 'paused', 'interrupted'].includes(task.status)
    ) {
      return
    }
    await this.replace({
      ...task,
      status: 'queued',
      updatedAt: Date.now(),
      error: undefined,
    })
    void this.pump()
  }

  async dismiss(id: string): Promise<boolean> {
    const task = this.tasks.get(id)
    if (
      !task ||
      !['image-generation', 'mcp-tool-call', 'document-edit'].includes(
        task.kind,
      ) ||
      (!isTerminal(task.status) && task.status !== 'review')
    ) {
      return false
    }
    await this.repository.deleteTask(id)
    this.tasks.delete(id)
    this.emit()
    return true
  }

  async dismissCompletedImageTasks(conversationId: string): Promise<number> {
    const completedIds = Array.from(this.tasks.values())
      .filter(
        (task) =>
          task.conversationId === conversationId &&
          task.kind === 'image-generation' &&
          task.status === 'succeeded',
      )
      .map((task) => task.id)
    for (const id of completedIds) {
      await this.dismiss(id)
    }
    return completedIds.length
  }

  async updateInput(
    id: string,
    input: Record<string, unknown>,
    status: BackgroundTaskRecord['status'] = 'queued',
  ): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    await this.replace({
      ...task,
      input,
      status,
      updatedAt: Date.now(),
    })
    if (status === 'queued') void this.pump()
  }

  async cleanup(): Promise<void> {
    const active = Array.from(this.tasks.values()).filter((task) =>
      ACTIVE_STATUSES.has(task.status),
    )
    this.controllers.forEach((controller) => controller.abort())
    this.controllers.clear()
    for (const task of active) {
      const resumableMcpTask =
        task.kind === 'mcp-tool-call' &&
        typeof task.input.externalTaskId === 'string' &&
        task.input.resumable === true
      await this.replace({
        ...task,
        status: resumableMcpTask ? 'waiting-connection' : 'interrupted',
        updatedAt: Date.now(),
        error: resumableMcpTask
          ? undefined
          : 'Plugin unloaded before this task completed.',
      })
    }
    this.subscribers.clear()
    this.artifactCache.clear()
    this.artifactReadPromises.clear()
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      let hasRunnableTask = true
      while (hasRunnableTask) {
        const runningImage = Array.from(this.tasks.values()).some(
          (task) =>
            task.kind === 'image-generation' &&
            (task.status === 'running' || this.runningIds.has(task.id)),
        )
        const runnable = Array.from(this.tasks.values())
          .filter((task) => {
            const adapter = this.adapters.get(task.kind)
            if (
              task.status !== 'queued' ||
              this.runningIds.has(task.id) ||
              !adapter ||
              (task.kind === 'image-generation' && runningImage)
            ) {
              return false
            }
            const runningForKind = Array.from(this.runningIds).filter(
              (id) => this.tasks.get(id)?.kind === task.kind,
            ).length
            return (
              runningForKind <
              Math.max(1, adapter.getMaxConcurrency?.() ?? Number.MAX_VALUE)
            )
          })
          .sort(
            (a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt,
          )
        const next = runnable[0]
        if (!next) {
          hasRunnableTask = false
          continue
        }
        this.runningIds.add(next.id)
        void this.runTask(next).finally(() => {
          this.runningIds.delete(next.id)
          void this.pump()
        })
      }
    } finally {
      this.pumping = false
    }
  }

  private async runTask(task: BackgroundTaskRecord): Promise<void> {
    const adapter = this.adapters.get(task.kind)
    if (!adapter) return
    const controller = new AbortController()
    this.controllers.set(task.id, controller)
    const attempt = task.attempt
    await this.replace({
      ...task,
      status: 'running',
      updatedAt: Date.now(),
      error: undefined,
    })

    try {
      if (controller.signal.aborted) return
      const result = await adapter.run(task, {
        signal: controller.signal,
        updateProgress: async (progress) => {
          const current = this.tasks.get(task.id)
          if (
            !current ||
            current.attempt !== attempt ||
            isTerminal(current.status)
          ) {
            return
          }
          await this.replace({
            ...current,
            progress,
            updatedAt: Date.now(),
          })
        },
      })
      const current = this.tasks.get(task.id)
      if (
        !current ||
        current.attempt !== attempt ||
        controller.signal.aborted ||
        isTerminal(current.status) ||
        current.status === 'paused'
      ) {
        return
      }
      await this.replace({
        ...current,
        input: result.input ?? current.input,
        status: result.status,
        artifactIds: result.artifactIds ?? current.artifactIds,
        updatedAt: Date.now(),
      })
    } catch (error) {
      const current = this.tasks.get(task.id)
      if (
        !current ||
        current.attempt !== attempt ||
        controller.signal.aborted ||
        isTerminal(current.status) ||
        current.status === 'paused'
      ) {
        return
      }
      await this.replace({
        ...current,
        status: 'failed',
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.controllers.delete(task.id)
    }
  }

  private async resumeWaitingTasks(kind: BackgroundTaskKind): Promise<void> {
    const waiting = Array.from(this.tasks.values()).filter(
      (task) => task.kind === kind && task.status === 'waiting-connection',
    )
    for (const task of waiting) {
      await this.replace({
        ...task,
        status: 'queued',
        updatedAt: Date.now(),
      })
    }
    void this.pump()
  }

  private async replace(task: BackgroundTaskRecord): Promise<void> {
    this.tasks.set(task.id, task)
    await this.repository.saveTask(task)
    this.emit()
  }

  private emit(): void {
    const tasks = this.getTasks()
    this.subscribers.forEach((subscriber) => subscriber(tasks))
  }
}

function isTerminal(status: BackgroundTaskRecord['status']): boolean {
  return ['succeeded', 'failed', 'canceled', 'interrupted'].includes(status)
}
