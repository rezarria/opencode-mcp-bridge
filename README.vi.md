# opencode-mcp-bridge

Plugin OpenCode giúp kết nối các công cụ MCP server vào subagent.

## Vấn đề

Subagent của OpenCode chỉ có thể sử dụng một tập hợp cố định các công cụ tích hợp sẵn (`bash`, `read`, `edit`, `grep`, `glob`, `task`, v.v.). Các công cụ từ MCP server — như `codebase-memory-mcp`, `firecrawl`, `playwright` — **không có sẵn** cho subagent, dù chúng đã được cấu hình trong `opencode.json`.

## Giải pháp

Plugin này kết nối đến từng MCP server đã được bật, khám phá các công cụ của chúng qua `tools/list`, và đăng ký mỗi công cụ như một OpenCode tool với tên `mcp__<server>__<tên_công_cụ>`. Các công cụ được đăng ký qua hook `tool` của plugin sẽ có sẵn cho **tất cả agent** (primary và subagent) theo mặc định.

## Cài đặt

```bash
npm install @rezarria/opencode-mcp-bridge
```

Sau đó thêm vào `opencode.json` của bạn:

```json
{
  "plugin": ["@rezarria/opencode-mcp-bridge"]
}
```

Khởi động lại OpenCode để áp dụng thay đổi.

## Sử dụng

Sau khi cài đặt, subagent có thể gọi các công cụ MCP đã được bridge bằng quy tắc đặt tên `mcp__<server>__<công_cụ>`:

| MCP Server | Tên OpenCode Tool |
|---|---|
| `codebase-memory-mcp` | `mcp__codebase_memory_mcp__search_graph` |
| `codebase-memory-mcp` | `mcp__codebase_memory_mcp__trace_path` |
| `firecrawl` | `mcp__firecrawl__firecrawl_scrape` |
| `playwright` | `mcp__playwright__browser_navigate` |

### Phân quyền Subagent

Subagent cần `"*": "allow"` (hoặc quyền `mcp__*` tường minh) trong cấu hình agent. Ví dụ:

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

## Cách hoạt động

1. **Khi plugin được tải**, nó đọc cấu hình MCP server từ tất cả các tệp `opencode.json` có thể truy cập (global + project, đã được merge).
2. Với mỗi MCP server được bật, nó khởi tạo một tiến trình con (local) hoặc kết nối qua HTTP (remote) và gọi `tools/list`.
3. Mỗi công cụ MCP được phát hiện sẽ được đăng ký như một OpenCode tool qua `Hooks.tool` với:
   - Tên: `mcp__<server_đã_chuẩn_hóa>__<tên_công_cụ>` (gạch ngang → gạch dưới)
   - Tham số: chuyển đổi từ MCP JSON Schema sang Zod schemas
   - Execute: chuyển tiếp JSON-RPC `tools/call` đến MCP server
4. Hệ thống phân quyền của subagent sau đó lọc các công cụ `mcp__*` nào có thể gọi dựa trên quy tắc `permission` của agent.

## Kiến trúc

```
src/
├── index.ts          # Đầu vào package — re-export plugin + types
├── plugin.ts         # Điểm vào plugin — kết nối server, đăng ký tools
├── config.ts         # Trình tải cấu hình — đọc MCP config từ opencode.json
├── local-client.ts   # LocalMCPClient — JSON-RPC qua stdio
├── remote-client.ts  # RemoteMCPClient — JSON-RPC qua HTTP POST
└── types.ts          # Định nghĩa kiểu dùng chung
```

## Hạn chế

- **MCP server từ xa** sử dụng Streamable HTTP (SSE) chưa được hỗ trợ. Remote client dùng HTTP POST đơn giản, hoạt động với các server hỗ trợ nhưng sẽ thất bại với server yêu cầu session-based streaming.
- **Độ trễ khởi động**: plugin kết nối đến tất cả MCP server và khám phá công cụ trong quá trình khởi tạo, có thể làm chậm quá trình khởi động OpenCode nếu server chậm hoặc không truy cập được.
- **Tệp cấu hình JSONC** được phân tích bằng `JSON.parse`, sẽ thất bại với các tệp có comment hoặc dấu phẩy cuối.

## Giấy phép

MIT