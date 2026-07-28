# opencode-mcp-bridge

Plugin OpenCode giúp kết nối các công cụ MCP server vào subagent (vốn không thể gọi trực tiếp MCP tools).

## Vấn đề

Subagent của OpenCode chỉ có thể sử dụng một tập hợp cố định các công cụ tích hợp sẵn (`bash`, `read`, `edit`, `grep`, `glob`, `task`, v.v.). Các công cụ từ MCP server — như `codebase-memory-mcp`, `firecrawl`, `playwright` — **không có sẵn** cho subagent, dù chúng đã được cấu hình trong `opencode.json`.

## Giải pháp

Plugin này kết nối đến từng MCP server đã được bật, khám phá các công cụ của chúng qua `tools/list`, và đăng ký mỗi công cụ như một OpenCode tool với tên `mcp__<server>__<tên_công_cụ>`. Các công cụ được đăng ký qua hook của plugin sẽ có sẵn cho **tất cả agent** (primary và subagent), tùy theo quy tắc phân quyền.

## Cài đặt

Gói này cung cấp **hai** plugin riêng biệt, cần cài đặt độc lập:

### 1. Server plugin (đăng ký `mcp__*` tools)

```bash
npm install @rezarria/opencode-mcp-bridge
```

Sau đó thêm vào `opencode.json`:

```json
{
  "plugin": ["@rezarria/opencode-mcp-bridge"]
}
```

### 2. TUI plugin (cung cấp lệnh `/omb`)

```bash
opencode plugin @rezarria/opencode-mcp-bridge -g -f
```

Lệnh này đăng ký bảng điều khiển `/omb` vào `~/.config/opencode/tui.json`. Bảng `/omb` cho phép bạn bật/tắt MCP server được bridge mà không cần sửa file cấu hình.

> **Lưu ý:** Chỉ thêm server plugin vào `opencode.json` là **chưa đủ** để dùng được `/omb`. TUI plugin phải được đăng ký riêng qua lệnh CLI ở trên.

Khởi động lại OpenCode sau khi thực hiện các thay đổi.

## Sử dụng

### Gọi các công cụ đã được bridge

Subagent gọi các công cụ MCP đã bridge bằng quy tắc đặt tên `mcp__<server>__<công_cụ>`:

| MCP Server | Tên OpenCode Tool |
|---|---|
| `codebase-memory-mcp` | `mcp__codebase_memory_mcp__search_graph` |
| `codebase-memory-mcp` | `mcp__codebase_memory_mcp__trace_path` |
| `firecrawl` | `mcp__firecrawl__firecrawl_scrape` |
| `playwright` | `mcp__playwright__browser_navigate` |

### Phân quyền Subagent

Subagent cần `"*": "allow"` (hoặc quyền `mcp__*` tường minh) trong cấu hình agent. Nếu thiếu, tất cả công cụ bridge đều bị từ chối.

```yaml
# .opencode/agents/explore.md
---
description: Code explorer với quyền truy cập MCP.
mode: subagent
permission:
  "*": allow
  edit: deny
---
```

Kiểm tra tool visibility với:

```bash
opencode debug agent <tên_agent>
```

### Kiểm soát server nào được bridge

Tạo file `.opencode/mcp-bridge.json` trong project:

```json
{
  "servers": ["codebase-memory-mcp", "firecrawl"]
}
```

Hoặc dùng chế độ exclude:

```json
{
  "exclude": ["tavily-search"]
}
```

Nếu không có file cấu hình bridge, tất cả MCP server đang bật đều được bridge.

Bạn cũng có thể dùng bảng `/omb` để bật/tắt server tương tác.

## Cách hoạt động

1. **Khi plugin được tải**, nó đọc cấu hình MCP server từ tất cả các tệp `opencode.json` có thể truy cập (global + project, đã được merge).
2. **Bridge config** (`.opencode/mcp-bridge.json`) được đọc để xác định server nào được chọn để bridge.
3. Với mỗi MCP server được chọn, plugin khởi tạo một tiến trình con (local) hoặc kết nối qua HTTP (remote) và gọi `tools/list`.
4. Mỗi công cụ MCP được phát hiện sẽ được đăng ký như một OpenCode tool với:
   - **Tên**: `mcp__<server_đã_chuẩn_hóa>__<tên_công_cụ>` (gạch ngang → gạch dưới)
   - **Tham số**: chuyển đổi từ MCP JSON Schema sang Zod schemas
   - **Execute**: chuyển tiếp JSON-RPC `tools/call` đến MCP server
5. Hệ thống phân quyền của subagent lọc các công cụ `mcp__*` nào có thể gọi dựa trên quy tắc `permission` của agent.

> **Quan trọng:** Mỗi MCP server chạy **hai lần** — một cho hệ thống MCP gốc của OpenCode (primary agent) và một cho plugin bridge (subagent). Đây là hai tiến trình riêng biệt.

## Kiến trúc

```
src/
├── index.ts          # Đầu vào package — re-export plugin + types
├── plugin.ts         # Điểm vào plugin — kết nối server, đăng ký tools
├── config.ts         # Trình tải cấu hình — đọc MCP config từ opencode.json
├── bridge-config.ts  # Trình tải bridge config — đọc .opencode/mcp-bridge.json
├── env-resolver.ts   # Giải mã {env:VAR} / {file:path} trong cấu hình
├── local-client.ts   # LocalMCPClient — JSON-RPC qua stdio (newline-delimited JSON)
├── remote-client.ts  # RemoteMCPClient — JSON-RPC qua HTTP POST
├── types.ts          # Định nghĩa kiểu dùng chung
└── tui.tsx           # Bảng TUI cho lệnh /omb
```

## Xử lý sự cố

| Hiện tượng | Nguyên nhân | Cách fix |
|---|---|---|
| `/omb` không hiện | TUI plugin chưa đăng ký | `opencode plugin @rezarria/opencode-mcp-bridge -g -f` |
| Subagent không thấy `mcp__*` tools | Thiếu `"*": allow` trong agent permission | Thêm vào cấu hình agent |
| Click toggle trong `/omb` báo "Cannot write" | Thư mục `.opencode` chưa tồn tại | `mkdir -p .opencode` (đã fix từ v1.2.3+) |
| Code mới không có hiệu lực | Cache của OpenCode | `rm -rf ~/.cache/opencode/packages/@rezarria/opencode-mcp-bridge@latest` và cài lại |
| "Failed to connect" cho một server | Thiếu biến môi trường hoặc server không tìm thấy | Kiểm tra `env`/`environment` trong cấu hình MCP |
| Remote server bị lỗi | Streamable HTTP không được hỗ trợ | Chỉ server HTTP POST đơn giản mới hoạt động |

## Hạn chế

- **MCP server từ xa** sử dụng Streamable HTTP (SSE) chưa được hỗ trợ. Remote client dùng HTTP POST đơn giản, sẽ thất bại với server yêu cầu session-based streaming (ví dụ: context7, tavily-search).
- **Độ trễ khởi động**: plugin kết nối đến tất cả MCP server được bridge trong quá trình khởi tạo, có thể làm chậm quá trình khởi động OpenCode.
- **Tệp cấu hình JSONC** được phân tích bằng `JSON.parse`, sẽ thất bại với các tệp có comment hoặc dấu phẩy cuối.
- **Không có hot-reload**: thay đổi cấu hình cần khởi động lại OpenCode.

## Giấy phép

MIT