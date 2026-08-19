import type SmartComposerPlugin from '../../main'
import type {
  BackgroundTaskRecord,
  BackgroundTaskRunContext,
} from '../../types/background-task'

import { McpToolTaskAdapter } from './McpToolTaskAdapter'

function createTask(
  input: BackgroundTaskRecord['input'] = {},
): BackgroundTaskRecord {
  return {
    schemaVersion: 2,
    id: 'local-task',
    conversationId: 'conversation',
    originMessageId: 'origin-message',
    kind: 'mcp-tool-call',
    status: 'running',
    attempt: 1,
    createdAt: 1,
    updatedAt: 1,
    input: {
      connectionId: 'connection',
      toolName: 'search',
      arguments: { query: 'test' },
      ...input,
    },
    artifactIds: [],
  }
}

function createContext(): BackgroundTaskRunContext {
  return {
    signal: new AbortController().signal,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  }
}

describe('McpToolTaskAdapter', () => {
  it('preserves a newly-created remote task ID when the connection drops', async () => {
    const updateInput = jest.fn().mockResolvedValue(undefined)
    const runBackgroundTool = jest.fn(
      async ({
        onTaskCreated,
      }: {
        onTaskCreated: (id: string) => Promise<void>
      }) => {
        await onTaskCreated('remote-task-42')
        throw new Error('Network unavailable')
      },
    )
    const plugin = {
      getMcpManager: async () => ({ runBackgroundTool }),
      backgroundTaskManager: { updateInput },
    } as unknown as SmartComposerPlugin

    const result = await new McpToolTaskAdapter(plugin).run(
      createTask(),
      createContext(),
    )

    expect(updateInput).toHaveBeenCalledWith(
      'local-task',
      expect.objectContaining({
        externalTaskId: 'remote-task-42',
        resumable: true,
        execution: 'server-task',
      }),
      'running',
    )
    expect(result).toEqual({
      status: 'waiting-connection',
      input: expect.objectContaining({
        externalTaskId: 'remote-task-42',
        resumable: true,
      }),
    })
  })

  it('bounds persisted MCP result text', async () => {
    const plugin = {
      getMcpManager: async () => ({
        runBackgroundTool: async () => ({
          text: 'x'.repeat(120_010),
          resumable: false,
        }),
      }),
      backgroundTaskManager: { updateInput: jest.fn() },
    } as unknown as SmartComposerPlugin

    const result = await new McpToolTaskAdapter(plugin).run(
      createTask(),
      createContext(),
    )

    expect(result.status).toBe('succeeded')
    expect(result.input?.resultTruncated).toBe(true)
    expect(String(result.input?.resultText)).toHaveLength(
      120_000 + '\n\n[Result truncated by Smart Composer]'.length,
    )
  })
})
