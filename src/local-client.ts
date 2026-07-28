/**
 * Local MCP client — communicates with a local MCP server process over
 * JSON-RPC via stdio.
 *
 * @module
 */

import { type ChildProcess, spawn } from "node:child_process"
import type { MCPClient, MCPServerConfig, MCPToolDefinition } from "./types.js"

/** Default timeout for JSON-RPC calls (60 seconds). */
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Client for a local MCP server launched as a child process.
 *
 * The standard MCP transport for local servers is JSON-RPC 2.0 over stdin/stdout.
 * Each message is a single JSON object terminated by a newline.
 */
export class LocalMCPClient implements MCPClient {
  readonly name: string
  readonly config: MCPServerConfig

  private proc: ChildProcess | null = null
  private messageId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ""
  private _connected = false
  private initPromise: Promise<void> | null = null

  constructor(name: string, config: MCPServerConfig) {
    this.name = name
    this.config = config
  }

  // ── Public API ────────────────────────────────────────────────

  isConnected(): boolean {
    return this._connected && this.proc !== null && this.proc.exitCode === null
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    await this.ensureInitialized()
    const result = await this.jsonRpcCall("tools/list", {})
    return (result as any)?.result?.tools || []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureInitialized()
    const result = await this.jsonRpcCall("tools/call", { name, arguments: args })
    return (result as any)?.result
  }

  close(): void {
    if (this.proc) {
      try {
        this.proc.kill()
      } catch {
        /* ignore */
      }
      this.proc = null
    }
    this._connected = false
    for (const [, p] of this.pending) {
      p.reject(new Error("MCP client closed"))
    }
    this.pending.clear()
  }

  // ── Internals ─────────────────────────────────────────────────

  private getEnv(): Record<string, string> {
    return {
      ...(process.env as Record<string, string>),
      ...(this.config.env || this.config.environment || {}),
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this._connected) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this.initialize()
    try {
      await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  private async initialize(): Promise<void> {
    const cmd = this.config.command
    if (!cmd || cmd.length === 0) {
      throw new Error(`No command configured for MCP server "${this.name}"`)
    }

    const env = this.getEnv()

    this.proc = spawn(cmd[0], cmd.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: false,
    })

    this.proc.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString()
      const lines = this.buffer.split("\n")
      this.buffer = lines.pop()!
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed)
          const pending = this.pending.get(msg.id)
          if (pending) {
            this.pending.delete(msg.id)
            pending.resolve(msg)
          }
        } catch {
          // incomplete JSON chunk, continue buffering
        }
      }
    })

    this.proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString()
      if (text.toLowerCase().includes("error") || text.toLowerCase().includes("fail")) {
        console.warn(`[mcp-bridge:${this.name} stderr]`, text)
      }
    })

    this.proc.on("error", (err) => {
      console.error(`[mcp-bridge:${this.name}] process error:`, err.message)
      this._connected = false
    })

    this.proc.on("exit", (code) => {
      console.warn(`[mcp-bridge:${this.name}] process exited with code ${code}`)
      this._connected = false
    })

    // Send initialize request per MCP spec
    await this.jsonRpcCall("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "opencode-mcp-bridge", version: "1.0.0" },
    })

    // Send initialized notification
    this.sendNotification("notifications/initialized", {})

    this._connected = true
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.proc?.stdin?.writable) return
    const msg = `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`
    this.proc.stdin.write(msg)
  }

  private async jsonRpcCall(method: string, params: unknown): Promise<unknown> {
    const id = this.messageId++
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        reject(new Error(`MCP server "${this.name}" not connected`))
        return
      }

      this.pending.set(id, { resolve, reject })
      const request = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`
      this.proc.stdin.write(request)

      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP call "${method}" timed out after ${DEFAULT_TIMEOUT_MS}ms`))
      }, DEFAULT_TIMEOUT_MS)

      // Wrap resolve to clear the timeout
      const entry = this.pending.get(id)!
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          entry.resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
    })
  }
}
