import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Settings2, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useApp } from '../../../contexts/app-context'
import { useDialogContainer } from '../../../contexts/dialog-container-context'
import { usePlugin } from '../../../contexts/plugin-context'
import { useSettings } from '../../../contexts/settings-context'
import type { McpRoutingMode } from '../../../types/mcp.types'

export function ToolsControl() {
  const app = useApp()
  const plugin = usePlugin()
  const dialogContainer = useDialogContainer()
  const { settings, setSettings } = useSettings()
  const [open, setOpen] = useState(false)
  const toolCount = useMemo(
    () =>
      settings.mcp.connections
        .filter((connection) => connection.enabled)
        .reduce(
          (count, connection) =>
            count +
            (connection.toolSnapshot?.tools.filter(
              (tool) =>
                !connection.toolOptions[tool.name]?.disabled &&
                connection.toolOptions[tool.name]?.reviewedSchemaHash ===
                  tool.schemaHash,
            ).length ?? 0),
          0,
        ),
    [settings.mcp.connections],
  )

  const toolsEnabled =
    settings.chatOptions.enableTools && settings.mcp.routingMode !== 'off'
  const countLabel = `${toolCount} reviewed tool${toolCount === 1 ? '' : 's'}`

  const handleToggle = () => {
    void setSettings({
      ...settings,
      chatOptions: {
        ...settings.chatOptions,
        enableTools: !toolsEnabled,
      },
      mcp: {
        ...settings.mcp,
        routingMode: toolsEnabled
          ? 'off'
          : settings.mcp.routingMode === 'off'
            ? 'auto'
            : settings.mcp.routingMode,
      },
    })
  }

  const setRoutingMode = (routingMode: McpRoutingMode) => {
    void setSettings({
      ...settings,
      chatOptions: {
        ...settings.chatOptions,
        enableTools: routingMode !== 'off',
      },
      mcp: {
        ...settings.mcp,
        routingMode,
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
          <div
            className="smtcmp-tools-control-popover__modes"
            role="radiogroup"
            aria-label="MCP tool routing"
          >
            {(
              [
                ['auto', 'Auto'],
                ['always', 'Always'],
                ['on-demand', 'On demand'],
                ['off', 'Off'],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                role="radio"
                aria-checked={settings.mcp.routingMode === value}
                data-active={String(settings.mcp.routingMode === value)}
                key={value}
                onClick={() => setRoutingMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="smtcmp-tools-control-popover__manage"
            onClick={() => void handleManage()}
          >
            <Settings2 size={14} aria-hidden="true" />
            <span>Manage connections</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
