<p align="center">
  <h1 align="center">HiveBrain</h1>
  <p align="center"><strong>Local-first knowledge base for developer teams.</strong></p>
  <p align="center"><em>Every bug you fix teaches the next session what to do.</em></p>
</p>

---

**HiveBrain** is a self-hosted knowledge base that captures patterns, gotchas, debug solutions, and code snippets — then makes them instantly searchable via a web UI, REST API, and native Claude Code tools. It runs on your machine, stores everything in SQLite, and wires into Claude Code as an MCP server so every AI session can search and contribute to shared knowledge. Zero cloud, zero accounts, zero latency.

[Getting Started](#getting-started) · [API Reference](#api-reference) · [MCP Tools](#mcp-tools) · [Search](#how-search-works) · [Database](#database) · [Architecture](#architecture) · [Development](#development) · [Troubleshooting](#troubleshooting)

---

## Getting Started

**Runtime: Node 18+**

```bash
git clone <repo-url>
cd hivebrain
./setup.sh
```

The setup script handles everything:

1. Installs HiveBrain and MCP server dependencies
2. Compiles the MCP server (TypeScript → JavaScript)
3. Registers `hivebrain` in Claude Code's `~/.claude/settings.json`
4. Creates a launchd plist to auto-start on login (macOS)
5. Starts HiveBrain at `localhost:4321`

Open a new Claude Code session. `hivebrain_search`, `hivebrain_submit`, and `hivebrain_get` are available as native tools.

> **Already have `~/.claude/settings.json`?** The setup script merges — it only touches the `mcpServers.hivebrain` key. Your existing plugins, hooks, and settings are untouched. Running `setup.sh` twice is safe (idempotent).

### What you need

| Requirement | For what |
|---|---|
| **Node.js 18+** | Everything |
| **Claude Code** | MCP tools (web UI and API work without it) |
| **macOS** | Auto-start via launchd (on Linux, start manually or write a systemd unit) |
| **Docker** | Only for running the test suite |

## Architecture

```
┌──────────────────────────────────────────────────┐
│                   Your Machine                    │
│                                                   │
│  ┌─────────────┐         ┌─────────────────────┐ │
│  │ Claude Code  │◄──MCP──►│  MCP Server (stdio) │ │
│  │   Session    │         │  hivebrain_search   │ │
│  │              │         │  hivebrain_submit   │ │
│  │              │         │  hivebrain_get      │ │
│  └─────────────┘         └────────┬────────────┘ │
│                                   │ HTTP          │
│                                   ▼               │
│                          ┌────────────────┐       │
│  ┌─────────────┐         │   Astro Server │       │
│  │  Browser UI  │◄──HTTP──│  localhost:4321│       │
│  │ localhost:4321│        │                │       │
│  └─────────────┘         └───────┬────────┘       │
│                                  │                │
│                                  ▼                │
│                         ┌──────────────┐          │
│                         │    SQLite     │          │
│                         │  FTS5 + WAL  │          │
│                         │ hivebrain.db │          │
│                         └──────────────┘          │
└──────────────────────────────────────────────────┘
```

**MCP Server** communicates with Claude Code over stdio (Model Context Protocol). It translates tool calls into HTTP requests to the Astro dev server, which reads/writes the SQLite database. The browser UI hits the same Astro server directly. Everything is local — no network calls leave your machine.

## API Reference

Base URL: `http://localhost:4321`

All endpoints return `Content-Type: application/json`. Empty fields (`null`, `[]`, `""`) are stripped from responses to minimize payload size.

---

### `GET /api/search`

Full-text search across all entries.

**Parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | `string` | Yes | Search query — error messages, concepts, tool names |
| `full` | `"true"` | No | Return complete entries instead of compact results |

**Response (compact mode)**

```json
{
  "query": "react hydration",
  "count": 2,
  "results": [
    {
      "id": 11,
      "title": "Fix: React hydration mismatch errors",
      "category": "gotcha",
      "language": "javascript",
      "framework": "react",
      "severity": "major",
      "tags": ["react", "ssr", "hydration", "nextjs", "remix"],
      "error_messages": ["Hydration failed because the initial UI does not match"],
      "problem_snippet": "React throws 'Hydration failed because the initial UI does not match...",
      "url": "/api/entry/11"
    }
  ],
  "hint": "Use /api/entry/{id} for full details. Add &full=true to get complete entries inline."
}
```

**Response (`full=true`)**

Returns a flat array of complete entry objects. See [Entry Object](#entry-object) for the full shape.

```json
[
  {
    "id": 11,
    "title": "Fix: React hydration mismatch errors",
    "category": "gotcha",
    "tags": ["react", "ssr", "hydration", "nextjs", "remix", "..."],
    "problem": "React throws 'Hydration failed because...' (full text)",
    "solution": "Multiple strategies depending on the cause... (full text)",
    "why": "React SSR hydration works by comparing...",
    "gotchas": ["useEffect runs ONLY on the client...", "..."],
    "error_messages": ["Hydration failed because the initial UI does not match", "..."],
    "keywords": ["server-side-rendering", "..."],
    "language": "javascript",
    "framework": "react",
    "severity": "major",
    "environment": ["browser", "nodejs", "ssr"],
    "created_at": 1771789802
  }
]
```

**Status codes:** `200` success, `400` missing `q` parameter, `500` internal error.

---

### `GET /api/entry/:id`

Fetch a single entry by ID.

**Parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `id` | `integer` | Yes | Entry ID (path parameter) |
| `fields` | `string` | No | Comma-separated field names to return. `id` and `title` are always included. |

**Response**

Returns a complete [Entry Object](#entry-object).

**Response (with `?fields=solution,gotchas`)**

```json
{
  "id": 11,
  "title": "Fix: React hydration mismatch errors",
  "solution": "Multiple strategies depending on the cause...",
  "gotchas": ["useEffect runs ONLY on the client...", "..."]
}
```

**Status codes:** `200` success, `400` invalid ID, `404` not found, `500` internal error.

---

### `GET /api/entries`

List and filter entries. Supports offset-based and cursor-based pagination.

**Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `category` | `string` | — | Filter: `pattern`, `gotcha`, `principle`, `snippet`, `debug` |
| `tag` | `string` | — | Filter by exact tag match |
| `language` | `string` | — | Filter: `python`, `javascript`, `typescript`, `rust`, `go`, `java`, `c`, `cpp`, `csharp`, `ruby`, `php`, `swift`, `kotlin`, `sql`, `css`, `html`, `bash`, `yaml`, `toml`, `shell` |
| `framework` | `string` | — | Filter: `react`, `nextjs`, `remix`, `vue`, `nuxt`, `svelte`, `sveltekit`, `angular`, `django`, `flask`, `fastapi`, `express`, `nestjs`, `hono`, `fastify`, `rails`, `spring`, `laravel`, `gin`, `echo`, `actix`, `astro`, `gatsby`, `eleventy`, `hugo`, `playwright`, `jest`, `pytest`, `vitest`, `cypress`, `docker`, `kubernetes`, `terraform`, `tailwind`, `bootstrap`, `prisma`, `drizzle`, `sequelize`, `sqlalchemy`, `git` |
| `severity` | `string` | — | Filter: `critical`, `major`, `moderate`, `minor`, `tip` |
| `environment` | `string` | — | Filter: `macos`, `linux`, `windows`, `docker`, `ci-cd`, `browser`, `nodejs`, `ssr`, `edge`, `mobile`, `terminal`, `claude-code`, `ide`, `editor` |
| `limit` | `integer` | `50` | Max results per page |
| `offset` | `integer` | `0` | Skip N results (offset pagination) |
| `cursor` | `integer` | — | Entry ID from `next_cursor` (cursor pagination — preferred for large datasets) |
| `full` | `"true"` | — | Return complete entries instead of compact |
| `stats` | `"true"` | — | Include aggregate stats object |

**Response (compact mode)**

```json
{
  "count": 3,
  "entries": [
    {
      "id": 11,
      "title": "Fix: React hydration mismatch errors",
      "category": "gotcha",
      "language": "javascript",
      "framework": "react",
      "severity": "major",
      "tags": ["react", "ssr", "hydration", "nextjs", "remix"],
      "problem_snippet": "React throws 'Hydration failed because the initial UI does not match...",
      "url": "/api/entry/11"
    }
  ],
  "next_cursor": 8,
  "hint": "Use /api/entry/{id} for full details. Add &full=true to get complete entries inline."
}
```

`next_cursor` is only present when there are more results. Pass it as `?cursor=8` to get the next page.

**Response (`stats=true`)** adds:

```json
{
  "stats": {
    "total": 15,
    "byCategory": [{ "category": "gotcha", "count": 6 }, "..."],
    "tagCounts": { "react": 3, "python": 4, "..." : "..." },
    "languageCounts": { "javascript": 5, "python": 4 },
    "frameworkCounts": { "react": 3, "playwright": 2 },
    "severityCounts": { "major": 4, "moderate": 6 },
    "environmentCounts": { "macos": 5, "nodejs": 4 }
  }
}
```

**Status codes:** `200` success, `400` invalid params, `500` internal error.

---

### `POST /api/submit`

Create a new entry. Rate limited to **10 requests per hour** per IP.

**Request body**

```json
{
  "title": "SQLite FTS5 tokenizer ignores hyphens in compound words",
  "category": "gotcha",
  "problem": "Searching for 'server-side' in FTS5 matches 'server' and 'side' separately but not the compound term, leading to false positives.",
  "solution": "Use phrase queries with double quotes in FTS5: '\"server side\"' (without hyphen). For exact hyphenated matching, add a LIKE fallback layer that searches raw text.",
  "severity": "moderate",
  "tags": ["sqlite", "fts5", "search", "text-processing"],
  "keywords": ["tokenizer", "hyphen", "compound words", "phrase query", "full text search"],
  "error_messages": [],
  "language": "sql",
  "why": "FTS5's default tokenizer splits on all non-alphanumeric characters.",
  "gotchas": ["This also affects underscores and dots in version numbers"],
  "environment": ["nodejs"],
  "context": "When building search features on top of SQLite FTS5",
  "version_info": "SQLite 3.35+",
  "code_snippets": [
    {
      "code": "SELECT * FROM entries_fts WHERE entries_fts MATCH '\"server side\"'",
      "lang": "sql",
      "description": "Phrase query that matches the compound term"
    }
  ],
  "related_entries": [3, 7]
}
```

**Required fields**

| Field | Type | Constraints |
|---|---|---|
| `title` | `string` | Min 10 characters |
| `category` | `string` | `"pattern"` \| `"gotcha"` \| `"principle"` \| `"snippet"` \| `"debug"` |
| `problem` | `string` | Min 50 characters |
| `solution` | `string` | Min 80 characters |
| `severity` | `string` | `"critical"` \| `"major"` \| `"moderate"` \| `"minor"` \| `"tip"` |
| `tags` | `string[]` | Min 3 items |
| `keywords` | `string[]` | Min 3 items — search terms beyond tags (synonyms, related concepts) |
| `error_messages` | `string[]` | **Required** for `gotcha` and `debug` categories. Exact error strings. |

**Optional fields**

| Field | Type | Description |
|---|---|---|
| `language` | `string` | Primary language (see `GET /api/entries` for valid values) |
| `framework` | `string` | Framework if relevant (see `GET /api/entries` for valid values) |
| `why` | `string` | Root cause explanation |
| `gotchas` | `string[]` | Edge cases, common mistakes |
| `environment` | `string[]` | Where this applies (see `GET /api/entries` for valid values) |
| `context` | `string` | When this happens: `"during deployment"`, `"at build time"` |
| `version_info` | `string` | Version constraints: `"React 18+"`, `"Python 3.10+"` |
| `code_snippets` | `object[]` | Array of `{ code: string, lang?: string, description?: string }` |
| `related_entries` | `integer[]` | IDs of related entries |
| `learned_from` | `string` | Where this was discovered |
| `submitted_by` | `string` | Who submitted this (default: `"anonymous"`) |

**Response (success — `201`)**

```json
{
  "id": 16,
  "status": "created",
  "url": "/api/entry/16",
  "warnings": [
    { "field": "why", "suggestion": "Explain the root cause. Makes the entry much more useful." }
  ]
}
```

Warnings are non-blocking suggestions for improving the entry. The entry is created regardless.

**Response (validation error — `400`)**

```json
{
  "error": "Submission rejected",
  "issues": [
    { "field": "title", "issue": "Required, min 10 chars. Current: 5" },
    { "field": "tags", "issue": "Min 3 tags required (got 1). Include: language, topic, tools." }
  ],
  "warnings": [
    { "field": "why", "suggestion": "Explain the root cause. Makes the entry much more useful." }
  ],
  "hint": "Focus on metadata: tags, keywords, error_messages. These make entries findable.",
  "token_budget": {
    "problem": "50-300 chars",
    "solution": "80-500 chars",
    "tags": "3+ strings",
    "keywords": "3+ strings (search terms beyond tags)",
    "error_messages": "exact error strings (required for gotcha/debug)"
  }
}
```

**Status codes:** `201` created, `400` validation error, `429` rate limited, `500` internal error.

---

### Entry Object

The complete shape of an entry as returned by `GET /api/entry/:id` and full-mode responses. Fields with empty values (`null`, `[]`, `""`) are omitted.

| Field | Type | Description |
|---|---|---|
| `id` | `integer` | Auto-incrementing primary key |
| `title` | `string` | Descriptive title |
| `category` | `string` | `pattern`, `gotcha`, `principle`, `snippet`, `debug` |
| `tags` | `string[]` | Searchable tags |
| `problem` | `string` | What goes wrong |
| `solution` | `string` | How to fix it |
| `why` | `string` | Root cause explanation |
| `gotchas` | `string[]` | Edge cases and common mistakes |
| `error_messages` | `string[]` | Exact error strings for search matching |
| `keywords` | `string[]` | Additional search terms beyond tags |
| `language` | `string` | Primary programming language |
| `framework` | `string` | Framework if applicable |
| `severity` | `string` | `critical`, `major`, `moderate`, `minor`, `tip` |
| `environment` | `string[]` | Where this applies (`macos`, `docker`, `ci-cd`, etc.) |
| `context` | `string` | When/where this happens |
| `version_info` | `string` | Version constraints |
| `code_snippets` | `object[]` | `{ code, lang?, description? }` objects |
| `related_entries` | `integer[]` | IDs of related entries |
| `learned_from` | `string` | Origin context |
| `submitted_by` | `string` | Author (default: `"anonymous"`) |
| `created_at` | `integer` | Unix timestamp |
| `upvotes` | `integer` | Community votes (omitted when `0`) |

---

## MCP Tools

The MCP server exposes three tools to Claude Code over stdio. After `setup.sh`, they appear in every session.

### `hivebrain_search`

Search the knowledge base.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Error messages, concepts, tool names |

Returns formatted markdown with full entry details for each match. Returns a helpful error message (not a crash) if HiveBrain is offline.

### `hivebrain_submit`

Submit a new entry. Accepts the same fields as `POST /api/submit` — see [Submit entry](#post-apisubmit) for the full schema. Returns the created entry ID on success, or structured validation errors.

### `hivebrain_get`

Fetch a complete entry by ID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `integer` | Yes | Entry ID |

Returns formatted markdown with all entry fields.

### Offline handling

All three tools catch connection errors and return descriptive messages:

- **Connection refused** → `"HiveBrain is offline. Start it with: cd ~/local_AI/hivebrain && npm run dev"`
- **Timeout (5s)** → `"HiveBrain is not responding (timeout). Is it running at localhost:4321?"`

### Teaching Claude when to use them

Add the contents of `CLAUDE_SNIPPET.md` to your project's `CLAUDE.md`. This tells Claude:

- **Search** when encountering unfamiliar errors, debugging, or entering an unfamiliar codebase area
- **Submit** after solving non-trivial bugs, discovering gotchas, or establishing reusable patterns
- **Don't submit** trivial fixes, obvious solutions, or one-off config changes

## How Search Works

Search is not a single query. It's a multi-layer ranking system that combines results from independent strategies, scores them, and returns the best matches.

### Layers (in order of precedence)

| Layer | Strategy | Score | Details |
|---|---|---|---|
| 1a | FTS5 AND query (exact terms) | 100 | `"react" AND "hydration"` — highest precision |
| 1b | FTS5 AND with synonym expansion | 95 | `("js" OR "javascript") AND "hydration"` |
| 1c | FTS5 prefix AND | 85 | `react* AND hydrat*` — partial word matching |
| 1d | FTS5 single term + synonyms | 90/85 | For single-word queries |
| 1e | FTS5 OR fallback | 20–45 | Only when AND yields <3 results. Scored by match ratio. |
| 2 | Exact tag match | 30–80 | Per-term, scored by how many terms match across tags/keywords/meta |
| 3 | Language/framework column | 30–80 | Same multi-term scoring as tags |
| 4 | Error message substring | 75–90 | `LIKE '%error string%'` — critical for pasted errors |
| 5 | Keyword + environment match | 30–80 | JSON array search |
| 6 | Broad LIKE fallback | 30 | Last resort, only fires when <3 results from all above |

### Post-processing

1. **Deduplication** — same entry from multiple layers keeps the highest score
2. **Title boost** — entries where search terms appear in the title get +15 to their score
3. **Noise filtering** — results scoring below 40% of the top result are dropped
4. **Limit** — max 50 results, sorted by score descending

### Synonym expansion

Built-in synonym map handles common abbreviations:

| Input | Also matches |
|---|---|
| `js` | `javascript` |
| `ts` | `typescript` |
| `py` | `python` |
| `k8s` | `kubernetes` |
| `next` | `nextjs`, `next.js` |
| `node` | `nodejs`, `node.js` |
| `auth` | `authentication`, `authorization` |
| `db` | `database` |
| `ssr` | `server side rendering` |
| `ci` | `continuous integration` |

Full list: 40+ mappings in `src/lib/db.ts`.

### FTS5 field weights

BM25 scoring with custom weights (higher = more important):

| Field | Weight |
|---|---|
| `title` | 10.0 |
| `problem` | 5.0 |
| `solution` | 5.0 |
| `why` | 2.0 |
| `error_messages` | 3.0 |
| `keywords` | 3.0 |
| `context` | 2.0 |
| `tags` | 4.0 |
| `language` | 4.0 |
| `framework` | 4.0 |

## Database

SQLite with WAL mode. Stored at `db/hivebrain.db`.

### Schema

```sql
CREATE TABLE entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL CHECK(category IN ('pattern','gotcha','principle','snippet','debug')),
  tags            TEXT NOT NULL DEFAULT '[]',        -- JSON string[]
  problem         TEXT NOT NULL,
  solution        TEXT NOT NULL,
  why             TEXT,
  gotchas         TEXT DEFAULT '[]',                 -- JSON string[]
  learned_from    TEXT,
  submitted_by    TEXT DEFAULT 'anonymous',
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  upvotes         INTEGER DEFAULT 0,
  language        TEXT,
  framework       TEXT,
  severity        TEXT DEFAULT 'moderate' CHECK(severity IN ('critical','major','moderate','minor','tip')),
  environment     TEXT DEFAULT '[]',                 -- JSON string[]
  error_messages  TEXT DEFAULT '[]',                 -- JSON string[]
  keywords        TEXT DEFAULT '[]',                 -- JSON string[]
  context         TEXT,
  code_snippets   TEXT DEFAULT '[]',                 -- JSON {code,lang?,description?}[]
  related_entries TEXT DEFAULT '[]',                 -- JSON integer[]
  version_info    TEXT
);
```

### Indexes

- `idx_entries_category` — fast category filtering
- `idx_entries_language` — fast language filtering
- `idx_entries_framework` — fast framework filtering
- `idx_entries_severity` — fast severity filtering
- `idx_entries_created_at` — chronological ordering

### FTS5 virtual table

`entries_fts` indexes 10 fields for full-text search. Auto-synced via `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers — no manual reindex needed.

### Seed data

```bash
npm run seed
```

## Project Structure

```
hivebrain/
├── src/
│   ├── pages/
│   │   ├── index.astro              # Web UI — browse, search, filter
│   │   ├── entry/[id].astro         # Entry detail page
│   │   └── api/
│   │       ├── search.ts            # GET /api/search
│   │       ├── submit.ts            # POST /api/submit (validation + rate limiting)
│   │       ├── entries.ts           # GET /api/entries (list + filter + paginate)
│   │       └── entry/[id].ts        # GET /api/entry/:id (detail + field filtering)
│   ├── components/
│   │   ├── Header.astro
│   │   ├── SearchBar.astro
│   │   ├── FilterBar.astro
│   │   ├── EntryCard.astro
│   │   └── Stats.astro
│   └── lib/
│       ├── db.ts                    # SQLite connection, queries, multi-layer FTS5 search
│       └── api-utils.ts             # JSON responses, field parsing, token-efficient stripping
├── db/
│   ├── schema.sql                   # Table + FTS5 + triggers + indexes
│   ├── seed.js                      # Seed data
│   ├── hivebrain.db                 # SQLite database (WAL mode)
│   └── migrate-*.js                 # Migration scripts
├── mcp-server/
│   ├── index.ts                     # MCP server — 3 tools over stdio
│   ├── package.json                 # @modelcontextprotocol/sdk, zod
│   ├── tsconfig.json
│   └── dist/                        # Compiled output (generated by npm run build)
├── setup.sh                         # One-command setup for new users
├── CLAUDE_SNIPPET.md                # Ready-to-copy CLAUDE.md instructions
├── Dockerfile.test                  # Clean test environment
└── test-setup.sh                    # Automated test suite (Docker)
```

## Development

```bash
npm run dev          # Start dev server at localhost:4321
npm run build        # Production build to ./dist/
npm run preview      # Preview production build
npm run seed         # Populate database with example entries
```

### MCP server

```bash
cd mcp-server
npm install          # Install MCP SDK + zod
npm run build        # Compile TypeScript to dist/
npm start            # Run standalone (for testing)
```

### Manual MCP protocol test

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n' \
  | node mcp-server/dist/index.js
```

Should return `{"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"hivebrain","version":"1.0.0"}},"jsonrpc":"2.0","id":1}`.

## Auto-Start (macOS)

`setup.sh` creates a launchd plist at `~/Library/LaunchAgents/com.local.hivebrain.plist`:

- Starts HiveBrain on login
- Restarts on crash (`KeepAlive: true`)
- Logs stdout and stderr to `/tmp/hivebrain.log`

### Manual control

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.local.hivebrain.plist

# Start
launchctl load ~/Library/LaunchAgents/com.local.hivebrain.plist

# Check status
launchctl list | grep hivebrain

# Tail logs
tail -f /tmp/hivebrain.log
```

### Linux

No launchd. Create a systemd unit or start manually:

```bash
cd hivebrain && npm run dev
```

## Testing

Run the full test suite in a clean Docker container:

```bash
./test-setup.sh
```

Builds from `node:22-slim` + Claude Code (nothing else pre-installed) and verifies:

| Test | What it checks |
|---|---|
| Clean slate | No `~/.claude` directory exists before setup |
| Setup completes | `setup.sh` exits 0 on fresh machine |
| MCP server compiles | `dist/index.js` exists after build |
| Settings created | `~/.claude/settings.json` created from scratch with valid JSON |
| MCP protocol | Server responds to `initialize` handshake |
| All tools registered | `hivebrain_search`, `hivebrain_submit`, `hivebrain_get` in `tools/list` |
| Offline handling | Returns helpful error when HiveBrain is down |
| API works | `GET /api/search` and `GET /api/entry/:id` respond correctly |
| End-to-end | MCP tool calls go through to live HiveBrain and return data |
| Idempotent | Re-running `setup.sh` doesn't duplicate config entries |
| Settings merge | Existing `settings.json` config preserved when adding hivebrain |

## Troubleshooting

### HiveBrain won't start

```bash
# Check if port 4321 is in use
lsof -i :4321

# Check launchd status
launchctl list | grep hivebrain

# Check logs
tail -50 /tmp/hivebrain.log

# Manual start (bypass launchd)
cd hivebrain && npm run dev
```

### MCP tools not appearing in Claude Code

```bash
# Verify settings.json has the entry
cat ~/.claude/settings.json | grep hivebrain

# Verify the built file exists
ls -la hivebrain/mcp-server/dist/index.js

# Test the MCP server manually
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n' \
  | node hivebrain/mcp-server/dist/index.js
```

MCP servers are loaded when Claude Code starts. **You must open a new session** after running `setup.sh`.

### Search returns no results

```bash
# Check if the database has entries
sqlite3 db/hivebrain.db "SELECT count(*) FROM entries;"

# Check if FTS index is populated
sqlite3 db/hivebrain.db "SELECT count(*) FROM entries_fts;"

# If FTS is empty, rebuild it
sqlite3 db/hivebrain.db "INSERT INTO entries_fts(entries_fts) VALUES('rebuild');"

# Seed example data
npm run seed
```

### Rate limited on submit

The submit endpoint allows **10 requests per hour** per IP. Wait for the window to reset, or restart the server to clear the in-memory counter.

### Database locked errors

SQLite is in WAL mode, which supports concurrent reads + one writer. If you see `SQLITE_BUSY`:

```bash
# Check for lingering connections
lsof db/hivebrain.db

# WAL checkpoint (merges WAL back into main db)
sqlite3 db/hivebrain.db "PRAGMA wal_checkpoint(TRUNCATE);"
```
