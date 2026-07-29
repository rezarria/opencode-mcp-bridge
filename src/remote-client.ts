/**
 * Remote MCP client — communicates with a remote MCP server over
 * Streamable HTTP (the MCP standard transport for remote servers).
 *
 * Implements the MCP Streamable HTTP transport specification (2025-11-25):
 * - JSON-RPC 2.0 over HTTP POST
 * - Session management via `mcp-session-id` header
 * - MCP initialize handshake
 * - SSE (Server-Sent Events) response parsing
 * - Notification handling (202 Accepted)
 *
 * @module
 */

import type { MCPClient, MCPServerConfig, MCPToolDefinition } from "./types"

/** Default timeout for JSON-RPC calls (60 seconds). */
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Client for a remote MCP server accessed via Streamable HTTP.
 *
 * Remote MCP servers use the Streamable HTTP transport, which sends
 * JSON-RPC 2.0 messages over HTTP POST. Responses may be plain JSON
 * or SSE (text/event-stream). Session management is handled via the
 * `mcp-session-id` header.
 */
export class RemoteMCPClient implements MCPClient {
  readonly name: string
  readonly config: MCPServerConfig

  private _connected = false
  private _sessionId: string | undefined
  private _protocolVersion: string | undefined
  private _nextId = 1

  constructor(name: string, config: MCPServerConfig) {
    this.name = name
    this.config = config
  }

  isConnected(): boolean {
    return this._connected
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    await this.ensureInitialized()
    const result = await this.jsonRpcCall("tools/list", {})
    return (result as any)?.tools || []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureInitialized()
    return this.jsonRpcCall("tools/call", { name, arguments: args })
  }

  close(): void {
    this._connected = false
    this._sessionId = undefined
    this._protocolVersion = undefined
  }

  // ── Internals ─────────────────────────────────────────────────

  /**
   * Build base headers from config.
   */
  private getBaseHeaders(): Record<string, string> {
    return { ...(this.config.headers || {}) }
  }

  /**
   * Get the server URL.
   */
  private getUrl(): string {
    const url = this.config.url
    if (!url) {
      throw new Error(`No URL configured for remote MCP server "${this.name}"`)
    }
    return url
  }

  /**
   * Build headers for a non-initialize request.
   * Includes session ID and protocol version when available.
   */
  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      ...this.getBaseHeaders(),
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    }

    if (this._protocolVersion) {
      h["mcp-protocol-version"] = this._protocolVersion
    }

    if (this._sessionId) {
      h["mcp-session-id"] = this._sessionId
    }

    return h
  }

  /**
   * Ensure the MCP initialize handshake has completed.
   *
   * The MCP Streamable HTTP handshake consists of:
   * 1. Client sends `initialize` request (no session ID)
   * 2. Server responds with `InitializeResult` (may include session ID in header)
   * 3. Client sends `notifications/initialized` (with session ID if obtained)
   */
  private async ensureInitialized(): Promise<void> {
    if (this._connected) return

    const url = this.getUrl()
    const headers = this.getBaseHeaders()

    // Step 1: Send initialize request (no session ID — new session)
    const initResult = await this.sendRequest(
      url,
      {
        jsonrpc: "2.0",
        id: this.nextId(),
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "opencode-mcp-bridge", version: "1.0.0" },
        },
      },
      {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2024-11-05",
      },
    )

    this._protocolVersion = (initResult as { protocolVersion: string }).protocolVersion

    // Step 2: Send initialized notification (no response expected)
    await this.sendNotification(url, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    })

    this._connected = true
  }

  /**
   * Send a JSON-RPC request and return the result.
   */
  private async jsonRpcCall(method: string, params: unknown): Promise<unknown> {
    const url = this.getUrl()
    const headers = this.buildHeaders()
    const id = this.nextId()

    return this.sendRequest(url, { jsonrpc: "2.0", id, method, params }, headers)
  }

  /**
   * Send a notification (no response expected).
   */
  private async sendNotification(url: string, body: unknown): Promise<void> {
    const headers = this.buildHeaders()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`Notification failed: ${response.status}: ${text || response.statusText}`)
      }
      // 202 Accepted is the expected response for notifications
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Send a JSON-RPC request and parse the response.
   *
   * Handles both plain JSON responses and SSE (text/event-stream) responses.
   * Captures the `mcp-session-id` header from the response if present.
   */
  private async sendRequest(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(
          `MCP server "${this.name}" returned ${response.status}: ${text || response.statusText}`,
        )
      }

      // Capture session ID from response header
      const sessionId = response.headers.get("mcp-session-id")
      if (sessionId) {
        this._sessionId = sessionId
      }

      const contentType = response.headers.get("content-type") || ""

      if (contentType.includes("text/event-stream")) {
        return this.parseSseResponse(await response.text(), (body as any).id)
      }

      // Plain JSON response
      const result = await response.json()
      const jsonRpc = result as { result?: unknown; error?: { message: string } }

      if (jsonRpc.error) {
        throw new Error(`MCP server "${this.name}" error: ${jsonRpc.error.message}`)
      }

      return jsonRpc.result
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Parse an SSE response and extract the JSON-RPC result matching
   * the given request ID.
   */
  private parseSseResponse(text: string, requestId: number): unknown {
    const events = this.parseSSEEvents(text)

    for (const event of events) {
      try {
        const data = JSON.parse(event.data)
        if (data.id === requestId) {
          if (data.error) {
            throw new Error(`MCP server error: ${data.error.message}`)
          }
          return data.result
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("MCP server error")) {
          throw err
        }
        // Skip unparseable events
      }
    }

    throw new Error(`No response found for request id=${requestId} in SSE stream`)
  }

  /**
   * Parse SSE events from a text buffer.
   *
   * SSE format:
   *   event: message
   *   data: {...}
   *   (empty line)
   */
  private parseSSEEvents(text: string): Array<{ data: string; event?: string; id?: string }> {
    const events: Array<{ data: string; event?: string; id?: string }> = []
    const lines = text.split("\n")
    let current: { data: string; event?: string; id?: string } | null = null

    for (const line of lines) {
      if (line === "") {
        // Empty line = end of an event
        if (current && current.data !== "") {
          events.push(current)
        }
        current = null
        continue
      }

      if (line.startsWith("data: ")) {
        if (!current) current = { data: "" }
        const dataValue = line.slice(6)
        current.data += current.data ? `\n${dataValue}` : dataValue
      } else if (line.startsWith("event: ")) {
        if (!current) current = { data: "" }
        current.event = line.slice(7)
      } else if (line.startsWith("id: ")) {
        if (!current) current = { data: "" }
        current.id = line.slice(4)
      }
      // Lines starting with ":" are comments, skipped
    }

    // Handle event without trailing newline
    if (current && current.data !== "") {
      events.push(current)
    }

    return events
  }

  /**
   * Get the next JSON-RPC message ID.
   */
  private nextId(): number {
    return this._nextId++
  }
}
