# opencode-mcp-bridge — AGENTS.md

Plugin that bridges MCP server tools into OpenCode subagents.

## Key structure

- `src/plugin.ts` — entry point; connects to MCP servers, registers `mcp__*__*` tools
- `src/config.ts` — loads MCP configs from `opencode.json` (global + project merged)
- `src/bridge-config.ts` — loads per-project `.opencode/mcp-bridge.json` (whitelist/exclude)
- `src/local-client.ts` — JSON-RPC over stdio (uses newline-delimited JSON, NOT Content-Length framing)
- `src/remote-client.ts` — JSON-RPC over HTTP POST only (no Streamable HTTP/SSE)
- `src/env-resolver.ts` — resolves `{env:VAR}` / `{file:path}` placeholders
- `src/tui.tsx` — TUI panel for `/omb` command
- `tui.tsx` — exported copy (consumed by npm installers via `exports["./tui"]`)

## Commands

| Command | What it does |
|---------|-------------|
| `npm run build` | `tsc` (compiles `src/` → `dist/`) |
| `npm test` / `npm run typecheck` | `tsc --noEmit` (typecheck only, no output) |
| `npm run fmt` | `biome format --write src/` |
| `npm run lint` | `biome lint src/` |
| `npm run check` | `biome check --write src/` |
| `npm run build:bun` | `bun build --target node ./src/index.ts --outdir ./dist` |

## Two plugin systems

This package includes **both** a server plugin and a TUI plugin. They are loaded separately:

- **Server plugin** (`exports["."]`): registers `mcp__*` tools. Add to `opencode.json` → `plugin: ["@rezarria/opencode-mcp-bridge"]`.
- **TUI plugin** (`exports["./tui"]`): provides `/omb` command. Must be registered via `opencode plugin @rezarria/opencode-mcp-bridge -g -f`, which writes to `~/.config/opencode/tui.json`. Manual config won't work.

## Subagent permissions

Subagents see `mcp__*` tools only if their agent config has `"*": allow` (or explicit `mcp__*` rules). Missing `"*": allow` = all unlisted tools denied.

```yaml
# .opencode/agents/explore.md
permission:
  "*": allow
  edit: deny
```

Debug with: `opencode debug agent <name>` (shows tool permission map).

## Gotchas

- **No `createSignal`.** OpenCode TUI uses one-shot render. State changes require `writeFileSync` + `api.ui.dialog.replace()`.
- **`writeBridgeConfig()` must `mkdirSync` the `.opencode` directory** before writing `mcp-bridge.json`. The directory may not exist.
- **`ctx.directory`** is the source of truth for config paths. Never use `process.cwd()`.
- **Config merge order** (later overrides earlier): `~/.config/opencode/opencode.json` → `opencode.jsonc` → `<project>/opencode.json` → `opencode.jsonc` → `.opencode/opencode.json` → `.opencode/opencode.jsonc`.
- **JSONC files** are parsed with `JSON.parse` — will fail on comments, trailing commas, or single quotes.
- **Remote MCP** only supports plain HTTP POST. Servers requiring Streamable HTTP (SSE) or session IDs will fail.
- **Each MCP server runs twice** — once for OpenCode's native MCP, once for the bridge plugin. They are separate processes.
- **Cache invalidation** after source changes: code is cached at `~/.cache/opencode/packages/@rezarria/opencode-mcp-bridge@latest/`. Delete that directory and reinstall to pick up changes.
- **`package.json` `files`** must include `"dist"`, `"src"`, `"tui.tsx"` for the package to work after npm install.

## Biome formatting

Indent: 2 spaces, line width: 100, semicolons: as-needed, trailing commas: all.

## CI

GitHub Actions publishes to npm on `release: [created]`. Runs `npm test` (typecheck) before publish.

## Key references

- `docs/lessons-learned.md` — comprehensive Vietnamese-language doc with detailed debugging history, common errors table, and code patterns
- `README.md` — English overview, installation, usage