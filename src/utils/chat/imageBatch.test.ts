import { BackgroundTaskRecord } from '../../types/background-task'

import { enqueueImageGenerationBatch } from './imageBatch'
import { ImageGenerationRequest } from './imageIntent'

type EnqueueInput = {
  conversationId: string
  originMessageId: string
  kind: 'image-generation'
  payload: Record<string, unknown>
}

function createTask(index: number): BackgroundTaskRecord {
  return {
    schemaVersion: 1,
    id: `task-${index}`,
    kind: 'image-generation',
    status: 'queued',
    conversationId: 'conversation-1',
    originMessageId: 'message-1',
    attempt: 0,
    input: {},
    artifactIds: [],
    createdAt: index,
    updatedAt: index,
  }
}

describe('enqueueImageGenerationBatch', () => {
  const request: ImageGenerationRequest = {
    prompt: 'Draw a cat advertisement',
    count: 3,
    requestedCount: 3,
    usedPreviousPrompt: false,
  }

  it('enqueues one independently tracked task per requested image', async () => {
    const inputs: EnqueueInput[] = []
    const enqueue = jest.fn(
      async (input: EnqueueInput): Promise<BackgroundTaskRecord> => {
        inputs.push(input)
        return createTask(inputs.length)
      },
    )

    const result = await enqueueImageGenerationBatch({ enqueue }, request, {
      conversationId: 'conversation-1',
      originMessageId: 'message-1',
      sourcePrompt: 'Draw 3 cat advertisement images',
      modelId: 'gpt-5.6-sol (plan)',
    })

    expect(result).toEqual({ queuedCount: 3, total: 3 })
    expect(enqueue).toHaveBeenCalledTimes(3)
    expect(inputs.map((input) => input.payload.batchIndex)).toEqual([1, 2, 3])
    expect(inputs.map((input) => input.payload.displayPrompt)).toEqual([
      '1/3 · Draw a cat advertisement',
      '2/3 · Draw a cat advertisement',
      '3/3 · Draw a cat advertisement',
    ])
  })

  it('reports partial progress when a later task cannot be queued', async () => {
    let callCount = 0
    const enqueue = jest.fn(
      async (_input: EnqueueInput): Promise<BackgroundTaskRecord> => {
        callCount += 1
        if (callCount === 2) throw new Error('queue unavailable')
        return createTask(callCount)
      },
    )

    const result = await enqueueImageGenerationBatch({ enqueue }, request, {
      conversationId: 'conversation-1',
      originMessageId: 'message-1',
      sourcePrompt: 'Draw 3 cat advertisement images',
      modelId: 'gpt-5.6-sol (plan)',
    })

    expect(result.queuedCount).toBe(1)
    expect(result.total).toBe(3)
    expect(result.error).toEqual(new Error('queue unavailable'))
    expect(enqueue).toHaveBeenCalledTimes(2)
  })
})
