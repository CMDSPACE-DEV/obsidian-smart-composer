import { App } from 'obsidian'

import {
  BackgroundTaskAdapter,
  BackgroundTaskRecord,
} from '../../types/background-task'

import { BackgroundTaskManager } from './BackgroundTaskManager'

function createApp(): App {
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
    read: jest.fn(async (path: string) => files.get(path) ?? ''),
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content)
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
})
