/**
 * Configuration loader — reads MCP server configurations from OpenCode config
 * files (opencode.json / opencode.jsonc).
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { MCPServerConfig } from "./types.js"

/**
 * Load MCP server configurations from all reachable OpenCode config files.
 *
 * Config files are loaded in order (global first, project last) and merged.
 * Later configs override earlier ones for the same server name.
 *
 * @param directory - The project directory (from `ctx.directory`).
 * @returns A map of MCP server name to configuration.
 */
export function loadConfig(directory: string): Record<string, MCPServerConfig> {
  const configPaths = [
    join(homedir(), ".config", "opencode", "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.jsonc"),
    join(directory, "opencode.json"),
    join(directory, "opencode.jsonc"),
    join(directory, ".opencode", "opencode.json"),
    join(directory, ".opencode", "opencode.jsonc"),
  ]

  const merged: Record<string, MCPServerConfig> = {}

  for (const configPath of configPaths) {
    try {
      if (!existsSync(configPath)) continue
      const content = readFileSync(configPath, "utf-8")
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
