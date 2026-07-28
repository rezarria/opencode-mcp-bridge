# opencode-mcp-bridge

OpenCode plugin that bridges MCP server tools into subagents (which cannot call MCP tools directly).

## Problem

OpenCode's subagents can only use a fixed set of built-in tools (`bash`, `read`,
`edit`, `grep`, `glob`, `task`, etc.). MCP server tools — like
`codebase-memory-mcp`, `firecrawl`, `playwright` — are **not available** to
subagents, even though they are configured in `opencode.json`.

## Solution

This plugin connects to every enabled MCP server, discovers their tools via
`tools/list`, and registers each one as an OpenCode tool with the name
`mcp__<server>__<tool_name>`. Tools registered through the plugin's hooks are
available to **all agents** (primary and subagent), subject to permission rules.

## Installation

This package provides **two** plugins that must be installed separately:

### 1. Server plugin (registers `mcp__*` tools)

```bash
npm install @rezarria/opencode-mcp-bridge
```

Then add it to your `opencode.json`:

```json
{
  "plugin": ["@rezarria/opencode-mcp-bridge"]
}
```

### 2. TUI plugin (provides `/omb` command)

```bash
opencode plugin @rezarria/opencode-mcp-bridge -g -f
```

This registers the `/omb` panel in `~/.config/opencode/tui.json`. The TUI panel
lets you toggle which MCP servers are bridged without editing config files.

> **Note:** Adding the server plugin to `opencode.json` alone does **not** enable
> the `/omb` command. The TUI plugin must be registered separately via the CLI
> command above.

Restart OpenCode after making these changes.

## Usage

### Calling bridged tools

Subagents call bridged MCP tools using the `mcp__<server>__<tool>` naming convention:

| MCP Server | OpenCode Tool Name |
|---|---|
| `codebase-memory-mcp` | `mcp__codebase_memory_mcp__search_graph` |
| `codebase-memory-mcp` | `mcp__codebase_memory_mcp__trace_path` |
| `firecrawl` | `mcp__firecrawl__firecrawl_scrape` |
| `playwright` | `mcp__playwright__browser_navigate` |

### Subagent permissions

Subagents need `"*": "allow"` (or explicit `mcp__*` rules) in their agent config.
Without this, all bridged tools are denied by default.

```yaml
# .opencode/agents/explore.md
---
description: Code explorer with MCP access.
mode: subagent
permission:
  "*": allow
  edit: deny
---
```

Debug tool visibility with:

```bash
opencode debug agent <name>
```

### Controlling which servers are bridged

Create `.opencode/mcp-bridge.json` in your project:

```json
{
  "servers": ["codebase-memory-mcp", "firecrawl"]
}
```

Or use exclude mode:

```json
{
  "exclude": ["tavily-search"]
}
```

If no bridge config file exists, all enabled MCP servers are bridged.

You can also use the `/omb` TUI panel to toggle servers interactively.

## How It Works

1. **On plugin load**, the plugin reads MCP server configurations from all
   reachable `opencode.json` files (global + project, merged).
2. **Bridge config** (`.opencode/mcp-bridge.json`) is loaded to determine which
   servers are selected for bridging.
3. For each selected MCP server, the plugin spawns a child process (local) or
   connects via HTTP (remote) and calls `tools/list`.
4. Each discovered MCP tool is registered as an OpenCode tool with:
   - **Name**: `mcp__<normalized_server>__<tool_name>` (hyphens → underscores)
   - **Args**: converted from MCP JSON Schema to Zod schemas
   - **Execute**: proxies JSON-RPC `tools/call` to the MCP server
5. The subagent's permission system filters which `mcp__*` tools are callable
   based on the agent's `permission` rules.

> **Important:** Each MCP server runs **twice** — once for OpenCode's native MCP
> system (primary agent) and once for the bridge plugin (subagents). These are
> separate processes.

## Architecture

```
src/
├── index.ts          # Package entry — re-exports plugin + types
├── plugin.ts         # Plugin entry point — connects servers, registers tools
├── config.ts         # Config loader — reads MCP configs from opencode.json
├── bridge-config.ts  # Bridge config loader — reads .opencode/mcp-bridge.json
├── env-resolver.ts   # Resolves {env:VAR} / {file:path} placeholders in config
├── local-client.ts   # LocalMCPClient — JSON-RPC over stdio (newline-delimited JSON)
├── remote-client.ts  # RemoteMCPClient — JSON-RPC over HTTP POST
├── types.ts          # Shared type definitions
└── tui.tsx           # TUI panel for /omb command
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/omb` not showing | TUI plugin not registered | `opencode plugin @rezarria/opencode-mcp-bridge -g -f` |
| Subagent can't see `mcp__*` tools | Missing `"*": allow` in agent permission | Add to agent config |
| Clicking toggle in `/omb` shows "Cannot write" | `.opencode` directory missing | `mkdir -p .opencode` (fixed in v1.2.3+) |
| Code changes not taking effect | OpenCode cache | `rm -rf ~/.cache/opencode/packages/@rezarria/opencode-mcp-bridge@latest` and reinstall |
| "Failed to connect" for a server | Missing env vars or server not found | Check `env`/`environment` in MCP config |
| Remote server fails | Streamable HTTP not supported | Only plain HTTP POST servers work |

## Limitations

- **Remote MCP servers** using Streamable HTTP (SSE) are not supported.
  The remote client uses plain HTTP POST, which fails for servers requiring
  session-based streaming (e.g., context7, tavily-search).
- **Startup latency**: the plugin connects to all bridged MCP servers during
  initialization, which can delay OpenCode startup.
- **JSONC config files** are parsed with `JSON.parse`, which will fail on
  files with comments or trailing commas.
- **No hot-reload**: config changes require restarting OpenCode.

## License

MIT