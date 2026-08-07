/**
 * OpenCode MCP Bridge Plugin
 *
 * Proxies MCP server tools into OpenCode's tool system so they are available
 * to subagents (which cannot directly call MCP tools).
 *
 * @module
 */

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import pkg from "../package.json" with { type: "json" }
import { loadBridgeConfig } from "./bridge-config"
import { loadConfig } from "./config"
import { LocalMCPClient } from "./local-client"
import { RemoteMCPClient } from "./remote-client"
import type { MCPClient, MCPServerConfig } from "./types"

/**
 * The MCP Bridge plugin entry point.
 *
 * On initialization it:
 * 1. Loads MCP configs from all reachable `opencode.json` files.
 * 2. Connects to each enabled MCP server and discovers its tools.
 * 3. Registers each tool as an OpenCode tool with the name
 *    `mcp__<normalized_server>__<tool_name>`.
 *
 * Tools registered via this plugin are available to **all agents**
 * (primary and subagent) by default, unless restricted via
 * `experimental.primary_tools` in `opencode.json`.
 */
const mcpBridgePlugin: Plugin = async (ctx) => {
  const { directory } = ctx
  console.log(`[mcp-bridge] v${pkg.version}`)
  const mcpConfigs = loadConfig(directory)
  const bridgeConfig = loadBridgeConfig(directory)
  const clients: Map<string, MCPClient> = new Map()

  // Determine which servers to bridge
  let serverEntries: [string, MCPServerConfig][]
  if (bridgeConfig?.servers) {
    // Explicit whitelist
    serverEntries = bridgeConfig.servers
      .filter((name) => mcpConfigs[name] !== undefined)
      .map((name) => [name, mcpConfigs[name]!])
  } else {
    // All enabled servers, minus excluded ones
    serverEntries = Object.entries(mcpConfigs).filter(
      ([name, cfg]) => cfg.enabled !== false && cfg.type && !bridgeConfig?.exclude?.includes(name),
    )
  }

  // Initialize clients for selected MCP servers
  for (const [name, cfg] of serverEntries) {
    try {
      const client: MCPClient =
        cfg.type === "local" ? new LocalMCPClient(name, cfg) : new RemoteMCPClient(name, cfg)

      // Probe connection and tool availability
      const tools = await client.listTools()
      clients.set(name, client)
      console.log(`[mcp-bridge] Connected to "${name}" — ${tools.length} tools available`)
    } catch (err) {
      console.warn(`[mcp-bridge] Failed to connect to "${name}": ${(err as Error).message}`)
    }
  }

  // Build the tool map
  const toolMap: Record<string, ReturnType<typeof tool>> = {}

  for (const [serverName, client] of clients) {
    try {
      const mcpTools = await client.listTools()

      for (const mcpTool of mcpTools) {
        const normalizedServerName = serverName.replace(/-/g, "_")
        const toolName = `mcp__${normalizedServerName}__${mcpTool.name}`
        const description = mcpTool.description || `MCP tool: ${serverName}.${mcpTool.name}`
        const inputSchema = mcpTool.inputSchema

        // Build Zod schema from MCP input schema
        const argsSchema: Record<string, unknown> = {}
        if (inputSchema?.properties) {
          for (const [key, prop] of Object.entries(inputSchema.properties)) {
            const propObj = prop as { type?: string; description?: string }
            const isRequired = inputSchema.required?.includes(key)

            let field: unknown
            switch (propObj.type) {
              case "string":
                field = tool.schema.string()
                break
              case "number":
              case "integer":
                field = tool.schema.number()
                break
              case "boolean":
                field = tool.schema.boolean()
                break
              case "array":
                field = tool.schema.array(tool.schema.any())
                break
              case "object":
                field = tool.schema.record(tool.schema.string(), tool.schema.any())
                break
              default:
                field = tool.schema.any()
            }

            if (propObj.description) {
              field = (field as any).describe(propObj.description)
            }

            if (!isRequired) {
              field = (field as any).optional()
            }

            argsSchema[key] = field
          }
        }

        // Register the tool
        toolMap[toolName] = tool({
          description: `[${serverName}] ${description}`,
          args: argsSchema as any,
          async execute(args, _context) {
            try {
              const result = await client.callTool(mcpTool.name, args as Record<string, unknown>)

              // Format the result
              if (typeof result === "string") {
                return {
                  title: `${serverName}.${mcpTool.name}`,
                  output: result,
                }
              }

              const resultObj = result as Record<string, unknown>
              const content = resultObj.content as
                | Array<{ type: string; text?: string; data?: string }>
                | undefined

              if (content && Array.isArray(content)) {
                // Extract text content
                const textParts = content
                  .filter((c) => c.type === "text" && c.text)
                  .map((c) => c.text!)

                if (textParts.length > 0) {
                  return {
                    title: `${serverName}.${mcpTool.name}`,
                    output: textParts.join("\n"),
                    metadata: { isError: resultObj.isError === true },
                  }
                }

                // Handle resource content
                const resourceParts = content
                  .filter((c) => c.type === "resource" && c.text)
                  .map((c) => c.text!)

                if (resourceParts.length > 0) {
                  return {
                    title: `${serverName}.${mcpTool.name}`,
                    output: resourceParts.join("\n"),
                    metadata: { isError: resultObj.isError === true },
                  }
                }
              }

              return {
                title: `${serverName}.${mcpTool.name}`,
                output: JSON.stringify(result, null, 2),
                metadata: { isError: resultObj.isError === true },
              }
            } catch (err) {
              return {
                title: `${serverName}.${mcpTool.name} (error)`,
                output: `Error: ${(err as Error).message}`,
                metadata: { isError: true },
              }
            }
          },
        })
      }
    } catch (err) {
      console.warn(
        `[mcp-bridge] Failed to list tools for "${serverName}": ${(err as Error).message}`,
      )
    }
  }

  // Return hooks with tool registration
  if (Object.keys(toolMap).length > 0) {
    return { tool: toolMap } as any
  }

  return {} as any
}

export default mcpBridgePlugin
export { mcpBridgePlugin }
