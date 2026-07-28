/** @jsxImportSource @opentui/solid */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { TuiPluginApi, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { TextAttributes } from "@opentui/core"
import type { JSX, Signal } from "solid-js"
import { createSignal } from "solid-js"

// ── Types ────────────────────────────────────────────────────────────────

interface MCPServerConfig {
  type: "local" | "remote"
  command?: string[]
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
  env?: Record<string, string>
  environment?: Record<string, string>
}

interface BridgeConfig {
  servers?: string[]
  exclude?: string[]
}

// ── Config helpers ───────────────────────────────────────────────────────

function loadMCPConfigs(directory: string): Record<string, MCPServerConfig> {
  const configPaths = [
    join(homedir(), ".config", "opencode", "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.jsonc"),
    join(directory, "opencode.json"),
    join(directory, "opencode.jsonc"),
    join(directory, ".opencode", "opencode.json"),
    join(directory, ".opencode", "opencode.jsonc"),
  ]

  const merged: Record<string, MCPServerConfig> = {}
  for (const p of configPaths) {
    try {
      if (!existsSync(p)) continue
      const content = readFileSync(p, "utf-8")
      const config = JSON.parse(content)
      if (config.mcp) {
        for (const [key, val] of Object.entries(config.mcp)) {
          merged[key] = val as MCPServerConfig
        }
      }
    } catch {}
  }
  return merged
}

function loadBridgeConfig(directory: string): BridgeConfig | null {
  const paths = [
    join(directory, ".opencode", "mcp-bridge.json"),
    join(directory, "mcp-bridge.json"),
  ]
  for (const p of paths) {
    try {
      if (!existsSync(p)) continue
      const content = readFileSync(p, "utf-8")
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === "object") return parsed as BridgeConfig
    } catch {}
  }
  return null
}

function writeBridgeConfig(directory: string, config: BridgeConfig): boolean {
  try {
    const path = join(directory, ".opencode", "mcp-bridge.json")
    writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8")
    return true
  } catch {
    return false
  }
}

type Theme = TuiThemeCurrent

// ── UI Components ────────────────────────────────────────────────────────

function ServerRow(props: {
  theme: Theme
  name: string
  type: string
  enabled: boolean
  bridged: boolean
  onToggle: () => void
}) {
  const t = props.theme
  const statusColor = props.enabled ? t.success : t.textMuted
  const bridgeColor = props.bridged ? t.success : t.textMuted
  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
      <box width={30} flexDirection="row" gap={1}>
        <text fg={t.text} attributes={TextAttributes.BOLD}>
          {props.name}
        </text>
        <text fg={t.textMuted}>({props.type})</text>
      </box>
      <box width={10}>
        <text fg={statusColor}>{props.enabled ? "enabled" : "off"}</text>
      </box>
      <box
        width={14}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={props.bridged ? t.success : t.backgroundElement}
        onMouseUp={props.onToggle}
      >
        <text fg={props.bridged ? t.selectedListItemText : t.text}>
          {props.bridged ? "bridged" : "—"}
        </text>
      </box>
    </box>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────

function MBridgePanel(props: { api: TuiPluginApi; onClose: () => void }) {
  const api = props.api as any
  const directory = api.state.path.directory as string
  const theme = api.theme.current

  const mcpConfigs = loadMCPConfigs(directory)
  const [bridgeConfig, setBridgeConfig] = createSignal(loadBridgeConfig(directory))

  // Compute current bridge set
  const allServers = Object.entries(mcpConfigs).filter(([, c]) => c.type)
  const bc = bridgeConfig()

  const bridgedServers = () => {
    const b = bridgeConfig()
    if (b?.servers) {
      return new Set(b.servers.filter((name) => mcpConfigs[name] !== undefined))
    }
    return new Set(
      allServers
        .filter(([name, cfg]) => cfg.enabled !== false && !b?.exclude?.includes(name))
        .map(([name]) => name),
    )
  }

  const mode = () => {
    const b = bridgeConfig()
    if (b?.servers) return "whitelist" as const
    if (b?.exclude) return "exclude" as const
    return "all" as const
  }

  function toggleServer(name: string) {
    const current = bridgedServers()
    const newSet = new Set(current)
    if (newSet.has(name)) newSet.delete(name)
    else newSet.add(name)

    let newConfig: BridgeConfig
    if (newSet.size < allServers.length) {
      newConfig = { servers: [...newSet].sort() }
    } else {
      newConfig = {}
    }

    if (writeBridgeConfig(directory, newConfig)) {
      setBridgeConfig(newConfig)
    } else {
      api.ui.toast({
        variant: "error",
        title: "Bridge",
        message: "Cannot write .opencode/mcp-bridge.json",
      })
    }
  }

  function switchMode(newMode: "whitelist" | "exclude" | "all") {
    const current = bridgedServers()
    let newConfig: BridgeConfig
    if (newMode === "whitelist") {
      newConfig = { servers: [...current].sort() }
    } else if (newMode === "exclude") {
      const excluded = allServers.filter(([n]) => !current.has(n)).map(([n]) => n)
      newConfig = excluded.length > 0 ? { exclude: excluded } : {}
    } else {
      newConfig = {}
    }

    if (writeBridgeConfig(directory, newConfig)) {
      setBridgeConfig(newConfig)
    } else {
      api.ui.toast({
        variant: "error",
        title: "Bridge",
        message: "Cannot write .opencode/mcp-bridge.json",
      })
    }
  }

  return (
    <box paddingLeft={3} paddingRight={3} paddingBottom={1} gap={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="column">
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            MCP Bridge
          </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            MCP Server Selection
          </text>
        </box>
        <text fg={theme.textMuted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>

      <box height={1} border={["bottom"]} borderColor={theme.borderSubtle} />

      {/* Mode selector */}
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
        <text fg={theme.textMuted}>Mode:</text>
        {(["whitelist", "exclude", "all"] as const).map((m) => (
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={mode() === m ? theme.primary : theme.backgroundElement}
            onMouseUp={() => switchMode(m)}
          >
            <text
              fg={mode() === m ? theme.selectedListItemText : theme.text}
              attributes={mode() === m ? TextAttributes.BOLD : 0}
            >
              {m}
            </text>
          </box>
        ))}
      </box>

      {/* Legend */}
      <box flexDirection="row" gap={2} paddingLeft={1}>
        <text fg={theme.textMuted}>Server</text>
        <box width={10}>
          <text fg={theme.textMuted}>Status</text>
        </box>
        <box width={14}>
          <text fg={theme.textMuted}>Bridge</text>
        </box>
      </box>

      <box height={1} border={["bottom"]} borderColor={theme.borderSubtle} />

      {/* Server list */}
      {allServers.length === 0 ? (
        <text fg={theme.textMuted} paddingLeft={1}>
          No MCP servers configured.
        </text>
      ) : (
        allServers.map(([name, cfg]) => {
          const b = bridgedServers()
          return (
            <ServerRow
              theme={theme}
              name={name}
              type={cfg.type}
              enabled={cfg.enabled !== false}
              bridged={b.has(name)}
              onToggle={() => toggleServer(name)}
            />
          )
        })
      )}

      <box height={1} border={["bottom"]} borderColor={theme.borderSubtle} />

      {/* Summary */}
      <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg={theme.textMuted}>
          {bridgedServers().size} / {allServers.length} servers bridged
        </text>
        <text fg={theme.textMuted}>Restart required</text>
      </box>

      {/* Footer */}
      <box flexDirection="row" justifyContent="flex-end" gap={1} paddingTop={1}>
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={theme.backgroundElement}
          onMouseUp={props.onClose}
        >
          <text fg={theme.text}>close</text>
        </box>
      </box>
    </box>
  )
}

function openPanel(api: any) {
  api.ui.dialog.setSize("large")
  api.ui.dialog.replace(() => <MBridgePanel api={api} onClose={() => api.ui.dialog.clear()} />)
}

// ── TUI Plugin Entry ─────────────────────────────────────────────────────

const tui: TuiPluginModule["tui"] = async (api) => {
  api.command?.register(() => [
    {
      title: "MCP Bridge Panel",
      value: "mcp-bridge.panel",
      description: "Configure which MCP servers are bridged to subagents",
      category: "MCP Bridge",
      slash: { name: "omb", aliases: ["mcp-bridge"] },
      onSelect: () => openPanel(api),
    },
  ])
}

export default {
  id: "opencode-mcp-bridge",
  tui,
} satisfies TuiPluginModule
