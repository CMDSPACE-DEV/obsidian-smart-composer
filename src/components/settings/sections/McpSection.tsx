import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleMinus,
  Edit,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { App, Notice } from 'obsidian'
import { useCallback, useEffect, useState } from 'react'

import { useSettings } from '../../../contexts/settings-context'
import type { McpManager } from '../../../core/mcp/mcpManager'
import {
  McpSecretStore,
  clearUnusedMcpConnectionSecrets,
} from '../../../core/mcp/McpSecretStore'
import SmartComposerPlugin from '../../../main'
import type {
  McpRoutingMode,
  McpServerState,
  McpTool,
  McpToolRisk,
} from '../../../types/mcp.types'
import { McpServerStatus } from '../../../types/mcp.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianToggle } from '../../common/ObsidianToggle'
import { ConfirmModal } from '../../modals/ConfirmModal'
import {
  AddMcpServerModal,
  EditMcpServerModal,
} from '../modals/McpServerFormModal'

type McpSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function McpSection({ app, plugin }: McpSectionProps) {
  const { settings, setSettings } = useSettings()
  const [manager, setManager] = useState<McpManager | null>(null)
  const [connections, setConnections] = useState<McpServerState[]>([])

  useEffect(() => {
    void plugin.getMcpManager().then((loaded) => {
      setManager(loaded)
      setConnections(loaded.getServers())
    })
  }, [plugin])

  useEffect(() => {
    if (!manager) return
    return manager.subscribeServersChange(setConnections)
  }, [manager])

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">MCP connections</div>
      <div className="smtcmp-settings-desc smtcmp-settings-callout">
        Connect external apps and tools by URL. Tool schemas must be reviewed
        before they are exposed to the model. Results are sent to the current
        chat model, so large outputs can increase usage.
      </div>

      <ObsidianSetting
        name="Tool routing"
        desc="Auto selects a small relevant set. On demand exposes tools only after @Connection or local search."
      >
        <ObsidianDropdown
          value={settings.mcp.routingMode}
          options={{
            auto: 'Auto',
            always: 'Always include reviewed tools',
            'on-demand': 'On demand',
            off: 'Off',
          }}
          onChange={(value) =>
            void setSettings({
              ...settings,
              mcp: {
                ...settings.mcp,
                routingMode: value as McpRoutingMode,
              },
            })
          }
        />
      </ObsidianSetting>

      {!manager ? (
        <div className="smtcmp-settings-sub-header-container">
          <div className="smtcmp-settings-sub-header">
            Loading MCP connections...
          </div>
        </div>
      ) : manager.disabled ? (
        <div className="smtcmp-settings-sub-header-container">
          <div className="smtcmp-settings-sub-header">
            MCP connections are available on desktop only.
          </div>
        </div>
      ) : (
        <>
          <div className="smtcmp-settings-sub-header-container">
            <div className="smtcmp-settings-sub-header">Connections</div>
            <ObsidianButton
              text="Add connection"
              onClick={() => new AddMcpServerModal(app, plugin).open()}
            />
          </div>
          <div className="smtcmp-mcp-servers-container">
            <div className="smtcmp-mcp-servers-header">
              <div>Connection</div>
              <div>Status</div>
              <div>Enabled</div>
              <div>Actions</div>
            </div>
            {connections.length ? (
              connections.map((connection) => (
                <McpConnectionRow
                  key={connection.config.id}
                  app={app}
                  plugin={plugin}
                  manager={manager}
                  server={connection}
                />
              ))
            ) : (
              <div className="smtcmp-mcp-servers-empty">
                No MCP connections yet
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function McpConnectionRow({
  server,
  app,
  plugin,
  manager,
}: {
  server: McpServerState
  app: App
  plugin: SmartComposerPlugin
  manager: McpManager
}) {
  const { settings, setSettings } = useSettings()
  const [open, setOpen] = useState(
    server.status === McpServerStatus.ReviewRequired ||
      server.status === McpServerStatus.Error,
  )
  const [busy, setBusy] = useState(false)

  const updateEnabled = useCallback(
    (enabled: boolean) =>
      void setSettings({
        ...settings,
        mcp: {
          ...settings.mcp,
          connections: settings.mcp.connections.map((connection) =>
            connection.id === server.config.id
              ? { ...connection, enabled }
              : connection,
          ),
        },
      }),
    [server.config.id, setSettings, settings],
  )

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await operation()
      setOpen(true)
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = () => {
    new ConfirmModal(app, {
      title: 'Delete MCP connection',
      message: `Delete "${server.config.name}"? Stored credentials will no longer be used.`,
      ctaText: 'Delete',
      onConfirm: async () => {
        await setSettings({
          ...settings,
          mcp: {
            ...settings.mcp,
            connections: settings.mcp.connections.filter(
              (connection) => connection.id !== server.config.id,
            ),
          },
        })
        clearUnusedMcpConnectionSecrets(new McpSecretStore(app), server.config)
      },
    }).open()
  }

  const handleDisconnect = () => {
    const clearCredentials = server.config.auth.mode !== 'none'
    if (!clearCredentials) {
      void run(() => manager.disconnectConnection(server.config.id))
      return
    }
    new ConfirmModal(app, {
      title: 'Disconnect MCP connection',
      message: `Disconnect "${server.config.name}" and remove its stored session credentials from this device?`,
      ctaText: 'Disconnect',
      onConfirm: () =>
        run(() =>
          manager.disconnectConnection(server.config.id, {
            clearCredentials: true,
          }),
        ),
    }).open()
  }

  return (
    <div className="smtcmp-mcp-server">
      <div className="smtcmp-mcp-server-row">
        <div>
          <div className="smtcmp-mcp-server-name">{server.config.name}</div>
          <div className="smtcmp-mcp-tool-description">
            {server.config.transport.type === 'streamable-http'
              ? 'Remote URL'
              : 'Local command'}
          </div>
        </div>
        <div className="smtcmp-mcp-server-status">
          <McpServerStatusBadge status={server.status} />
        </div>
        <div className="smtcmp-mcp-server-toggle">
          <ObsidianToggle
            value={server.config.enabled}
            onChange={updateEnabled}
          />
        </div>
        <div className="smtcmp-mcp-server-actions">
          {server.status === McpServerStatus.AuthenticationRequired && (
            <button
              className="clickable-icon"
              aria-label={
                server.config.auth.mode === 'automatic' ||
                server.config.auth.mode === 'oauth-client'
                  ? 'Authenticate'
                  : 'Edit credentials'
              }
              disabled={busy}
              onClick={() => {
                if (
                  server.config.auth.mode === 'automatic' ||
                  server.config.auth.mode === 'oauth-client'
                ) {
                  void run(() => manager.connectAndAuthorize(server.config.id))
                  return
                }
                new EditMcpServerModal(app, plugin, server.config.id).open()
              }}
            >
              <KeyRound size={16} />
            </button>
          )}
          <button
            className="clickable-icon"
            aria-label="Connect and scan tools"
            disabled={busy || !server.config.enabled}
            onClick={() =>
              void run(() => manager.scanConnection(server.config.id))
            }
          >
            <RefreshCw size={16} className={busy ? 'spinner' : ''} />
          </button>
          {(server.status === McpServerStatus.Connected ||
            server.status === McpServerStatus.ReviewRequired) && (
            <button
              className="clickable-icon"
              aria-label="Disconnect"
              disabled={busy}
              onClick={handleDisconnect}
            >
              <LogOut size={16} />
            </button>
          )}
          <button
            className="clickable-icon"
            aria-label="Edit connection"
            onClick={() =>
              new EditMcpServerModal(app, plugin, server.config.id).open()
            }
          >
            <Edit size={16} />
          </button>
          <button
            className="clickable-icon"
            aria-label="Delete connection"
            onClick={handleDelete}
          >
            <Trash2 size={16} />
          </button>
          <button
            className="clickable-icon"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>
      {open && (
        <ExpandedConnection
          server={server}
          manager={manager}
          busy={busy}
          run={run}
        />
      )}
    </div>
  )
}

function ExpandedConnection({
  server,
  manager,
  busy,
  run,
}: {
  server: McpServerState
  manager: McpManager
  busy: boolean
  run: (operation: () => Promise<unknown>) => Promise<void>
}) {
  if (server.status === McpServerStatus.Error) {
    return (
      <div className="smtcmp-server-expanded-info">
        <div className="smtcmp-server-expanded-info-header">Error</div>
        <div className="smtcmp-server-error-message">
          {server.error.message}
        </div>
      </div>
    )
  }
  if (
    server.status !== McpServerStatus.Connected &&
    server.status !== McpServerStatus.ReviewRequired
  ) {
    return (
      <div className="smtcmp-server-expanded-info">
        Connect and scan to inspect this connection&apos;s tools.
      </div>
    )
  }
  return (
    <div className="smtcmp-server-expanded-info">
      <div className="smtcmp-server-expanded-info-header">
        Tools ({server.tools.length})
      </div>
      {server.status === McpServerStatus.ReviewRequired && (
        <div className="smtcmp-settings-callout">
          Tool schemas are new or changed. Review the list, then approve the
          current snapshot.
          <ObsidianButton
            text={busy ? 'Approving...' : 'Approve current schemas'}
            cta
            disabled={busy}
            onClick={() =>
              void run(() => manager.approveToolSnapshot(server.config.id))
            }
          />
        </div>
      )}
      <div className="smtcmp-server-tools-container">
        {server.tools.map((tool) => (
          <McpToolRow key={tool.name} tool={tool} server={server} />
        ))}
      </div>
    </div>
  )
}

function McpServerStatusBadge({ status }: { status: McpServerStatus }) {
  const config: Record<
    McpServerStatus,
    { icon: React.ReactNode; label: string; statusClass: string }
  > = {
    [McpServerStatus.Connected]: {
      icon: <Check size={16} />,
      label: 'Ready',
      statusClass: 'smtcmp-mcp-server-status-badge--connected',
    },
    [McpServerStatus.Connecting]: {
      icon: <Loader2 size={16} className="spinner" />,
      label: 'Connecting',
      statusClass: 'smtcmp-mcp-server-status-badge--connecting',
    },
    [McpServerStatus.AuthenticationRequired]: {
      icon: <KeyRound size={15} />,
      label: 'Sign in',
      statusClass: 'smtcmp-mcp-server-status-badge--connecting',
    },
    [McpServerStatus.ReviewRequired]: {
      icon: <ShieldCheck size={15} />,
      label: 'Review tools',
      statusClass: 'smtcmp-mcp-server-status-badge--connecting',
    },
    [McpServerStatus.Error]: {
      icon: <X size={16} />,
      label: 'Error',
      statusClass: 'smtcmp-mcp-server-status-badge--error',
    },
    [McpServerStatus.Disconnected]: {
      icon: <CircleMinus size={14} />,
      label: 'Not scanned',
      statusClass: 'smtcmp-mcp-server-status-badge--disconnected',
    },
  }
  const selected = config[status]
  return (
    <div className={`smtcmp-mcp-server-status-badge ${selected.statusClass}`}>
      {selected.icon}
      <div className="smtcmp-mcp-server-status-badge-label">
        {selected.label}
      </div>
    </div>
  )
}

function McpToolRow({
  tool,
  server,
}: {
  tool: McpTool
  server: Extract<
    McpServerState,
    {
      status: McpServerStatus.Connected | McpServerStatus.ReviewRequired
    }
  >
}) {
  const { settings, setSettings } = useSettings()
  const option = server.config.toolOptions[tool.name] ?? {}
  const updateOption = (values: {
    disabled?: boolean
    allowAutoExecution?: boolean
    risk?: McpToolRisk
  }) => {
    void setSettings({
      ...settings,
      mcp: {
        ...settings.mcp,
        connections: settings.mcp.connections.map((connection) =>
          connection.id === server.config.id
            ? {
                ...connection,
                toolOptions: {
                  ...connection.toolOptions,
                  [tool.name]: {
                    ...connection.toolOptions[tool.name],
                    ...values,
                  },
                },
              }
            : connection,
        ),
      },
    })
  }
  const risk = option.risk ?? 'unknown'
  return (
    <div className="smtcmp-mcp-tool">
      <div className="smtcmp-mcp-tool-info">
        <div className="smtcmp-mcp-tool-name">{tool.name}</div>
        <div className="smtcmp-mcp-tool-description">{tool.description}</div>
      </div>
      <div className="smtcmp-mcp-tool-toggle">
        <span className="smtcmp-mcp-tool-toggle-label">Risk</span>
        <ObsidianDropdown
          value={risk}
          options={{
            read: 'Read',
            write: 'Write',
            delete: 'Delete',
            unknown: 'Unknown',
          }}
          onChange={(value) => updateOption({ risk: value as McpToolRisk })}
        />
      </div>
      <div className="smtcmp-mcp-tool-toggle">
        <span className="smtcmp-mcp-tool-toggle-label">Enabled</span>
        <ObsidianToggle
          value={!option.disabled}
          onChange={(enabled) => updateOption({ disabled: !enabled })}
        />
      </div>
      <div className="smtcmp-mcp-tool-toggle">
        <span className="smtcmp-mcp-tool-toggle-label">
          {risk === 'delete' && <TriangleAlert size={13} />} Auto
        </span>
        <ObsidianToggle
          value={
            risk === 'delete' ? false : (option.allowAutoExecution ?? false)
          }
          disabled={risk === 'delete'}
          onChange={(allowAutoExecution) =>
            updateOption({ allowAutoExecution })
          }
        />
      </div>
    </div>
  )
}
