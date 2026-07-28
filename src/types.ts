/**
 * Shared types for the MCP Bridge plugin.
 *
 * @module
 */

/** A tool definition as returned by an MCP server's `tools/list`. */
export interface MCPToolDefinition {
  name: string
  description?: string
  inputSchema?: {
    type: "object"
    properties?: Record<string, unknown>
    required?: string[]
  }
}

/** An MCP server entry from an `opencode.json` config file. */
export interface MCPServerConfig {
  type: "local" | "remote"
  command?: string[]
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
  env?: Record<string, string>
  /** Alias for `env` (OpenCode's own config schema uses `environment`). */
  environment?: Record<string, string>
}

/** Abstract interface for communicating with an MCP server. */
export interface MCPClient {
  readonly name: string
  readonly config: MCPServerConfig
  close(): void
  listTools(): Promise<MCPToolDefinition[]>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  isConnected(): boolean
}