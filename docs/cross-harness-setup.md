# Cross-harness MCP setup

Selfwright's MCP server (`apps/mcp/`) exposes the same 7 tools as the CLI
(`score`, `ats`, `tailor`, `cover`, `research`, `inbox`, `scan`) over the stdio
transport. The server is spawned by `pnpm mcp` from the repo root.

All three harnesses below connect to the **same server** — no code changes required.

---

## Claude Code (already wired)

Claude Code picks up project-level MCP servers from `.claude/settings.json`.
The `selfwright` server is already configured there — run `claude` from the repo
root and the tools are available immediately.

---

## Cursor

Cursor reads MCP servers from `.cursor/mcp.json` (project) or
`~/.cursor/mcp.json` (global, all projects). The project-level file is already
checked in at [`.cursor/mcp.json`](../.cursor/mcp.json).

**Config format:**

```json
{
  "mcpServers": {
    "selfwright": {
      "command": "pnpm",
      "args": ["mcp"],
      "env": {
        "SELFWRIGHT_DATA_DIR": "<absolute-path-to-Selfwright-data>"
      }
    }
  }
}
```

**Steps:**
1. Open Cursor Settings → Tools & MCP — the `selfwright` server should appear
   automatically once the project file exists.
2. Set `SELFWRIGHT_DATA_DIR` in the `env` block (or in your shell profile so
   Cursor inherits it) to the absolute path of your Selfwright-data clone.
3. Click "Enable" next to `selfwright` in the MCP panel.

**Caveats:**
- Cursor enforces a **40-tool limit per server**. Selfwright currently has 7
  tools — well under the cap.
- The SKILL.md auto-invoke descriptions are Claude Code-specific; in Cursor,
  reference tools explicitly via the MCP panel or ask the agent to call a named
  tool.

---

## OpenCode

OpenCode reads MCP servers from `opencode.json` (project root) or
`~/.config/opencode/opencode.json` (global). Configs at all locations **merge**
(they are not replaced), so a global config carries across all projects.

**Project-level config (`opencode.json`):**

```json
{
  "mcp": {
    "selfwright": {
      "type": "local",
      "command": ["pnpm", "mcp"],
      "enabled": true,
      "environment": {
        "SELFWRIGHT_DATA_DIR": "<absolute-path-to-Selfwright-data>"
      }
    }
  }
}
```

**Steps:**
1. Copy the snippet above into `opencode.json` at the Selfwright repo root (or
   `~/.config/opencode/opencode.json` for global availability).
2. Set `SELFWRIGHT_DATA_DIR` in the `environment` block.
3. Start OpenCode — the `selfwright` MCP server will be available as tools in
   the agent chat.

**Note:** Set `SELFWRIGHT_DATA_DIR` to an absolute path. If you check in
`opencode.json`, leave the value empty (as the `.cursor/mcp.json` pattern does)
and set the real path in your shell profile so OpenCode inherits it at launch.

---

## Verifying the connection

From any harness, ask the model:

> "List the tools available from the selfwright MCP server."

A working connection returns all 7 tools with their descriptions. If the server
fails to start, run `pnpm mcp` manually from the repo root to see the error.

---

## Full local stack (Ollama + Postgres + mem0)

T2.6-T2.8 add three optional local services — Ollama (local inference, ADR 0008), Postgres +
pgvector (semantic projection, ADR 0009), and mem0 (memory, ADR 0010). All three are opt-in:
every tool above keeps working with none of them running.

```bash
docker compose -f infra/docker-compose.yml up postgres ollama mem0 -d
docker exec selfwright-ollama-1 ollama pull nomic-embed-text
docker exec selfwright-ollama-1 ollama pull llama3.2:3b
pnpm sync-db
# Verify memory via MCP tool: call memory_add from any harness
```

- `SELFWRIGHT_POSTGRES_URL` and `SELFWRIGHT_MEMORY_URL` (see `.env.example`) must be set for
  `pnpm sync-db` and the `memory_add`/`memory_search` MCP tools, respectively.
- `MEM0_SERVICE_TOKEN` and `SELFWRIGHT_MEMORY_TOKEN` are optional — set them to the same value to
  enable bearer-token auth between the MCP adapter and the mem0 service (off by default).
- `pnpm eval` (T2.6) gates whether `llama3.2:3b` is quality-equivalent enough to enable generation
  via `--adapter ollama` — embeddings (`nomic-embed-text`) have no such gate (D13).
