import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "hivebrain.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

console.log("=== HiveBrain Migration v2 ===\n");

// ---------------------------------------------------------------------------
// 1. Add new columns (catch errors for columns that already exist)
// ---------------------------------------------------------------------------
const newColumns = [
  "language TEXT",
  "framework TEXT",
  "environment TEXT DEFAULT '[]'",
  "error_messages TEXT DEFAULT '[]'",
  "keywords TEXT DEFAULT '[]'",
  "severity TEXT DEFAULT 'moderate'",
  "context TEXT",
  "code_snippets TEXT DEFAULT '[]'",
  "related_entries TEXT DEFAULT '[]'",
  "version_info TEXT",
];

for (const col of newColumns) {
  const colName = col.split(" ")[0];
  try {
    db.exec("ALTER TABLE entries ADD COLUMN " + col);
    console.log("  + Added column: " + colName);
  } catch (e) {
    if (e.message.includes("duplicate column")) {
      console.log("  ~ Column already exists: " + colName);
    } else {
      throw e;
    }
  }
}
console.log("");

// ---------------------------------------------------------------------------
// 2. Create indexes (IF NOT EXISTS)
// ---------------------------------------------------------------------------
const indexes = [
  "CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category)",
  "CREATE INDEX IF NOT EXISTS idx_entries_language ON entries(language)",
  "CREATE INDEX IF NOT EXISTS idx_entries_framework ON entries(framework)",
  "CREATE INDEX IF NOT EXISTS idx_entries_severity ON entries(severity)",
  "CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC)",
];

for (const sql of indexes) {
  db.exec(sql);
}
console.log("  + Created indexes\n");

// ---------------------------------------------------------------------------
// 3. Drop and recreate FTS table with new fields
// ---------------------------------------------------------------------------

// Drop old triggers
for (const name of ["entries_ai", "entries_au", "entries_ad"]) {
  db.exec("DROP TRIGGER IF EXISTS " + name);
}
console.log("  + Dropped old triggers");

// Drop old FTS table
db.exec("DROP TABLE IF EXISTS entries_fts");
console.log("  + Dropped old FTS table");

// Create new FTS5 table
db.exec([
  "CREATE VIRTUAL TABLE entries_fts USING fts5(",
  "  title, problem, solution, why, error_messages, keywords, context,",
  "  content='entries', content_rowid='id'",
  ")",
].join("\n"));
console.log("  + Created new FTS5 table");

// NOTE: Triggers are created AFTER data updates to avoid SQLITE_CORRUPT_VTAB
// errors caused by the update trigger trying to delete non-existent FTS rows.
console.log("  (triggers will be created after data updates)\n");

// ---------------------------------------------------------------------------
// 4. Update all 11 existing entries with metadata
// ---------------------------------------------------------------------------

const updateStmt = db.prepare([
  "UPDATE entries SET",
  "  language = @language,",
  "  framework = @framework,",
  "  environment = @environment,",
  "  error_messages = @error_messages,",
  "  keywords = @keywords,",
  "  severity = @severity,",
  "  context = @context,",
  "  code_snippets = @code_snippets,",
  "  related_entries = @related_entries,",
  "  version_info = @version_info",
  "WHERE id = @id",
].join("\n"));

const S = JSON.stringify;

const metadata = [
  {
    id: 1,
    language: "python",
    framework: null,
    environment: S(["macos", "linux", "docker", "ci-cd"]),
    error_messages: S([
      "_curses.error: setupterm: could not find terminal",
      "Error opening terminal: unknown",
      "isatty() returned False",
      "_curses.error: cbreak() returned ERR",
    ]),
    keywords: S(["tty", "pty", "pseudo-terminal", "ncurses", "initscr", "termios", "non-interactive", "headless"]),
    severity: "major",
    context: "Running TUI apps in non-interactive environments",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "Python 3.x, any Unix-like OS",
  },
  {
    id: 2,
    language: "javascript",
    framework: null,
    environment: S(["browser"]),
    error_messages: S(["QuotaExceededError", "Failed to execute setItem on Storage"]),
    keywords: S(["persistence", "offline", "state-management", "IndexedDB", "sessionStorage", "client-side-storage", "JSON", "backup", "export"]),
    severity: "tip",
    context: "Building local-first web apps without a backend",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "All modern browsers, ~5-10MB limit",
  },
  {
    id: 3,
    language: null,
    framework: null,
    environment: S(["claude-code", "ide", "editor"]),
    error_messages: S(["old_string not found", "Edit failed: no match", "Multiple matches found"]),
    keywords: S(["find-and-replace", "string-matching", "whitespace", "indentation", "tabs-vs-spaces", "code-editing", "tooling"]),
    severity: "critical",
    context: "Using AI code editing tools (Claude Code, Cursor, Copilot)",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "Any Edit/Replace tool",
  },
  {
    id: 4,
    language: "javascript",
    framework: null,
    environment: S(["browser", "web"]),
    error_messages: S(["CORS policy", "Mixed Content", "net::ERR_BLOCKED_BY_RESPONSE"]),
    keywords: S(["favicon", "icons", "google-s2", "duckduckgo", "proxy", "bookmark-manager", "speed-dial", "link-grid", "onerror", "fallback"]),
    severity: "minor",
    context: "Building bookmark managers, link grids, dashboards",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "All browsers, Google Favicon API",
  },
  {
    id: 5,
    language: "javascript",
    framework: "playwright",
    environment: S(["macos", "linux", "windows", "ci-cd", "docker"]),
    error_messages: S(["net::ERR_ACCESS_DENIED", "Protocol 'file' not allowed", "Navigation to file:// blocked"]),
    keywords: S(["screenshot", "automation", "headless-browser", "puppeteer", "chromium", "http-server", "localhost", "e2e-testing", "pdf-generation"]),
    severity: "major",
    context: "Automating or testing local HTML files with Playwright/Puppeteer",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "Playwright 1.x+, Puppeteer, all Chromium-based",
  },
  {
    id: 6,
    language: "css",
    framework: null,
    environment: S(["browser", "web"]),
    error_messages: S([]),
    keywords: S(["design-tokens", "dark-mode", "light-mode", "theming", "custom-properties", "responsive", "color-system", "spacing-scale", "typography-scale"]),
    severity: "tip",
    context: "Establishing consistent design systems in web apps",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "All modern browsers (97%+ support), NOT IE11",
  },
  {
    id: 7,
    language: null,
    framework: null,
    environment: S(["claude-code", "ide", "terminal", "git"]),
    error_messages: S([]),
    keywords: S(["data-loss", "destructive", "rm-rf", "git-reset-hard", "force-push", "archive", "safety", "backup", "irreversible"]),
    severity: "critical",
    context: "AI coding assistants handling file operations",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "Universal principle",
  },
  {
    id: 8,
    language: "python",
    framework: null,
    environment: S(["macos"]),
    error_messages: S(["error: command 'gcc' failed", "No module named psutil", "Failed building wheel for psutil"]),
    keywords: S(["cpu-usage", "memory-usage", "disk-space", "monitoring", "dashboard", "sysctl", "vm_stat", "os.statvfs", "subprocess", "system-info"]),
    severity: "moderate",
    context: "Building monitoring tools on macOS without C compiler",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "Python 3.x, macOS only (Linux has /proc/)",
  },
  {
    id: 9,
    language: "javascript",
    framework: null,
    environment: S(["browser", "web"]),
    error_messages: S([]),
    keywords: S(["vanilla-js", "no-build-step", "state-management", "event-delegation", "unidirectional-data-flow", "render-function", "DOM-manipulation", "prototype", "personal-tool"]),
    severity: "tip",
    context: "Building interactive tools in a single HTML file",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "Vanilla JS, no dependencies, all browsers",
  },
  {
    id: 10,
    language: null,
    framework: "git",
    environment: S(["terminal", "ci-cd", "claude-code"]),
    error_messages: S(["pre-commit hook failed", "husky - pre-commit hook exited with code 1"]),
    keywords: S(["pre-commit", "hook-failure", "amend", "commit", "force-push", "reflog", "SHA", "rebase", "history-rewrite"]),
    severity: "critical",
    context: "Recovering from pre-commit hook failures",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "Git 2.x+",
  },
  {
    id: 11,
    language: "javascript",
    framework: "react",
    environment: S(["browser", "nodejs", "ssr"]),
    error_messages: S([
      "Hydration failed because the initial UI does not match",
      "Text content does not match. Server: X Client: Y",
      "Expected server HTML to contain a matching",
      "There was an error while hydrating",
    ]),
    keywords: S(["server-side-rendering", "client-side-rendering", "useEffect", "useState", "dynamic-import", "suppressHydrationWarning", "useId", "streaming-ssr", "renderToPipeableStream"]),
    severity: "major",
    context: "Using React with SSR frameworks (Next.js, Remix, Gatsby)",
    code_snippets: S([]),
    related_entries: S([]),
    version_info: "React 18+, Next.js 13+, Remix 1+",
  },
];

const updateAll = db.transaction((entries) => {
  for (const entry of entries) {
    updateStmt.run(entry);
  }
});

updateAll(metadata);
console.log("  + Updated " + metadata.length + " entries with metadata\n");

// ---------------------------------------------------------------------------
// 5. Rebuild FTS index and create triggers
// ---------------------------------------------------------------------------
// Rebuild first (populates FTS from content table), then add triggers for future changes
db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')");
console.log("  + Rebuilt FTS index");

db.exec([
  "CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN",
  "  INSERT INTO entries_fts(rowid, title, problem, solution, why, error_messages, keywords, context)",
  "  VALUES (new.id, new.title, new.problem, new.solution, new.why, new.error_messages, new.keywords, new.context);",
  "END",
].join("\n"));

db.exec([
  "CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN",
  "  INSERT INTO entries_fts(entries_fts, rowid, title, problem, solution, why, error_messages, keywords, context)",
  "  VALUES ('delete', old.id, old.title, old.problem, old.solution, old.why, old.error_messages, old.keywords, old.context);",
  "  INSERT INTO entries_fts(rowid, title, problem, solution, why, error_messages, keywords, context)",
  "  VALUES (new.id, new.title, new.problem, new.solution, new.why, new.error_messages, new.keywords, new.context);",
  "END",
].join("\n"));

db.exec([
  "CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN",
  "  INSERT INTO entries_fts(entries_fts, rowid, title, problem, solution, why, error_messages, keywords, context)",
  "  VALUES ('delete', old.id, old.title, old.problem, old.solution, old.why, old.error_messages, old.keywords, old.context);",
  "END",
].join("\n"));
console.log("  + Created triggers\n");

// ---------------------------------------------------------------------------
// 6. Verification
// ---------------------------------------------------------------------------
console.log("=== Verification ===\n");

const cols = db.pragma("table_info(entries)").map((c) => c.name);
console.log("Columns (" + cols.length + "): " + cols.join(", "));
console.log("");

const rows = db.prepare([
  "SELECT id, title, language, framework, severity, context,",
  "       environment, error_messages, keywords, version_info",
  "FROM entries ORDER BY id",
].join("\n")).all();

for (const row of rows) {
  const envCount = JSON.parse(row.environment || "[]").length;
  const errCount = JSON.parse(row.error_messages || "[]").length;
  const kwCount = JSON.parse(row.keywords || "[]").length;
  console.log(
    "  #" + row.id + ' "' + row.title.slice(0, 40) + '..." ' +
    "lang=" + (row.language || "-") + " fw=" + (row.framework || "-") + " sev=" + row.severity + " " +
    "env=" + envCount + " errs=" + errCount + " kw=" + kwCount
  );
}

console.log("");

// Test FTS search
const ftsResult = db.prepare("SELECT rowid, title FROM entries_fts WHERE entries_fts MATCH 'hydration'").all();
console.log("FTS test (search 'hydration'): " + ftsResult.length + " result(s)");
if (ftsResult.length > 0) {
  console.log('  -> #' + ftsResult[0].rowid + ' "' + ftsResult[0].title + '"');
}

const ftsResult2 = db.prepare("SELECT rowid, title FROM entries_fts WHERE entries_fts MATCH 'QuotaExceededError'").all();
console.log("FTS test (search 'QuotaExceededError'): " + ftsResult2.length + " result(s)");
if (ftsResult2.length > 0) {
  console.log('  -> #' + ftsResult2[0].rowid + ' "' + ftsResult2[0].title + '"');
}

console.log("\n=== Migration v2 complete ===");

db.close();
