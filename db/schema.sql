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

-- Usage contexts: "how it helped"
CREATE TABLE IF NOT EXISTS usage_contexts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  context TEXT NOT NULL,
  submitted_by TEXT DEFAULT 'anonymous',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_usage_contexts_entry ON usage_contexts(entry_id);

-- Solution verifications: "tested on React 19, Node 22"
CREATE TABLE IF NOT EXISTS solution_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  verified_by TEXT NOT NULL,
  version_tested TEXT,
  environment TEXT,
  notes TEXT,
  verified_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_verifications_entry ON solution_verifications(entry_id);

-- Entry revisions
CREATE TABLE IF NOT EXISTS entry_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  revision_type TEXT NOT NULL,
  content TEXT NOT NULL,
  submitted_by TEXT DEFAULT 'anonymous',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_revisions_entry ON entry_revisions(entry_id);

-- Entry votes
CREATE TABLE IF NOT EXISTS entry_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  direction TEXT NOT NULL CHECK(direction IN ('up', 'down')),
  voter_ip TEXT,
  voter_name TEXT DEFAULT 'anonymous',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_votes_entry ON entry_votes(entry_id);

-- ── Phase 3: Reputation + Badges ──

-- Event-sourced reputation events
CREATE TABLE IF NOT EXISTS reputation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  event_type TEXT NOT NULL,
  points INTEGER NOT NULL,
  entry_id INTEGER,
  source_username TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_rep_events_username ON reputation_events(username);
CREATE INDEX IF NOT EXISTS idx_rep_events_created ON reputation_events(created_at);

-- Materialized reputation totals per user
CREATE TABLE IF NOT EXISTS reputation_cache (
  username TEXT PRIMARY KEY,
  total_rep INTEGER NOT NULL DEFAULT 0,
  entries_count INTEGER NOT NULL DEFAULT 0,
  upvotes_received INTEGER NOT NULL DEFAULT 0,
  usages_received INTEGER NOT NULL DEFAULT 0,
  verifications_received INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Badges earned by users
CREATE TABLE IF NOT EXISTS user_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  earned_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(username, badge_id)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_username ON user_badges(username);

-- ── Phase 4: Accounts + Notifications ──

-- Simple accounts (claim username via email verification)
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  verification_expires INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  type TEXT NOT NULL,
  entry_id INTEGER,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_notifications_username ON notifications(username);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(username, read);

-- Per-user notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
  username TEXT PRIMARY KEY,
  email_frequency TEXT NOT NULL DEFAULT 'daily',
  notify_upvotes INTEGER NOT NULL DEFAULT 1,
  notify_usages INTEGER NOT NULL DEFAULT 1,
  notify_verifications INTEGER NOT NULL DEFAULT 1,
  notify_revisions INTEGER NOT NULL DEFAULT 1,
  notify_badges INTEGER NOT NULL DEFAULT 1
);

-- ── Karpathy Features ──

-- Migration: ALTER TABLE entries ADD COLUMN surprise_score REAL DEFAULT 0;
-- Migration: ALTER TABLE entries ADD COLUMN success_rate REAL DEFAULT NULL;
-- Migration: ALTER TABLE entries ADD COLUMN retrieval_count INTEGER DEFAULT 0;

-- Embeddings for semantic search
CREATE TABLE IF NOT EXISTS entry_embeddings (
  entry_id INTEGER PRIMARY KEY REFERENCES entries(id),
  embedding TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'bag-of-words',
  dimensions INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Retrieval outcome tracking: "did this entry actually help?"
CREATE TABLE IF NOT EXISTS retrieval_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('helped', 'partially_helped', 'did_not_help', 'wrong')),
  task_context TEXT,
  agent_session TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_retrieval_traces_entry ON retrieval_traces(entry_id);

-- Agent reasoning traces: the path from problem to solution
CREATE TABLE IF NOT EXISTS reasoning_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  searches TEXT DEFAULT '[]',
  findings TEXT,
  attempts TEXT,
  solution_path TEXT,
  agent_session TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_reasoning_traces_entry ON reasoning_traces(entry_id);

-- Per-tag daily search trends for learning curves
CREATE TABLE IF NOT EXISTS topic_search_trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL,
  date TEXT NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tag, date)
);
CREATE INDEX IF NOT EXISTS idx_topic_trends_tag ON topic_search_trends(tag);

-- Search session chains: track sequential searches within an agent session
CREATE TABLE IF NOT EXISTS search_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  query TEXT NOT NULL,
  result_entry_ids TEXT DEFAULT '[]',
  sequence_num INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_search_sessions_session ON search_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_search_sessions_created ON search_sessions(created_at);

-- Tag co-occurrence matrix (pre-computed for query expansion)
CREATE TABLE IF NOT EXISTS tag_cooccurrence (
  tag_a TEXT NOT NULL,
  tag_b TEXT NOT NULL,
  co_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tag_a, tag_b)
);

-- Section attribution: which part of an entry helped
CREATE TABLE IF NOT EXISTS section_attributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  section TEXT NOT NULL CHECK(section IN ('problem', 'solution', 'why', 'gotchas', 'code_snippets', 'error_messages')),
  agent_session TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_section_attr_entry ON section_attributions(entry_id);

-- Migration: ALTER TABLE entries ADD COLUMN confidence_score REAL DEFAULT NULL;
