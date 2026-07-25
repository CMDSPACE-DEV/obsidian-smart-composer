import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'

import { useBackgroundTasks } from '../../contexts/background-tasks-context'
import { useMcp } from '../../contexts/mcp-context'
import { useSettings } from '../../contexts/settings-context'
import { InvalidToolNameException } from '../../core/mcp/exception'
import type { McpToolInfo } from '../../core/mcp/mcpManager'
import { parseToolName } from '../../core/mcp/tool-name-utils'
import { ChatToolMessage } from '../../types/chat'
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'
import { SplitButton } from '../common/SplitButton'

import { ObsidianCodeBlock } from './ObsidianMarkdown'

const STATUS_LABELS: Record<ToolCallResponseStatus, string> = {
  [ToolCallResponseStatus.PendingApproval]: 'Call',
  [ToolCallResponseStatus.Rejected]: 'Rejected',
  [ToolCallResponseStatus.Running]: 'Running',
  [ToolCallResponseStatus.Success]: 'Called',
  [ToolCallResponseStatus.Error]: 'Failed',
  [ToolCallResponseStatus.Aborted]: 'Aborted',
}

export const getToolMessageContent = (message: ChatToolMessage): string => {
  return message.toolCalls
    ?.map((toolCall) => {
      const { serverName, toolName } = (() => {
        try {
          return parseToolName(toolCall.request.name)
        } catch (error) {
          if (error instanceof InvalidToolNameException) {
            return { serverName: null, toolName: toolCall.request.name }
          }
          throw error
        }
      })()
      return [
        `${STATUS_LABELS[toolCall.response.status]} ${serverName ? `${serverName}:${toolName}` : toolName}`,
        ...(toolCall.request.arguments
          ? [`Parameters: ${toolCall.request.arguments}`]
          : []),
      ].join('\n')
    })
    .join('\n')
}

const ToolMessage = memo(function ToolMessage({
  message,
  conversationId,
  originMessageId,
  onMessageUpdate,
}: {
  message: ChatToolMessage
  conversationId: string
  originMessageId: string
  onMessageUpdate: (message: ChatToolMessage) => void
}) {
  return (
    <div className="smtcmp-toolcall-container">
      {message.toolCalls.map((toolCall, index) => (
        <div
          key={toolCall.request.id}
          className={clsx(index > 0 && 'smtcmp-toolcall-border-top')}
        >
          <ToolCallItem
            request={toolCall.request}
            response={toolCall.response}
            conversationId={conversationId}
            originMessageId={originMessageId}
            onResponseUpdate={(response) =>
              onMessageUpdate({
                ...message,
                toolCalls: message.toolCalls.map((t) =>
                  t.request.id === toolCall.request.id ? { ...t, response } : t,
                ),
              })
            }
          />
        </div>
      ))}
    </div>
  )
})

function ToolCallItem({
  request,
  response,
  conversationId,
  originMessageId,
  onResponseUpdate,
}: {
  request: ToolCallRequest
  response: ToolCallResponse
  conversationId: string
  originMessageId: string
  onResponseUpdate: (response: ToolCallResponse) => void
}) {
  const {
    handleToolCall,
    handleAllowForConversation,
    handleAllowAutoExecution,
    handleBackgroundToolCall,
    handleReject,
    handleAbort,
    toolInfo,
  } = useToolCall(request, conversationId, onResponseUpdate)

  const [isOpen, setIsOpen] = useState(
    // Open by default if the tool call requires approval
    response.status === ToolCallResponseStatus.PendingApproval,
  )

  const { serverName, toolName } = useMemo(() => {
    try {
      return parseToolName(request.name)
    } catch (error) {
      if (error instanceof InvalidToolNameException) {
        return {
          serverName: null,
          toolName: request.name,
        }
      }
      throw error
    }
  }, [request.name])
  const parameters = useMemo(() => {
    if (!request.arguments) {
      return 'No parameters'
    }
    try {
      return JSON.stringify(JSON.parse(request.arguments), null, 2)
    } catch (error) {
      return request.arguments
    }
  }, [request.arguments])

  return (
    <div className="smtcmp-toolcall">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="smtcmp-toolcall-header"
      >
        <div className="smtcmp-toolcall-header-icon">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
        <div className="smtcmp-toolcall-header-content">
          <span>{STATUS_LABELS[response.status] || 'Unknown'}</span>
          <span>&nbsp;&nbsp;</span>
          <span className="smtcmp-toolcall-header-tool-name">
            {serverName
              ? `${toolInfo?.connection.name ?? serverName}:${toolName}`
              : toolName}
          </span>
          {toolInfo && (
            <span className="smtcmp-toolcall-risk">{toolInfo.risk}</span>
          )}
        </div>
        <div className="smtcmp-toolcall-header-icon smtcmp-toolcall-header-icon--status">
          <StatusIcon status={response.status} />
        </div>
      </div>
      {isOpen && (
        <div className="smtcmp-toolcall-content">
          <div className="smtcmp-toolcall-content-section">
            <div>Parameters:</div>
            <ObsidianCodeBlock language="json" content={parameters} />
          </div>
          {response.status === ToolCallResponseStatus.Success && (
            <div className="smtcmp-toolcall-content-section">
              <div>Result:</div>
              <ObsidianCodeBlock content={response.data.text} />
            </div>
          )}
          {response.status === ToolCallResponseStatus.Error && (
            <div className="smtcmp-toolcall-content-section">
              <div>Error:</div>
              <ObsidianCodeBlock content={response.error} />
            </div>
          )}
        </div>
      )}
      {(response.status === ToolCallResponseStatus.PendingApproval ||
        response.status === ToolCallResponseStatus.Running) && (
        <div className="smtcmp-toolcall-footer">
          {response.status === ToolCallResponseStatus.PendingApproval && (
            <div className="smtcmp-toolcall-footer-actions">
              <SplitButton
                primaryText="Allow"
                onPrimaryClick={() => {
                  handleToolCall()
                  setIsOpen(false)
                }}
                menuOptions={[
                  ...(toolInfo?.risk !== 'delete'
                    ? [
                        {
                          label: 'Always allow this tool',
                          onClick: () => {
                            handleToolCall()
                            handleAllowAutoExecution()
                            setIsOpen(false)
                          },
                        },
                      ]
                    : []),
                  {
                    label: 'Allow for this chat',
                    onClick: () => {
                      handleToolCall()
                      handleAllowForConversation()
                      setIsOpen(false)
                    },
                  },
                  {
                    label: toolInfo?.supportsServerTask
                      ? 'Run in background (resumable)'
                      : 'Run in background',
                    onClick: () => {
                      handleBackgroundToolCall(originMessageId)
                      setIsOpen(false)
                    },
                  },
                ]}
              />
              <button
                onClick={() => {
                  handleReject()
                  setIsOpen(false)
                }}
              >
                Reject
              </button>
            </div>
          )}
          {response.status === ToolCallResponseStatus.Running && (
            <div className="smtcmp-toolcall-footer-actions">
              <button onClick={handleAbort}>Abort</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function useToolCall(
  request: ToolCallRequest,
  conversationId: string,
  onResponseUpdate: (response: ToolCallResponse) => void,
) {
  const { settings, setSettings } = useSettings()
  const { getMcpManager } = useMcp()
  const { manager: backgroundTaskManager } = useBackgroundTasks()
  const [toolInfo, setToolInfo] = useState<McpToolInfo | null>(null)

  useEffect(() => {
    let active = true
    void getMcpManager().then((manager) => {
      if (active) setToolInfo(manager.getToolInfo(request.name))
    })
    return () => {
      active = false
    }
  }, [getMcpManager, request.name])

  const handleToolCall = useCallback(async () => {
    const mcpManager = await getMcpManager()
    onResponseUpdate({
      status: ToolCallResponseStatus.Running,
    })
    const toolCallResponse: ToolCallResponse = await mcpManager.callTool({
      name: request.name,
      args: request.arguments,
      id: request.id,
    })
    onResponseUpdate(toolCallResponse)
  }, [request, onResponseUpdate, getMcpManager])

  const handleAllowForConversation = useCallback(async () => {
    const mcpManager = await getMcpManager()
    mcpManager.allowToolForConversation(request.name, conversationId)
  }, [request, conversationId, getMcpManager])

  const handleAllowAutoExecution = useCallback(async () => {
    const mcpManager = await getMcpManager()
    const info = mcpManager.getToolInfo(request.name)
    if (!info) {
      throw new Error('MCP tool is not available.')
    }
    if (info.risk === 'delete') {
      throw new Error('Delete tools cannot be auto-executed.')
    }
    const toolName = info.tool.name
    const connection = info.connection
    const toolOptions = { ...connection.toolOptions }
    if (!toolOptions[toolName]) {
      // If the tool is not in the toolOptions, add it with default values
      toolOptions[toolName] = {
        allowAutoExecution: false,
        disabled: false,
      }
    }
    toolOptions[toolName] = {
      ...toolOptions[toolName],
      allowAutoExecution: true,
    }

    setSettings({
      ...settings,
      mcp: {
        ...settings.mcp,
        connections: settings.mcp.connections.map((candidate) =>
          candidate.id === connection.id
            ? {
                ...candidate,
                toolOptions: toolOptions,
              }
            : candidate,
        ),
      },
    })
  }, [getMcpManager, request.name, settings, setSettings])

  const handleBackgroundToolCall = useCallback(
    async (originMessageId: string) => {
      if (!backgroundTaskManager) {
        onResponseUpdate({
          status: ToolCallResponseStatus.Error,
          error: 'Background task manager is unavailable.',
        })
        return
      }
      try {
        const mcpManager = await getMcpManager()
        const info = mcpManager.getToolInfo(request.name)
        if (!info) {
          onResponseUpdate({
            status: ToolCallResponseStatus.Error,
            error: 'MCP tool is unavailable.',
          })
          return
        }
        let args: Record<string, unknown> = {}
        if (request.arguments) {
          args = JSON.parse(request.arguments) as Record<string, unknown>
        }
        const task = await backgroundTaskManager.enqueue({
          conversationId,
          originMessageId,
          kind: 'mcp-tool-call',
          payload: {
            connectionId: info.connection.id,
            connectionName: info.connection.name,
            toolName: info.tool.name,
            arguments: args,
            displayName: `${info.connection.name}: ${info.tool.name}`,
            execution: info.supportsServerTask
              ? 'server-task'
              : 'client-wrapper',
            resumable: false,
          },
        })
        onResponseUpdate({
          status: ToolCallResponseStatus.Success,
          data: {
            type: 'text',
            text: `Background MCP task queued (${task.id}). Its result is anchored to the originating message and has not been used in this answer.`,
          },
        })
      } catch (error) {
        onResponseUpdate({
          status: ToolCallResponseStatus.Error,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [
      backgroundTaskManager,
      conversationId,
      getMcpManager,
      onResponseUpdate,
      request.arguments,
      request.name,
    ],
  )

  const handleReject = useCallback(async () => {
    onResponseUpdate({
      status: ToolCallResponseStatus.Rejected,
    })
  }, [onResponseUpdate])

  const handleAbort = useCallback(async () => {
    const mcpManager = await getMcpManager()
    mcpManager.abortToolCall(request.id)
    onResponseUpdate({
      status: ToolCallResponseStatus.Aborted,
    })
  }, [request, onResponseUpdate, getMcpManager])

  return {
    handleToolCall,
    handleAllowForConversation,
    handleAllowAutoExecution,
    handleBackgroundToolCall,
    handleReject,
    handleAbort,
    toolInfo,
  }
}

function StatusIcon({ status }: { status: ToolCallResponseStatus }) {
  switch (status) {
    case ToolCallResponseStatus.PendingApproval:
      return null
    case ToolCallResponseStatus.Rejected:
    case ToolCallResponseStatus.Aborted:
    case ToolCallResponseStatus.Error:
      return <X size={16} style={{ color: 'var(--text-error)' }} />
    case ToolCallResponseStatus.Running:
      return <Loader2 size={16} className="spinner" />
    case ToolCallResponseStatus.Success:
      return <Check size={16} style={{ color: 'var(--text-success)' }} />
    default:
      return null
  }
}

export default ToolMessage
