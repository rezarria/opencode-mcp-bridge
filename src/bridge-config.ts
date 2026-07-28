/**
 * Bridge config loader — reads per-project MCP server selection from
 * `.opencode/mcp-bridge.json` or `mcp-bridge.json`.
 *
 * @module
 */

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Per-project bridge configuration.
 *
 * Only one of `servers` or `exclude` should be set.
 */
export interface BridgeConfig {
  /** If set, only these servers are bridged to subagents (whitelist). */
  servers?: string[]
  /** Servers to exclude from bridging (blacklist). */
  exclude?: string[]
}

/**
 * Load bridge configuration from the project directory.
 *
 * Looks for `.opencode/mcp-bridge.json` first, then `mcp-bridge.json`.
 *
 * @param directory - The project directory (from `ctx.directory`).
 * @returns The bridge config, or `null` if no file exists.
 */
export function loadBridgeConfig(directory: string): BridgeConfig | null {
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
    } catch {
      // skip unreadable / invalid files
      continue
    }
  }

  return null
}