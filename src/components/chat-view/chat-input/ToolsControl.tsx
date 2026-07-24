import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Settings2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { useApp } from '../../../contexts/app-context'
import { useDialogContainer } from '../../../contexts/dialog-container-context'
import { useMcp } from '../../../contexts/mcp-context'
import { usePlugin } from '../../../contexts/plugin-context'
import { useSettings } from '../../../contexts/settings-context'
import type { McpManager } from '../../../core/mcp/mcpManager'

export function ToolsControl() {
  const app = useApp()
  const plugin = usePlugin()
  const dialogContainer = useDialogContainer()
  const { getMcpManager } = useMcp()
  const { settings, setSettings } = useSettings()
  const [open, setOpen] = useState(false)
  const [manager, setManager] = useState<McpManager | null>(null)
  const [toolCount, setToolCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const refreshToolCount = useCallback(async (mcpManager: McpManager) => {
    const tools = await mcpManager.listAvailableTools()
    setToolCount(tools.length)
  }, [])

  useEffect(() => {
    if (!open || manager || loading) return

    let active = true
    setLoading(true)
    void getMcpManager()
      .then(async (mcpManager) => {
        if (!active) return
        setManager(mcpManager)
        await refreshToolCount(mcpManager)
      })
      .catch((error) => {
        console.error('Failed to load MCP tools', error)
        if (active) setToolCount(0)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [getMcpManager, loading, manager, open, refreshToolCount])

  useEffect(() => {
    if (!manager) return
    const unsubscribe = manager.subscribeServersChange(() => {
      void refreshToolCount(manager)
    })
    return () => {
      unsubscribe()
    }
  }, [manager, refreshToolCount])

  const toolsEnabled = settings.chatOptions.enableTools
  const countLabel =
    toolCount === null
      ? loading
        ? 'Loading available tools'
        : 'Tool count loads when opened'
      : `${toolCount} tool${toolCount === 1 ? '' : 's'} available`

  const handleToggle = () => {
    void setSettings({
      ...settings,
      chatOptions: {
        ...settings.chatOptions,
        enableTools: !toolsEnabled,
      },
    })
  }

  const handleManage = async () => {
    setOpen(false)
    const { McpSectionModal } = await import('../../modals/McpSectionModal')
    new McpSectionModal(app, plugin).open()
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="smtcmp-chat-icon-button"
              aria-label="Tools and MCP settings"
              aria-pressed={toolsEnabled}
              aria-expanded={open}
              data-active={String(toolsEnabled)}
            >
              <Wrench size={16} aria-hidden="true" />
            </button>
          </Popover.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal container={dialogContainer}>
          <Tooltip.Content
            className="smtcmp-tooltip-content smtcmp-chat-control-tooltip"
            sideOffset={7}
          >
            Tools and MCP settings
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Popover.Portal container={dialogContainer}>
        <Popover.Content
          className="smtcmp-popover smtcmp-tools-control-popover"
          side="top"
          align="end"
          sideOffset={8}
        >
          <button
            type="button"
            role="switch"
            aria-checked={toolsEnabled}
            className="smtcmp-tools-control-popover__toggle"
            onClick={handleToggle}
          >
            <span className="smtcmp-tools-control-popover__copy">
              <strong>Use MCP tools</strong>
              <small>{countLabel}</small>
            </span>
            <span
              className="smtcmp-tools-control-popover__switch"
              data-checked={String(toolsEnabled)}
              aria-hidden="true"
            >
              <span />
            </span>
          </button>
          <button
            type="button"
            className="smtcmp-tools-control-popover__manage"
            onClick={() => void handleManage()}
          >
            <Settings2 size={14} aria-hidden="true" />
            <span>Manage MCP servers</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
