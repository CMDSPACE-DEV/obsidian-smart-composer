import { BackgroundTaskRecord } from '../../types/background-task'

const PORTABLE_IMAGE_STATUSES = new Set<BackgroundTaskRecord['status']>([
  'queued',
  'running',
  'awaiting-destination',
  'failed',
  'interrupted',
])

export type ImageQueueSummary = {
  total: number
  running: number
  queued: number
  ready: number
  completed: number
  failed: number
}

export function selectVisibleImageTasks(
  tasks: BackgroundTaskRecord[],
  currentConversationId: string,
): BackgroundTaskRecord[] {
  return tasks
    .filter(
      (task) =>
        task.kind === 'image-generation' &&
        (task.conversationId === currentConversationId ||
          PORTABLE_IMAGE_STATUSES.has(task.status)),
    )
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function summarizeImageQueue(
  tasks: BackgroundTaskRecord[],
): ImageQueueSummary {
  return {
    total: tasks.length,
    running: tasks.filter((task) => task.status === 'running').length,
    queued: tasks.filter((task) => task.status === 'queued').length,
    ready: tasks.filter((task) => task.status === 'awaiting-destination')
      .length,
    completed: tasks.filter((task) => task.status === 'succeeded').length,
    failed: tasks.filter((task) =>
      ['failed', 'interrupted'].includes(task.status),
    ).length,
  }
}
