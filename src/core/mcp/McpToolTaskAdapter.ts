import type SmartComposerPlugin from '../../main'
import type {
  BackgroundTaskAdapter,
  BackgroundTaskRecord,
  BackgroundTaskRunContext,
  BackgroundTaskRunResult,
} from '../../types/background-task'

const MAX_STORED_RESULT_CHARACTERS = 120_000

export class McpToolTaskAdapter implements BackgroundTaskAdapter {
  readonly kind = 'mcp-tool-call' as const

  constructor(private readonly plugin: SmartComposerPlugin) {}

  async run(
    task: BackgroundTaskRecord,
    context: BackgroundTaskRunContext,
  ): Promise<BackgroundTaskRunResult> {
    const connectionId = getString(task.input.connectionId)
    const toolName = getString(task.input.toolName)
    if (!connectionId || !toolName) {
      throw new Error('MCP background task metadata is incomplete.')
    }
    const args =
      task.input.arguments &&
      typeof task.input.arguments === 'object' &&
      !Array.isArray(task.input.arguments)
        ? (task.input.arguments as Record<string, unknown>)
        : {}
    const externalTaskId = getString(task.input.externalTaskId)
    let currentExternalTaskId = externalTaskId
    const manager = await this.plugin.getMcpManager()

    try {
      const result = await manager.runBackgroundTool({
        connectionId,
        toolName,
        args,
        externalTaskId,
        signal: context.signal,
        onTaskCreated: async (taskId) => {
          currentExternalTaskId = taskId
          await this.plugin.backgroundTaskManager?.updateInput(
            task.id,
            {
              ...task.input,
              externalTaskId: taskId,
              resumable: true,
              execution: 'server-task',
            },
            'running',
          )
        },
        onProgress: async (message) => {
          await context.updateProgress({
            phase: 'mcp-running',
            message,
          })
        },
      })
      const resultText =
        result.text.length > MAX_STORED_RESULT_CHARACTERS
          ? `${result.text.slice(0, MAX_STORED_RESULT_CHARACTERS)}\n\n[Result truncated by Smart Composer]`
          : result.text
      return {
        status: 'succeeded',
        input: {
          ...task.input,
          externalTaskId: result.externalTaskId ?? currentExternalTaskId,
          resumable: result.resumable,
          execution: result.resumable ? 'server-task' : 'client-wrapper',
          resultText,
          resultTruncated: result.text.length > MAX_STORED_RESULT_CHARACTERS,
          usedResult: false,
        },
      }
    } catch (error) {
      if (context.signal.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (
        currentExternalTaskId &&
        /(authentication|connect|network|fetch|offline|unavailable)/i.test(
          message,
        )
      ) {
        return {
          status: 'waiting-connection',
          input: {
            ...task.input,
            externalTaskId: currentExternalTaskId,
            resumable: true,
          },
        }
      }
      throw error
    }
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
