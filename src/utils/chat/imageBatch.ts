import { BackgroundTaskRecord } from '../../types/background-task'

import {
  ImageGenerationRequest,
  buildImageGenerationPrompts,
} from './imageIntent'

type ImageTaskEnqueuer = {
  enqueue(input: {
    conversationId: string
    originMessageId: string
    kind: 'image-generation'
    payload: Record<string, unknown>
  }): Promise<BackgroundTaskRecord>
}

export type ImageBatchEnqueueResult = {
  queuedCount: number
  total: number
  error?: unknown
}

export async function enqueueImageGenerationBatch(
  manager: ImageTaskEnqueuer,
  request: ImageGenerationRequest,
  context: {
    conversationId: string
    originMessageId: string
    sourcePrompt: string
    modelId: string
    targetFilePath?: string
  },
): Promise<ImageBatchEnqueueResult> {
  const prompts = buildImageGenerationPrompts(request)
  let queuedCount = 0

  for (const [index, prompt] of prompts.entries()) {
    try {
      await manager.enqueue({
        conversationId: context.conversationId,
        originMessageId: context.originMessageId,
        kind: 'image-generation',
        payload: {
          prompt,
          displayPrompt:
            prompts.length > 1
              ? `${index + 1}/${prompts.length} · ${request.prompt}`
              : request.prompt,
          batchBasePrompt: request.prompt,
          batchIndex: index + 1,
          batchTotal: prompts.length,
          sourcePrompt: context.sourcePrompt,
          modelId: context.modelId,
          targetFilePath: context.targetFilePath,
        },
      })
      queuedCount += 1
    } catch (error) {
      return {
        queuedCount,
        total: prompts.length,
        error,
      }
    }
  }

  return {
    queuedCount,
    total: prompts.length,
  }
}
