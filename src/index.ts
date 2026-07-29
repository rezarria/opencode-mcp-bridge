/**
 * MCP Bridge Plugin — OpenCode plugin that bridges MCP server tools into
 * subagents (which cannot call MCP tools directly).
 *
 * @packageDocumentation
 */

export type { BridgeConfig } from "./bridge-config"
export { mcpBridgePlugin } from "./plugin"
export type {
  MCPClient,
  MCPServerConfig,
  MCPToolDefinition,
} from "./types"
