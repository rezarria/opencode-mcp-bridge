/**
 * MCP Bridge Plugin — OpenCode plugin that bridges MCP server tools into
 * subagents (which cannot call MCP tools directly).
 *
 * @packageDocumentation
 */

export { mcpBridgePlugin } from "./plugin.js"

// Re-export key types for consumers
export type {
  MCPToolDefinition,
  MCPServerConfig,
  MCPClient,
} from "./types.js"
export type { BridgeConfig } from "./bridge-config.js"