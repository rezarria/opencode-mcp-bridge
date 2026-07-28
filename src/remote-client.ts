/**
 * Remote MCP client — communicates with a remote MCP server over HTTP POST.
 *
 * @module
 */

import type { MCPClient, MCPServerConfig, MCPToolDefinition } from "./types.js"

/**
 * Client for a remote MCP server accessed via HTTP POST.
 *
 * Remote MCP servers use JSON-RPC 2.0 over HTTP. This client implements
 * a basic request-response pattern. Note: Streamable HTTP (SSE) is not
 * supported by this client.
 */
export class RemoteMCPClient implements MCPClient {
  readonly name: string
  readonly config: MCPServerConfig
  private _connected = false

  constructor(name: string, config: MCPServerConfig) {
    this.name = name
    this.config = config
    this._connected = true
  }

  isConnected(): boolean {
    return this._connected
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    const result = await this.httpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    })
    return (result as any)?.result?.tools || []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.httpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    })
    return (result as any)?.result
  }

  close(): void {
    this._connected = false
  }

  private async httpPost(body: unknown): Promise<unknown> {
    const url = this.config.url
    if (!url) {
      throw new Error(`No URL configured for remote MCP server "${this.name}"`)
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(
        `MCP server "${this.name}" returned ${response.status}: ${await response.text()}`,
      )
    }

    return response.json()
  }
}
