# opencode-mcp-bridge

OpenCode plugin that bridges MCP server tools into subagents.

## Problem

OpenCode's subagents can only use a fixed set of built-in tools (`bash`, `read`,
`edit`, `grep`, `glob`, `task`, etc.). MCP server tools — like
`codebase-memory-mcp`, `firecrawl`, `playwright` — are **not available** to
subagents, even though they are configured in `opencode.json`.

## Solution

This plugin connects to every enabled MCP server, discovers their tools via
`tools/list`, and registers each one as an OpenCode tool with the name
`mcp__<server>__<tool_name>`. Tools registered through the plugin's `tool` hook
are available to **all agents** (primary and subagent) by default.

## Installation

```bash
npm install @rezarria/opencode-mcp-bridge
```

Then add it to your `opencode.json`:

```json
{
  "plugin": ["@rezarria/opencode-mcp-bridge"]
}
```

Restart OpenCode for the changes to take effect.

## Usage

Once installed, subagents can call bridged MCP tools using the
`mcp__<server>__<tool>` naming convention:

| MCP Server | OpenCode Tool Name |
|---|---|
| `codebase-memory-mcp` | `mcp__codebase_memory_mcp__search_graph` |
| `codebase-memory-mcp` | `mcp__codebase_memory_mcp__trace_path` |
| `firecrawl` | `mcp__firecrawl__firecrawl_scrape` |
| `playwright` | `mcp__playwright__browser_navigate` |

### Subagent Permission

Subagents need `"*": "allow"` (or explicit `mcp__*` tool permissions) in their
agent config. Example:

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

## How It Works

1. **On plugin load**, the plugin reads MCP server configurations from all
   reachable `opencode.json` files (global + project, merged).
2. For each enabled MCP server, it spawns a child process (local) or connects
   via HTTP (remote) and calls `tools/list`.
3. Each discovered MCP tool is registered as an OpenCode tool via `Hooks.tool`
   with:
   - Name: `mcp__<normalized_server>__<tool_name>` (hyphens → underscores)
   - Args: converted from MCP JSON Schema to Zod schemas
   - Execute: proxies JSON-RPC `tools/call` to the MCP server
4. The subagent's permission system then filters which `mcp__*` tools are
   callable based on the agent's `permission` rules.

## Architecture

```
src/
├── index.ts          # Package entry — re-exports plugin + types
├── plugin.ts         # Plugin entry point — connects servers, registers tools
├── config.ts         # Config loader — reads MCP configs from opencode.json
├── local-client.ts   # LocalMCPClient — JSON-RPC over stdio
├── remote-client.ts  # RemoteMCPClient — JSON-RPC over HTTP POST
└── types.ts          # Shared type definitions
```

## Limitations

- **Remote MCP servers** using Streamable HTTP (SSE) are not supported.
  The remote client uses plain HTTP POST, which works for servers that
  support it but fails for servers requiring session-based streaming.
- **Startup latency**: the plugin connects to all MCP servers and discovers
  tools during initialization, which can delay OpenCode startup if a server
  is slow or unreachable.
- **JSONC config files** are parsed with `JSON.parse`, which will fail on
  files with comments or trailing commas.

## License

MIT