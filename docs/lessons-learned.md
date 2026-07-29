# Lessons Learned — opencode-mcp-bridge

> Tài liệu này tổng hợp toàn bộ kiến thức thu được trong quá trình phát triển
> MCP Bridge plugin cho OpenCode. Mỗi mục là kết quả của debug thực tế, không
> phải suy luận hay document đọc từ source.
>
> **Mục đích:** Lần sau gặp lại vấn đề tương tự, đọc tài liệu này là biết ngay
> nguyên nhân và cách fix, không phải mò lại từ đầu.

---

## Mục lục

1. [OpenCode Plugin System — Kiến trúc tổng quan](#1-opencode-plugin-system--kiến-trúc-tổng-quan)
2. [Hai hệ thống plugin riêng biệt](#2-hai-hệ-thống-plugin-riêng-biệt)
3. [Subagent & Tool Visibility](#3-subagent--tool-visibility)
4. [TUI Plugin — Bẫy signals và re-render](#4-tui-plugin--bẫy-signals-và-re-render)
5. [MCP Server Bridge](#5-mcp-server-bridge)
6. [Config Loading](#6-config-loading)
7. [Cache Invalidation](#7-cache-invalidation)
8. [Publishing & Installation](#8-publishing--installation)
9. [Debugging Checklist](#9-debugging-checklist)
10. [Appendix: Code Patterns](#10-appendix-code-patterns)

---

## 1. OpenCode Plugin System — Kiến trúc tổng quan

### 1.1 Plugin là gì trong OpenCode

Plugin là một function `(ctx) => Promise<Hooks>` trả về hooks để OpenCode gọi
ở các thời điểm khác nhau trong vòng đời. Plugin KHÔNG phải một standalone
process — nó chạy trong cùng process với OpenCode.

### 1.2 Các loại hooks

```typescript
interface Hooks {
  // Đăng ký tool — quan trọng nhất cho MCP Bridge
  tool?: { [name: string]: ToolDefinition }

  // Event hooks
  event?: (input: EventInput) => void
  config?: (cfg: Config) => void

  // Tool lifecycle
  "tool.execute.before"?: (input, output) => void
  "tool.execute.after"?: (input, output) => void
  "tool.definition"?: (input, output) => void

  // Chat
  "chat.message"?: (input, output) => void
  "chat.params"?: (input, output) => void
  "chat.headers"?: (input, output) => void

  // Session
  "experimental.chat.messages.transform"?: (input, output) => void
  "experimental.chat.system.transform"?: (input, output) => void
  "experimental.session.compacting"?: (input, output) => void
}
```

### 1.3 Plugin entry point

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"  // import từ ROOT, không phải /tool

const myPlugin: Plugin = async (ctx) => {
  const { directory } = ctx  // LUÔN dùng ctx.directory, không dùng process.cwd()

  return {
    tool: {
      my_tool: tool({
        description: "...",
        args: { /* Zod schema */ },
        execute: async (args, context) => {
          return { output: "result" }
        },
      }),
    },
  }
}

export default myPlugin
```

**Import `tool()` từ đâu?**
- `@opencode-ai/plugin` (root) — chính xác
- `@opencode-ai/plugin/tool` — cũng được (re-export)
- Cả hai đều resolve đến cùng một implementation

### 1.4 ToolContext — những gì có sẵn trong execute

```typescript
interface ToolContext {
  sessionID: string
  messageID: string
  agent: string        // tên agent đang gọi tool
  directory: string    // project directory
  worktree: string     // git worktree root
  abort: AbortSignal   // để hủy operation nếu context bị clear
  metadata: () => Record<string, unknown>
  ask: (question: string) => Promise<string>
}
```

### 1.5 Plugin path resolution

Plugin path trong config được resolve **relative to thư mục chứa config file đó**.

```
Config: ~/.config/opencode/opencode.json
  → "plugin": ["./plugins/mcp-bridge.ts"]
  → Resolve: ~/.config/opencode/plugins/mcp-bridge.ts

Config: ~/Projects/picas/.opencode/opencode.json
  → "plugin": ["@rezarria/opencode-mcp-bridge"]
  → Resolve: từ node_modules (global hoặc project)
```

### 1.6 Plugin config trong opencode.json

```json
{
  "plugin": [
    // npm package (từ global node_modules hoặc cache)
    "@rezarria/opencode-mcp-bridge",

    // npm package với version
    "@rezarria/opencode-mcp-bridge@1.2.0",

    // local file path
    "./plugins/mcp-bridge.ts",

    // absolute path
    "/home/user/.config/opencode/plugins/mcp-bridge.ts",

    // tuple form với options
    ["@rezarria/opencode-mcp-bridge", { "option": "value" }]
  ]
}
```

### 1.7 Auto-discovered plugins

Bất kỳ `*.ts` hoặc `*.js` file nào trong `.opencode/plugin/` hoặc
`.opencode/plugins/` đều được auto-discover — **không cần config entry**.

---

## 2. Hai hệ thống plugin riêng biệt

### 2.1 Server plugin vs TUI plugin

Đây là **nguyên nhân số 1** gây ra lỗi `/omb` không hiện. OpenCode không phải
có một hệ thống plugin — nó có **hai hệ thống hoàn toàn riêng biệt**:

| | Server Plugin | TUI Plugin |
|---|---|---|
| **Mục đích** | Tool registration, business logic | UI components, commands, panels |
| **Config file** | `opencode.json` → `plugin: [...]` | `~/.config/opencode/tui.json` → `plugin: [...]` |
| **Load khi** | OpenCode khởi động (server process) | OpenCode khởi động TUI (UI process) |
| **Entry point** | `exports["."]` trong package.json | `exports["./tui"]` trong package.json |
| **Module shape** | `Plugin = (ctx) => Promise<Hooks>` | `{ id: string, tui: (api) => void }` |

### 2.2 Server plugin không tự động kéo theo TUI plugin

Nếu package.json có cả `exports["."]` và `exports["./tui"]`, và bạn chỉ config
trong `opencode.json`, thì **chỉ server plugin được load**. TUI plugin không
được load cho đến khi có entry trong `tui.json`.

### 2.3 Cách cài TUI plugin đúng

```bash
# ✅ Cách đúng — dùng CLI
opencode plugin @rezarria/opencode-mcp-bridge -g -f

# CLI này tự động:
# 1. Kiểm tra package.json có exports["./tui"] không
# 2. Nếu có: tạo hoặc update ~/.config/opencode/tui.json
# 3. Nếu không: chỉ update opencode.json
# 4. Cài package vào ~/.cache/opencode/packages/ nếu cần

# ❌ Cách sai — tự tạo tui.json bằng tay
# Có thể không hoạt động tùy phiên bản OpenCode
```

### 2.4 package.json exports cho cả server và TUI

```json
{
  "main": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./tui": {
      "types": "./dist/tui.d.ts",
      "import": "./tui.tsx"
    }
  },
  "files": ["dist", "src", "tui.tsx"]
}
```

**Lưu ý:** `exports["./tui"]` có thể trỏ trực tiếp đến `.tsx` file — OpenCode
TUI loader xử lý TypeScript/JSX. Không cần build riêng.

### 2.5 TUI plugin module shape

```typescript
/** @jsxImportSource @opentui/solid */
// ⬆ Dòng này BẮT BUỘC ở đầu file — nếu thiếu, JSX không compile

import type { TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui"

const tui: TuiPluginModule["tui"] = async (api) => {
  api.command?.register(() => [
    {
      title: "MCP Bridge Panel",
      value: "mcp-bridge.panel",
      description: "Configure which MCP servers are bridged to subagents",
      category: "MCP Bridge",
      slash: { name: "omb", aliases: ["mcp-bridge"] },
      onSelect: () => {
        api.ui.dialog.setSize("large")
        api.ui.dialog.replace(() => {
          const directory = (api as any).state.path.directory
          return renderPanel(api, directory)
        })
      },
    },
  ])
}

export default {
  id: "opencode-mcp-bridge",
  tui,
} satisfies TuiPluginModule
```

---

## 3. Subagent & Tool Visibility

### 3.1 Danh sách tool types có sẵn

```bash
opencode agent create --help
# Available: "bash, read, edit, glob, grep, webfetch, task, todowrite,
#             websearch, lsp, skill"
```

**Chỉ 11 tools.** MCP tools không có trong danh sách này. Đây là giới hạn
cứng của framework — không thể mở rộng bằng config.

### 3.2 Plugin tool registration bypasses giới hạn này

Tools đăng ký qua `Hooks.tool` (plugin) có sẵn cho **mọi agent** — cả primary
và subagent — miễn là permission rules cho phép. Đây là cơ chế duy nhất để
subagent dùng được MCP tools.

### 3.3 Permission system quyết định tool visibility

Agent permission rules được resolve thành per-tool booleans. Cơ chế:

```
1. Plugin register tools → tools có trong OpenCode tool system
2. Agent permission rules → resolve từng tool thành true/false
3. Agent chỉ thấy tools có giá trị true
```

**Ví dụ cụ thể:**

```yaml
# explore.md
permission:
  edit: deny
  bash: allow
  task: allow
```

Resolved tools:
- `bash` → `true`
- `read` → `false` (không được liệt kê)
- `edit` → `false`
- `task` → `true`
- `mcp__codebase_memory_mcp__search_graph` → `false` (không được liệt kê)

```yaml
# explore.md (fixed)
permission:
  "*": allow    # phải đứng ĐẦU TIÊN
  edit: deny
```

Resolved tools:
- `bash` → `true`
- `read` → `true`
- `edit` → `false`
- `task` → `true`
- `mcp__codebase_memory_mcp__search_graph` → `true`

**Quy tắc:** Không có `"*": allow` = mọi tool không được liệt kê đều bị deny.

### 3.4 Debug tool visibility

```bash
opencode debug agent <name>
# Output: tool map, vd:
#   "mcp__codebase_memory_mcp__search_graph": true
#   "mcp__firecrawl__firecrawl_scrape": true
#   "edit": false
```

### 3.5 primary_tools — giới hạn tool cho primary agent

```json
{
  "experimental": {
    "primary_tools": ["edit", "bash"]
  }
}
```

Tools trong danh sách này **chỉ primary agent mới gọi được**. Subagent không
thấy chúng. Dùng để bảo vệ tools nguy hiểm.

---

## 4. TUI Plugin — Bẫy signals và re-render

### 4.1 Vấn đề: `createSignal` không hoạt động trong OpenCode TUI

OpenCode TUI dùng `@opentui/solid` (SolidJS-based), nhưng **không có reactive
system** như SolidJS browser. `createSignal` và `createEffect` **không trigger
re-render** — giá trị thay đổi nhưng UI không update.

**Tại sao?** OpenCode TUI render là một lần (one-shot render), không có
reactivity graph. Khi bạn gọi `setState(newValue)`, không có signal nào báo
cho UI biết cần re-render.

### 4.2 Pattern đúng: dialog.replace()

Mỗi lần state thay đổi, **ghi state vào file → gọi `dialog.replace()` với
một render function mới → toàn bộ dialog được rebuild từ đầu.**

```typescript
// ❌ SAI: dùng signals
const [bridged, setBridged] = createSignal(new Set<string>())
// Click handler:
function toggle(name: string) {
  const next = new Set(bridged())
  if (next.has(name)) next.delete(name); else next.add(name)
  setBridged(next)  // ← UI không đổi, dù bridged() trả về giá trị mới
}

// ✅ ĐÚNG: ghi file → dialog.replace()
function toggleServer(name: string, api: TuiPluginApi, directory: string) {
  // 1. Đọc state từ file
  const config = loadBridgeConfig(directory)
  // 2. Tính state mới
  const newConfig: BridgeConfig = { servers: [...] }
  // 3. Ghi state
  writeBridgeConfig(directory, newConfig)
  // 4. Re-render toàn bộ
  api.ui.dialog.replace(() => renderPanel(api, directory))
}
```

### 4.3 Vòng đời của panel

```
User mở /omb
  → api.ui.dialog.replace(() => renderPanel(api, dir))
  → renderPanel() đọc config từ file
  → render JSX tree

User click toggle
  → toggleServer() ghi file mới
  → dialog.replace(() => renderPanel(api, dir))
  → renderPanel() đọc config MỚI từ file
  → render JSX tree MỚI
  → Toàn bộ dialog được thay thế

User click close
  → api.ui.dialog.clear()
  → Dialog biến mất
```

### 4.4 Click handler — onMouseUp

DCP (plugin tham khảo) dùng `onMouseUp` trên **`box`** element:

```typescript
// ✅ ĐÚNG (giống DCP)
<box
  paddingLeft={1}
  paddingRight={1}
  backgroundColor={isSelected ? theme.primary : theme.backgroundElement}
  onMouseUp={() => handler()}
>
  <text>Click me</text>
</box>

// ✅ CŨNG ĐÚNG (onMouseUp trên text cho elements đơn giản)
<text fg={theme.text} onMouseUp={() => handler()}>
  esc
</text>
```

**onMouseUp vs onClick:**
- `onMouseUp` — pattern chính thức của DCP
- `onClick` — không phải event handler hợp lệ trong OpenCode TUI
- `onMouseDown` — tồn tại nhưng không phải pattern cho click

### 4.5 Dialog API reference

```typescript
interface TuiDialogStack {
  replace: (render: () => JSX.Element, onClose?: () => void) => void
  clear: () => void
  setSize: (size: "medium" | "large" | "xlarge") => void
  readonly size: "medium" | "large" | "xlarge"
  readonly depth: number
  readonly open: boolean
}
```

### 4.6 Theme

```typescript
interface Theme {
  primary: string          // Màu chủ đạo (thường là xanh)
  text: string             // Màu chữ chính
  textMuted: string        // Màu chữ phụ
  success: string          // Màu xanh (success/active)
  backgroundElement: string // Màu nền element
  borderSubtle: string     // Màu border nhạt
  selectedListItemText: string // Màu chữ khi được chọn
}
```

### 4.7 Toast notifications

```typescript
api.ui.toast({
  variant: "error" | "warning" | "info" | "success",
  title: "Bridge",
  message: "Cannot write .opencode/mcp-bridge.json",
})
```

---

## 5. MCP Server Bridge

### 5.1 Kiến trúc

```
OpenCode primary agent        OpenCode subagent
        |                           |
        | (gọi MCP tools)           | (gọi mcp__*__ tools)
        v                           v
┌─────────────────────────────────────────┐
│         OpenCode MCP System             │
│  (native MCP: codebase-memory-mcp_*)   │
└─────────────────────────────────────────┘
        |                           ^
        | (MCP protocol)            | (plugin tool)
        v                           |
┌─────────────────────────────────────────┐
│      mcp-bridge plugin (plugin.ts)      │
│  spawns SEPARATE MCP server processes   │
│  (không share connection với native)    │
└─────────────────────────────────────────┘
        |
        | (JSON-RPC over stdio / HTTP)
        v
┌─────────────────────────────────────────┐
│          MCP Server (child process)     │
│  codebase-memory-mcp, firecrawl, ...    │
└─────────────────────────────────────────┘
```

**Mỗi MCP server chạy 2 lần:**
1. **Native** — OpenCode spawn để primary dùng (tools: `codebase-memory-mcp_*`)
2. **Bridge** — plugin spawn để subagent dùng (tools: `mcp__codebase_memory_mcp__*`)

Đây là thiết kế bắt buộc vì OpenCode không có API public để mượn native MCP
connection.

### 5.2 JSON-RPC over stdio (Local MCP)

MCP protocol dùng **Content-Length framing** (giống HTTP):

```
Content-Length: 123\r\n
\r\n
{"jsonrpc":"2.0","id":"1","result":{...}}
```

Xử lý đúng:

```typescript
interface Accumulator {
  buffer: string
}

function readMessage(acc: Accumulator): { message: any; rest: string } | null {
  const headerMatch = acc.buffer.match(/^Content-Length: (\d+)\r\n\r\n/)
  if (!headerMatch) return null

  const length = parseInt(headerMatch[1], 10)
  const bodyStart = headerMatch[0].length  // length của header string

  if (acc.buffer.length < bodyStart + length) return null  // chưa đủ data

  const body = acc.buffer.slice(bodyStart, bodyStart + length)
  const rest = acc.buffer.slice(bodyStart + length)

  return { message: JSON.parse(body), rest }
}
```

**Sai lầm thường gặp:** Dùng newline-delimited JSON (`\n\n`). Một số MCP server
gửi newline sau message, nhưng không phải tất cả. **Luôn parse Content-Length.**

### 5.3 JSON-RPC message flow

**Initialize:**
```
→ {"jsonrpc":"2.0","id":"1","method":"initialize","params":{"protocolVersion":"0.1.0",...}}
← {"jsonrpc":"2.0","id":"1","result":{"protocolVersion":"0.1.0","serverInfo":{...}}}
→ {"jsonrpc":"2.0","method":"notifications/initialized"}
```

**List tools:**
```
→ {"jsonrpc":"2.0","id":"2","method":"tools/list"}
← {"jsonrpc":"2.0","id":"2","result":{"tools":[...]}}
```

**Call tool:**
```
→ {"jsonrpc":"2.0","id":"3","method":"tools/call","params":{"name":"search_graph","arguments":{...}}}
← {"jsonrpc":"2.0","id":"3","result":{"content":[...]}}
```

### 5.4 Remote MCP — Streamable HTTP

**Remote MCP servers dùng Streamable HTTP**, không phải plain HTTP POST.
Yêu cầu:
- `Accept: application/json, text/event-stream`
- Session management (session ID trong response header)
- MCP initialize handshake (initialize → notifications/initialized)
- SSE response parsing (text/event-stream content type)

**Plugin hiện tại đã support** — `RemoteMCPClient` thực hiện:

1. **Initialize handshake:** Gửi `initialize` request (không có session ID), nhận response
   (JSON hoặc SSE), lưu `mcp-session-id` từ response header và `protocolVersion` từ body.
2. **Notification:** Gửi `notifications/initialized` — server trả về 202 Accepted, không parse body.
3. **Subsequent requests:** Gửi với `mcp-session-id` và `mcp-protocol-version` headers.
4. **SSE parsing:** Parse `text/event-stream` response, tìm event khớp với request ID.
5. **Plain JSON fallback:** Nếu response là `application/json`, parse trực tiếp.

```typescript
// Initialize handshake (no session ID)
POST /mcp
Headers: { "mcp-protocol-version": "2024-11-05" }
Body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {...} }
← 200 text/event-stream với SSE event chứa InitializeResult
← Header: mcp-session-id: <uuid>

// Notifications/initialized
POST /mcp
Headers: { "mcp-session-id": "<uuid>", "mcp-protocol-version": "2024-11-05" }
Body: { jsonrpc: "2.0", method: "notifications/initialized" }
← 202 Accepted (no body)

// tools/list
POST /mcp
Headers: { "mcp-session-id": "<uuid>", "mcp-protocol-version": "2024-11-05" }
Body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
← 200 text/event-stream với SSE event chứa tools list
```

**Đã test thành công với:** `context7` (Context7 MCP), `tavily-search` (Tavily MCP).
Cả hai đều dùng SSE response với session management.

### 5.5 Server name normalization

MCP server names có thể chứa `-` (vd: `codebase-memory-mcp`, `tavily-search`).
OpenCode tool names dùng `_` convention.

```typescript
const normalized = serverName.replace(/-/g, "_")
const toolName = `mcp__${normalized}__${mcpTool.name}`
// mcp__codebase-memory-mcp__search_graph  →  mcp__codebase_memory_mcp__search_graph
```

### 5.6 Schema conversion (MCP JSON Schema → Zod)

```typescript
const argsSchema: Record<string, unknown> = {}
if (inputSchema?.properties) {
  for (const [key, prop] of Object.entries(inputSchema.properties)) {
    const propObj = prop as { type?: string; description?: string }
    const isRequired = inputSchema.required?.includes(key)

    let field
    switch (propObj.type) {
      case "string":  field = tool.schema.string(); break
      case "number":
      case "integer": field = tool.schema.number(); break
      case "boolean": field = tool.schema.boolean(); break
      case "array":   field = tool.schema.array(tool.schema.any()); break
      case "object":  field = tool.schema.record(tool.schema.string(), tool.schema.any()); break
      default:        field = tool.schema.any()
    }

    if (propObj.description) field = field.describe(propObj.description)
    if (!isRequired) field = field.optional()

    argsSchema[key] = field
  }
}
```

### 5.7 Tool result formatting

MCP `tools/call` trả về `{ content: [{ type: "text", text: "..." }] }`.

```typescript
const result = await client.callTool(mcpTool.name, args)
const content = result.content as Array<{ type: string; text?: string }>

// Text content
const textParts = content.filter(c => c.type === "text" && c.text).map(c => c.text!)
return { output: textParts.join("\n") }

// Resource content
const resourceParts = content.filter(c => c.type === "resource" && c.text).map(c => c.text!)
return { output: resourceParts.join("\n") }

// Fallback
return { output: JSON.stringify(result, null, 2) }
```

---

## 6. Config Loading

### 6.1 ctx.directory — nguồn truth duy nhất

```typescript
// ✅ LUÔN dùng ctx.directory
const mcpBridgePlugin: Plugin = async (ctx) => {
  const { directory } = ctx
  const mcpConfigs = loadConfig(directory)
}

// ❌ KHÔNG dùng process.cwd()
// process.cwd() trả về directory mà OpenCode được khởi động từ đó,
// có thể khác project directory thực tế.
```

### 6.2 Config merge order

Config files được load theo thứ tự, later overrides earlier:

```
1. ~/.config/opencode/opencode.json       (global, lowest priority)
2. ~/.config/opencode/opencode.jsonc
3. <project>/opencode.json
4. <project>/opencode.jsonc
5. <project>/.opencode/opencode.json      (project, highest priority)
6. <project>/.opencode/opencode.jsonc
```

### 6.3 MCP config fields

```json
{
  "mcp": {
    "codebase-memory-mcp": {
      "type": "local",
      "command": ["npx", "-y", "@opencode-ai/codebase-memory-mcp"],
      "enabled": true
    },
    "firecrawl": {
      "type": "local",
      "command": ["npx", "-y", "firecrawl-mcp"],
      "enabled": true,
      "env": { "FIRECRAWL_API_KEY": "sk-..." },
      "environment": { "FIRECRAWL_API_KEY": "sk-..." }
    }
  }
}
```

**`env` vs `environment`:** Cả hai đều là env vars cho child process. Một số
MCP servers dùng `env`, số khác dùng `environment`. Plugin cần merge cả hai.

### 6.4 JSONC parsing

`JSON.parse` fail trên files có comments, trailing commas, single quotes.
**Cần dùng parser hỗ trợ JSONC** nếu muốn support `opencode.jsonc`:

```bash
npm install jsonc-parser
```

```typescript
import { parse } from "jsonc-parser"
const config = parse(content)
```

### 6.5 Bridge config file (mcp-bridge.json)

File riêng để kiểm soát server nào được bridge, không phụ thuộc vào
`opencode.json`:

```json
// .opencode/mcp-bridge.json
{
  "servers": ["codebase-memory-mcp", "firecrawl", "playwright"]
}
```

Hoặc dùng exclude mode:

```json
{
  "exclude": ["tavily-search"]
}
```

Nếu không có file này, mọi enabled server đều được bridge.

---

## 7. Cache Invalidation

### 7.1 Cấu trúc cache

```
~/.cache/opencode/packages/
  @rezarria/opencode-mcp-bridge@latest/
    node_modules/
      @rezarria/opencode-mcp-bridge/    ← code thật
        dist/
          index.js
          tui.jsx
          tui.d.ts
        tui.tsx
        package.json

~/.config/opencode/node_modules/
  @rezarria/opencode-mcp-bridge/        ← symlink đến cache
    → ~/.cache/.../node_modules/@rezarria/opencode-mcp-bridge
```

### 7.2 Vấn đề: code mới không生效 sau khi push

**Nguyên nhân:** OpenCode cache không tự động update. Khi bạn push code mới
lên GitHub rồi restart OpenCode, nó vẫn dùng code cũ trong cache.

**Phát hiện lần đầu:** Mất 3 lần restart + debug mới nhận ra. TUI plugin
không có lỗi — code mới không được load.

### 7.3 Cách fix cache

**Cách 1 — Xóa cache + reinstall (sạch sẽ nhất):**

```bash
rm -rf ~/.cache/opencode/packages/@rezarria/opencode-mcp-bridge@latest
opencode plugin @rezarria/opencode-mcp-bridge -g -f
```

**Cách 2 — Copy trực tiếp (nhanh hơn, cho development):**

```bash
cp dist/tui.jsx ~/.cache/opencode/packages/@rezarria/opencode-mcp-bridge@latest/node_modules/@rezarria/opencode-mcp-bridge/dist/
cp tui.tsx ~/.cache/opencode/packages/@rezarria/opencode-mcp-bridge@latest/node_modules/@rezarria/opencode-mcp-bridge/
# Cần restart OpenCode
```

### 7.4 Development workflow tối ưu

```bash
# 1. Sửa code
# 2. Build
npm run build

# 3. Copy vào cache
cp dist/*.js* ~/.cache/opencode/packages/@rezarria/opencode-mcp-bridge@latest/node_modules/@rezarria/opencode-mcp-bridge/dist/
cp src/tui.tsx ~/.cache/opencode/packages/@rezarria/opencode-mcp-bridge@latest/node_modules/@rezarria/opencode-mcp-bridge/

# 4. Restart OpenCode
# 5. Kiểm tra
opencode debug startup --print-logs --log-level DEBUG

# 6. Khi hài lòng, push lên GitHub
git push
```

---

## 8. Publishing & Installation

### 8.1 npm publish

```bash
# Build trước
npm run build

# Kiểm tra files trong tarball
npm pack --dry-run

# Publish
npm publish
```

### 8.2 package.json `files` field

```json
{
  "files": ["dist", "src", "tui.tsx"]
}
```

Nếu thiếu file trong `files`, khi người dùng cài qua npm, file đó không có
trong tarball. Đặc biệt quan trọng với `tui.tsx` — nếu thiếu, TUI plugin
không load được.

### 8.3 Installation

```bash
# Global install
opencode plugin @rezarria/opencode-mcp-bridge -g -f

# Hoặc thêm vào opencode.json thủ công:
# "plugin": ["@rezarria/opencode-mcp-bridge"]
```

### 8.4 GitHub Actions — npm publish workflow

```yaml
name: Publish npm package
on:
  release:
    types: [created]  # ← Chỉ chạy khi tạo Release, không chạy khi push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: "https://registry.npmjs.org" }
      - run: npm ci
      - run: npm test
  publish-npm:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: "https://registry.npmjs.org" }
      - run: npm ci
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.npm_token }}
```

**Trigger:** `release: created` — không phải `push`. Để chạy workflow cần tạo
Release trên GitHub.

```bash
gh release create v1.2.0 --generate-notes
```

---

## 9. Debugging Checklist

### 9.1 Plugin load verification

```bash
# 1. Kiểm tra plugin có load không
opencode debug startup --print-logs --log-level DEBUG
# Tìm: [mcp-bridge] Connected to "codebase-memory-mcp" — 14 tools available

# 2. Kiểm tra config
opencode debug config

# 3. Kiểm tra version
opencode --version
```

### 9.2 Tool visibility verification

```bash
# Kiểm tra tool nào có sẵn cho từng agent
opencode debug agent explore
opencode debug agent general
opencode debug agent build

# Output dạng:
#   tools:
#     mcp__codebase_memory_mcp__search_graph: true
#     mcp__firecrawl__firecrawl_scrape: false
#     edit: false
```

### 9.3 MCP connectivity

```bash
# List MCP servers (native, không phải bridge)
opencode mcp list
```

### 9.4 Checklist khi /omb không hiện

- [ ] Plugin đã được cài qua `opencode plugin ... -g -f`? (không phải config tay)
- [ ] `~/.config/opencode/tui.json` tồn tại và có entry?
- [ ] `package.json` có `exports["./tui"]`?
- [ ] `package.json` `files` có bao gồm `tui.tsx`?
- [ ] `tui.tsx` có `/** @jsxImportSource @opentui/solid */` ở đầu?
- [ ] Cache đã được clear sau khi push code mới?
- [ ] OpenCode đã được restart?

### 9.5 Checklist khi click không phản hồi

- [ ] Có dùng `createSignal` không? → **Chuyển sang `dialog.replace()`**
- [ ] `onMouseUp` trên element đúng? → **Dùng `box` cho interactive elements**
- [ ] State có được persist (ghi file) trước khi `dialog.replace()`?
- [ ] Cache đã được update với code mới?

### 9.6 Checklist khi subagent không thấy mcp__* tools

- [ ] Agent permission có `"*": allow` không?
- [ ] `opencode debug agent <name>` — tool có `true` không?
- [ ] Plugin load log có dòng "Connected to" không?
- [ ] Server name normalization đúng? (hyphen → underscore)
- [ ] Bridge config (mcp-bridge.json) có exclude server này không?

### 9.7 Common errors

| Hiện tượng | Nguyên nhân | Fix |
|---|---|---|
| `/omb` không hiện | TUI chưa register trong `tui.json` | `opencode plugin ... -g -f` |
| Click không phản hồi | `createSignal` hoặc sai element | `dialog.replace()`, `onMouseUp` trên `box` |
| Subagent không thấy `mcp__*` tools | Permission thiếu `"*": allow` | Sửa agent config |
| `mcp__codebase-memory-mcp__...` không match | Hyphen chưa normalize | `replace(/-/g, "_")` |
| Code mới không生效 sau push | Cache cũ | Xóa cache + reinstall |
| npm publish thiếu files | `files` trong `package.json` thiếu | Thêm dist, src, tui.tsx |
| Context7/Tavily fail | Streamable HTTP không support | Dùng native MCP cho primary |
| JSONC parse error | `JSON.parse` không handle comments | Dùng jsonc-parser |
| MCP server không connect | Missing env vars | Kiểm tra `env`/`environment` trong config |
| Plugin load nhưng tool không có sẵn | `experimental.primary_tools` giới hạn | Bỏ tool khỏi primary_tools |

---

## 10. Appendix: Code Patterns

### 10.1 Plugin entry point (server)

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

const plugin: Plugin = async (ctx) => {
  const { directory } = ctx

  // Init logic...
  const toolMap: Record<string, ReturnType<typeof tool>> = {}
  toolMap["my_tool"] = tool({
    description: "Does something",
    args: { input: tool.schema.string().describe("Input value") },
    execute: async (args, _context) => {
      return { output: `Hello ${args.input}` }
    },
  })

  return { tool: toolMap } as any
}

export default plugin
```

### 10.2 TUI plugin entry

```typescript
/** @jsxImportSource @opentui/solid */

import type { TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui"

function renderPanel(api: TuiPluginApi, directory: string) {
  // Read fresh state from file
  return (
    <box>
      <text>Hello</text>
    </box>
  )
}

const tui: TuiPluginModule["tui"] = async (api) => {
  api.command?.register(() => [
    {
      title: "My Panel",
      value: "my.panel",
      description: "...",
      slash: { name: "mycmd" },
      onSelect: () => {
        api.ui.dialog.setSize("large")
        api.ui.dialog.replace(() => {
          const directory = (api as any).state.path.directory
          return renderPanel(api, directory)
        })
      },
    },
  ])
}

export default { id: "my-plugin", tui } satisfies TuiPluginModule
```

### 10.3 State management (no signals)

```typescript
function readState(directory: string): State {
  const path = join(directory, ".opencode", "state.json")
  try { return JSON.parse(readFileSync(path, "utf-8")) }
  catch { return { /* defaults */ } }
}

function writeState(directory: string, state: State): boolean {
  try {
    writeFileSync(join(directory, ".opencode", "state.json"), JSON.stringify(state, null, 2))
    return true
  } catch { return false }
}

function updateState(directory: string, updater: (s: State) => State, api: TuiPluginApi) {
  const state = readState(directory)
  const newState = updater(state)
  writeState(directory, newState)
  api.ui.dialog.replace(() => renderPanel(api, directory))
}
```

### 10.4 MCP local client (Content-Length framing)

```typescript
class LocalMCPClient {
  private proc: ChildProcess
  private buffer = ""
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private nextId = 1

  constructor(name: string, cfg: MCPServerConfig) {
    this.proc = spawn(cfg.command![0], cfg.command!.slice(1), {
      env: { ...process.env, ...cfg.env, ...cfg.environment },
      stdio: ["pipe", "pipe", "pipe"],
    })

    this.proc.stdout!.on("data", (chunk) => {
      this.buffer += chunk.toString()
      this.processMessages()
    })
  }

  private processMessages() {
    while (true) {
      const match = this.buffer.match(/^Content-Length: (\d+)\r\n\r\n/)
      if (!match) break

      const length = parseInt(match[1], 10)
      const headerLen = match[0].length

      if (this.buffer.length < headerLen + length) break

      const body = this.buffer.slice(headerLen, headerLen + length)
      this.buffer = this.buffer.slice(headerLen + length)

      const msg = JSON.parse(body)
      const pending = this.pending.get(msg.id?.toString())
      if (pending) {
        if (msg.error) pending.reject(new Error(msg.error.message))
        else pending.resolve(msg.result)
        this.pending.delete(msg.id.toString())
      }
    }
  }

  async request(method: string, params?: any): Promise<any> {
    const id = this.nextId++
    const request = { jsonrpc: "2.0", id, method, params }
    const body = JSON.stringify(request)
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`

    return new Promise((resolve, reject) => {
      this.pending.set(id.toString(), { resolve, reject })
      this.proc.stdin!.write(header + body)
    })
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "0.1.0",
      capabilities: {},
      clientInfo: { name: "opencode-mcp-bridge", version: "1.0.0" },
    })
    this.request("notifications/initialized", {})
    return result
  }

  async listTools(): Promise<any[]> {
    const result = await this.request("tools/list")
    return result.tools || []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    return this.request("tools/call", { name, arguments: args })
  }
}
```

### 10.5 Build config cache from opencode.json

```typescript
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

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
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      if (config.mcp) {
        Object.assign(merged, config.mcp)
      }
    } catch { /* skip unreadable files */ }
  }

  return merged
}
```

---

> **Tóm lại:** Tài liệu này ghi lại toàn bộ những gì đã học được từ thực tế.
> Không có gì trong đây là suy luận — tất cả đều đã được kiểm chứng bằng
> debug, test, và production usage.
>
> Lần sau phát triển OpenCode plugin, mở tài liệu này trước, đọc phần liên
> quan, và làm theo patterns đã được kiểm chứng. Sẽ tiết kiệm được rất nhiều
> thời gian.