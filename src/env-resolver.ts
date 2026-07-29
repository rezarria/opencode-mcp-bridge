/**
 * Environment variable resolver — replaces `{env:VAR}` and `{file:path}`
 * placeholders in config values with their runtime values.
 *
 * OpenCode supports `{env:VARIABLE_NAME}` and `{file:path/to/file}` in
 * config values (provider.apiKey, MCP headers, MCP environment, etc.).
 * Since the bridge plugin reads `opencode.json` directly, it must resolve
 * these placeholders itself before passing values to MCP server processes.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs"

/**
 * Regex matching `{env:VAR_NAME}` or `{file:path/to/file}` placeholders.
 *
 * - `{env:VARIABLE}` — substitutes `process.env[VARIABLE]`
 * - `{file:/absolute/path}` — substitutes file contents (trimmed)
 */
const ENV_PLACEHOLDER = /\{env:([^}]+)\}/
const FILE_PLACEHOLDER = /\{file:([^}]+)\}/

/**
 * Resolve all `{env:...}` and `{file:...}` placeholders in a single value.
 *
 * @param value - The raw string, possibly containing placeholders.
 * @returns The resolved string with placeholders replaced.
 * @throws If an env var or file path is missing.
 */
export function resolvePlaceholders(value: string): string {
  let result = value

  // Resolve {env:VAR} placeholders
  let envMatch: RegExpExecArray | null
  while ((envMatch = ENV_PLACEHOLDER.exec(result)) !== null) {
    const varName = envMatch[1]!
    const envValue = process.env[varName]
    if (envValue === undefined) {
      throw new Error(
        `Environment variable "${varName}" is not set (referenced by "{env:${varName}}")`,
      )
    }
    result =
      result.slice(0, envMatch.index) + envValue + result.slice(envMatch.index + envMatch[0].length)
  }

  // Resolve {file:path} placeholders
  let fileMatch: RegExpExecArray | null
  while ((fileMatch = FILE_PLACEHOLDER.exec(result)) !== null) {
    const filePath = fileMatch[1]!
    if (!existsSync(filePath)) {
      throw new Error(`File not found: "${filePath}" (referenced by "{file:${filePath}}")`)
    }
    const fileContent = readFileSync(filePath, "utf-8").trim()
    result =
      result.slice(0, fileMatch.index) +
      fileContent +
      result.slice(fileMatch.index + fileMatch[0].length)
  }

  return result
}

/**
 * Check if a string contains any unresolved placeholders.
 */
export function hasPlaceholders(value: string): boolean {
  return ENV_PLACEHOLDER.test(value) || FILE_PLACEHOLDER.test(value)
}

/**
 * Recursively resolve placeholders in a config object.
 *
 * Walks all string values in the object (including nested objects and arrays)
 * and replaces `{env:...}` / `{file:...}` placeholders with their runtime values.
 *
 * @param obj - The config object (mutated in place).
 * @throws If any placeholder references a missing env var or file.
 */
export function resolveConfigPlaceholders<T>(obj: T): T {
  if (typeof obj === "string") {
    return (hasPlaceholders(obj) ? resolvePlaceholders(obj) : obj) as unknown as T
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      obj[i] = resolveConfigPlaceholders(obj[i])
    }
    return obj
  }

  if (obj !== null && typeof obj === "object") {
    for (const [key, val] of Object.entries(obj)) {
      ;(obj as Record<string, unknown>)[key] = resolveConfigPlaceholders(val)
    }
    return obj
  }

  return obj
}
