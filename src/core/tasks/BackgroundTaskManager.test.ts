import { App } from 'obsidian'

import {
  ArtifactRecord,
  BackgroundTaskAdapter,
  BackgroundTaskRecord,
} from '../../types/background-task'

import { BackgroundTaskManager } from './BackgroundTaskManager'

function createApp(onRead?: jest.Mock): App {
  const files = new Map<string, string>()
  const directories = new Set<string>()
  const adapter = {
    exists: jest.fn(
      async (path: string) => files.has(path) || directories.has(path),
    ),
    mkdir: jest.fn(async (path: string) => {
      directories.add(path)
    }),
    list: jest.fn(async (path: string) => ({
      files: Array.from(files.keys()).filter((file) =>
        file.startsWith(`${path}/`),
      ),
      folders: [],
    })),
    read: jest.fn(async (path: string) => {
      onRead?.(path)
      return files.get(path) ?? ''
    }),
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content)
    }),
    remove: jest.fn(async (path: string) => {
      files.delete(path)
    }),
  }
  return { vault: { adapter } } as unknown as App
}

function waitForTask(
  manager: BackgroundTaskManager,
  predicate: (task: BackgroundTaskRecord) => boolean,
): Promise<BackgroundTaskRecord> {
  const existing = manager.getTasks().find(predicate)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Timed out waiting for task state.'))
    }, 2000)
    unsubscribe = manager.subscribe((tasks) => {
      const task = tasks.find(predicate)
      if (!task) return
      clearTimeout(timeout)
      unsubscribe()
      resolve(task)
    })
  })
}

describe('BackgroundTaskManager', () => {
  it('runs an adapter and persists its terminal result', async () => {
    const manager = new BackgroundTaskManager(createApp())
    await manager.initialize()
    const adapter: BackgroundTaskAdapter = {
      kind: 'artifact-draft',
      run: async (_task, context) => {
        await context.updateProgress({
          phase: 'writing',
          message: 'Writing artifact',
        })
        return { status: 'succeeded' }
      },
    }
    manager.registerAdapter(adapter)

    const queued = await manager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'message',
      kind: 'artifact-draft',
      payload: { prompt: 'Create a canvas' },
    })
    const finished = await waitForTask(
      manager,
      (task) => task.id === queued.id && task.status === 'succeeded',
    )

    expect(finished.attempt).toBe(1)
    expect(finished.progress).toEqual({
      phase: 'writing',
      message: 'Writing artifact',
    })
  })

  it('cancels only the selected running task', async () => {
    const manager = new BackgroundTaskManager(createApp())
    await manager.initialize()
    const adapter: BackgroundTaskAdapter = {
      kind: 'artifact-draft',
      run: async (_task, context) =>
        new Promise((resolve, reject) => {
          context.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
          setTimeout(() => resolve({ status: 'succeeded' }), 100)
        }),
    }
    manager.registerAdapter(adapter)
    const first = await manager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'first',
      kind: 'artifact-draft',
      payload: {},
    })
    const second = await manager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'second',
      kind: 'artifact-draft',
      payload: {},
    })

    await manager.cancel(first.id)
    const canceled = await waitForTask(
      manager,
      (task) => task.id === first.id && task.status === 'canceled',
    )
    const succeeded = await waitForTask(
      manager,
      (task) => task.id === second.id && task.status === 'succeeded',
    )

    expect(canceled.status).toBe('canceled')
    expect(succeeded.status).toBe('succeeded')
  })

  it('updates persisted progress without changing task status', async () => {
    const manager = new BackgroundTaskManager(createApp())
    await manager.initialize()
    const task = await manager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'message',
      kind: 'image-generation',
      payload: {},
    })

    await manager.updateProgress(task.id, {
      phase: 'uploaded-awaiting-insert',
      message: 'Uploaded to R2 · select an open note to insert',
    })

    expect(
      manager.getTasks().find((item) => item.id === task.id),
    ).toMatchObject({
      status: 'queued',
      progress: {
        phase: 'uploaded-awaiting-insert',
        message: 'Uploaded to R2 · select an open note to insert',
      },
    })
  })

  it('dismisses completed image tasks and preserves the deletion', async () => {
    const app = createApp()
    const manager = new BackgroundTaskManager(app)
    await manager.initialize()
    manager.registerAdapter({
      kind: 'image-generation',
      run: async () => ({ status: 'succeeded' }),
    })

    const completed = await manager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'completed',
      kind: 'image-generation',
      payload: { prompt: 'Completed image' },
    })
    await waitForTask(
      manager,
      (task) => task.id === completed.id && task.status === 'succeeded',
    )

    expect(await manager.dismiss(completed.id)).toBe(true)
    expect(manager.getTasks().find((task) => task.id === completed.id)).toBe(
      undefined,
    )

    const reloaded = new BackgroundTaskManager(app)
    await reloaded.initialize()
    expect(reloaded.getTasks().find((task) => task.id === completed.id)).toBe(
      undefined,
    )
  })

  it('dismisses failed image tasks and preserves the deletion', async () => {
    const app = createApp()
    const manager = new BackgroundTaskManager(app)
    await manager.initialize()
    manager.registerAdapter({
      kind: 'image-generation',
      run: async () => {
        throw new Error('Image request rejected')
      },
    })

    const failed = await manager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'failed',
      kind: 'image-generation',
      payload: { prompt: 'Rejected image' },
    })
    await waitForTask(
      manager,
      (task) => task.id === failed.id && task.status === 'failed',
    )

    expect(await manager.dismiss(failed.id)).toBe(true)
    expect(manager.getTasks().find((task) => task.id === failed.id)).toBe(
      undefined,
    )

    const reloaded = new BackgroundTaskManager(app)
    await reloaded.initialize()
    expect(reloaded.getTasks().find((task) => task.id === failed.id)).toBe(
      undefined,
    )
  })

  it('clears completed images only in the selected conversation', async () => {
    const manager = new BackgroundTaskManager(createApp())
    await manager.initialize()
    manager.registerAdapter({
      kind: 'image-generation',
      run: async () => ({ status: 'succeeded' }),
    })

    const current = await manager.enqueue({
      conversationId: 'current',
      originMessageId: 'current',
      kind: 'image-generation',
      payload: {},
    })
    const other = await manager.enqueue({
      conversationId: 'other',
      originMessageId: 'other',
      kind: 'image-generation',
      payload: {},
    })
    await waitForTask(
      manager,
      (task) => task.id === current.id && task.status === 'succeeded',
    )
    await waitForTask(
      manager,
      (task) => task.id === other.id && task.status === 'succeeded',
    )

    await expect(manager.dismissCompletedImageTasks('current')).resolves.toBe(1)
    expect(manager.getTasks().map((task) => task.id)).toEqual([other.id])
  })

  it('does not dismiss an active image task', async () => {
    const manager = new BackgroundTaskManager(createApp())
    await manager.initialize()
    const queued = await manager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'queued',
      kind: 'image-generation',
      payload: {},
    })

    await expect(manager.dismiss(queued.id)).resolves.toBe(false)
    expect(
      manager.getTasks().find((task) => task.id === queued.id)?.status,
    ).toBe('queued')
  })

  it('caches artifact metadata and notifies the shared task subscriber', async () => {
    const repositoryRead = jest.fn()
    const app = createApp(repositoryRead)
    const manager = new BackgroundTaskManager(app)
    await manager.initialize()
    const subscriber = jest.fn()
    const unsubscribe = manager.subscribe(subscriber)
    subscriber.mockClear()
    const artifact: ArtifactRecord = {
      schemaVersion: 1,
      id: 'artifact',
      taskId: 'task',
      kind: 'image',
      createdAt: Date.now(),
      localPath: 'attachments/generated.png',
      mimeType: 'image/png',
    }

    await manager.saveArtifact(artifact)
    repositoryRead.mockClear()

    await expect(manager.readArtifact(artifact.id)).resolves.toEqual(artifact)
    await expect(manager.readArtifact(artifact.id)).resolves.toEqual(artifact)
    expect(repositoryRead).not.toHaveBeenCalled()
    expect(subscriber).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('restores a resumable MCP server task at the same origin', async () => {
    const app = createApp()
    const firstManager = new BackgroundTaskManager(app)
    await firstManager.initialize()
    const task = await firstManager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'origin-message',
      kind: 'mcp-tool-call',
      payload: {
        externalTaskId: 'remote-task-1',
        resumable: true,
      },
    })
    await firstManager.updateInput(task.id, task.input, 'running')
    await firstManager.cleanup()

    const reloaded = new BackgroundTaskManager(app)
    await reloaded.initialize()
    expect(reloaded.getTasks()[0]).toMatchObject({
      id: task.id,
      originMessageId: 'origin-message',
      status: 'waiting-connection',
    })

    reloaded.registerAdapter({
      kind: 'mcp-tool-call',
      run: async (restored) => ({
        status: 'succeeded',
        input: {
          ...restored.input,
          resultText: 'resumed result',
        },
      }),
    })
    const completed = await waitForTask(
      reloaded,
      (candidate) =>
        candidate.id === task.id && candidate.status === 'succeeded',
    )
    expect(completed.originMessageId).toBe('origin-message')
    expect(completed.input.resultText).toBe('resumed result')
  })

  it('does not restart a non-resumable MCP client wrapper after reload', async () => {
    const app = createApp()
    const firstManager = new BackgroundTaskManager(app)
    await firstManager.initialize()
    const task = await firstManager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'origin-message',
      kind: 'mcp-tool-call',
      payload: { resumable: false, execution: 'client-wrapper' },
    })
    await firstManager.updateInput(task.id, task.input, 'running')
    await firstManager.cleanup()

    const reloaded = new BackgroundTaskManager(app)
    await reloaded.initialize()
    const run = jest.fn()
    reloaded.registerAdapter({
      kind: 'mcp-tool-call',
      run,
    })

    expect(reloaded.getTasks()[0]).toMatchObject({
      status: 'interrupted',
      error: 'Plugin unloaded before this task completed.',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('lets a waiting MCP task be canceled and dismissed', async () => {
    const manager = new BackgroundTaskManager(createApp())
    await manager.initialize()
    const task = await manager.enqueue({
      conversationId: 'conversation',
      originMessageId: 'origin-message',
      kind: 'mcp-tool-call',
      payload: { externalTaskId: 'remote-task', resumable: true },
    })
    await manager.updateInput(task.id, task.input, 'waiting-connection')

    await manager.cancel(task.id)
    expect(manager.getTasks()[0].status).toBe('canceled')
    await expect(manager.dismiss(task.id)).resolves.toBe(true)
    expect(manager.getTasks()).toEqual([])
  })
})
