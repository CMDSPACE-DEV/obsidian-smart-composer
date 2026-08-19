import { BackgroundTaskRecord } from '../../types/background-task'

import { selectVisibleImageTasks, summarizeImageQueue } from './imageQueue'

function task(
  id: string,
  status: BackgroundTaskRecord['status'],
  conversationId = 'current',
  kind: BackgroundTaskRecord['kind'] = 'image-generation',
): BackgroundTaskRecord {
  return {
    schemaVersion: 1,
    id,
    conversationId,
    originMessageId: `message-${id}`,
    kind,
    status,
    attempt: 1,
    createdAt: Number(id.replace(/\D/g, '')) || 1,
    updatedAt: 1,
    input: {},
    artifactIds: [],
  }
}

describe('image queue', () => {
  it('keeps current history and portable work from other conversations', () => {
    const visible = selectVisibleImageTasks(
      [
        task('1', 'succeeded'),
        task('2', 'running', 'other'),
        task('3', 'awaiting-destination', 'other'),
        task('4', 'succeeded', 'other'),
        task('5', 'running', 'current', 'artifact-draft'),
      ],
      'current',
    )

    expect(visible.map((item) => item.id)).toEqual(['1', '2', '3'])
  })

  it('summarizes actionable and completed task states', () => {
    expect(
      summarizeImageQueue([
        task('1', 'running'),
        task('2', 'queued'),
        task('3', 'awaiting-destination'),
        task('4', 'succeeded'),
        task('5', 'failed'),
        task('6', 'interrupted'),
      ]),
    ).toEqual({
      total: 6,
      running: 1,
      queued: 1,
      ready: 1,
      completed: 1,
      failed: 2,
    })
  })
})
