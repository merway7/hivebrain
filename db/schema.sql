CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('pattern', 'gotcha', 'principle', 'snippet', 'debug')),
  tags TEXT NOT NULL DEFAULT '[]',
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  why TEXT,
  gotchas TEXT DEFAULT '[]',
  learned_from TEXT,
  submitted_by TEXT DEFAULT 'anonymous',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  upvotes INTEGER DEFAULT 0,

  -- Structured metadata for fast faceted search
  language TEXT,                          -- primary language: "python", "javascript", "rust", "go", etc.
  framework TEXT,                         -- framework if relevant: "react", "nextjs", "django", "astro", etc.
  environment TEXT DEFAULT '[]',          -- JSON array: ["macos", "linux", "docker", "ci-cd", "browser"]
  error_messages TEXT DEFAULT '[]',       -- JSON array of exact error strings people would search for
  keywords TEXT DEFAULT '[]',             -- JSON array of extracted searchable terms beyond tags
  severity TEXT DEFAULT 'moderate' CHECK(severity IN ('critical', 'major', 'moderate', 'minor', 'tip')),
  context TEXT,                           -- when/where this applies: "during deployment", "at build time", etc.
  code_snippets TEXT DEFAULT '[]',        -- JSON array of {lang, code, description} objects
  related_entries TEXT DEFAULT '[]',      -- JSON array of related entry IDs
  version_info TEXT                       -- version constraints: "React 18+", "Python 3.7+", "Node 16+", etc.
);

-- Indexes for fast faceted filtering
CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);
CREATE INDEX IF NOT EXISTS idx_entries_language ON entries(language);
CREATE INDEX IF NOT EXISTS idx_entries_framework ON entries(framework);
CREATE INDEX IF NOT EXISTS idx_entries_severity ON entries(severity);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);

-- Full-text search index — 10 searchable fields including tags, language, framework
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title, problem, solution, why,
  error_messages, keywords, context,
  tags, language, framework,
  content='entries', content_rowid='id'
);

-- Auto-sync FTS index on insert/update/delete
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, problem, solution, why, error_messages, keywords, context, tags, language, framework)
  VALUES (new.id, new.title, new.problem, new.solution, new.why, new.error_messages, new.keywords, new.context, new.tags, new.language, new.framework);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, problem, solution, why, error_messages, keywords, context, tags, language, framework)
  VALUES ('delete', old.id, old.title, old.problem, old.solution, old.why, old.error_messages, old.keywords, old.context, old.tags, old.language, old.framework);
  INSERT INTO entries_fts(rowid, title, problem, solution, why, error_messages, keywords, context, tags, language, framework)
  VALUES (new.id, new.title, new.problem, new.solution, new.why, new.error_messages, new.keywords, new.context, new.tags, new.language, new.framework);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, problem, solution, why, error_messages, keywords, context, tags, language, framework)
  VALUES ('delete', old.id, old.title, old.problem, old.solution, old.why, old.error_messages, old.keywords, old.context, old.tags, old.language, old.framework);
END;

-- Analytics: track individual views
CREATE TABLE IF NOT EXISTS analytics_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  source TEXT DEFAULT 'web',  -- 'web', 'mcp', 'api'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Analytics: track searches
CREATE TABLE IF NOT EXISTS analytics_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  result_count INTEGER DEFAULT 0,
  source TEXT DEFAULT 'web',  -- 'web', 'mcp', 'api'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_analytics_views_entry ON analytics_views(entry_id);
CREATE INDEX IF NOT EXISTS idx_analytics_views_created ON analytics_views(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_searches_created ON analytics_searches(created_at);
