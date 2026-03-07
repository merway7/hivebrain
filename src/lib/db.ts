import { createClient, type Client, type Row } from '@libsql/client';
import { readFileSync } from 'fs';
import { join } from 'path';

let readClient: Client | null = null;
let writeClient: Client | null = null;
let initialized = false;

// ── Mode: public (default), hybrid, private ──
// public  = read from Turso, write to Turso (everything shared)
// hybrid  = read from Turso, write to local SQLite (search public, submit private)
// private = read from local, write to local (everything private)

export type HiveBrainMode = 'public' | 'hybrid' | 'private';

export function getMode(): HiveBrainMode {
  const mode = (process.env.HIVEBRAIN_MODE || '').toLowerCase();
  if (mode === 'hybrid' || mode === 'private') return mode;
  return 'public';
}

function createTursoClient(): Client {
  return createClient({
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

function createLocalClient(): Client {
  const dbPath = join(process.cwd(), 'db', 'hivebrain.db');
  return createClient({ url: `file:${dbPath}` });
}

// ── Client singletons ──

export function getReadDb(): Client {
  if (readClient) return readClient;
  const mode = getMode();
  const hasTurso = !!process.env.TURSO_URL;

  if ((mode === 'public' || mode === 'hybrid') && hasTurso) {
    readClient = createTursoClient();
  } else {
    readClient = createLocalClient();
  }
  return readClient;
}

export function getWriteDb(): Client {
  if (writeClient) return writeClient;
  const mode = getMode();
  const hasTurso = !!process.env.TURSO_URL;

  if (mode === 'public' && hasTurso) {
    writeClient = createTursoClient();
  } else {
    // hybrid and private both write locally
    writeClient = createLocalClient();
  }
  return writeClient;
}

// Backward compat: getDb() returns the read client
export function getDb(): Client {
  return getReadDb();
}

// ── Initialization (call once via middleware) ──

export async function initDb(): Promise<void> {
  if (initialized) return;

  const mode = getMode();
  const rdb = getReadDb();
  const wdb = getWriteDb();
  const hasTurso = !!process.env.TURSO_URL;

  // PRAGMAs only work on local SQLite, not Turso
  const readIsLocal = !(mode !== 'private' && hasTurso);
  const writeIsLocal = mode !== 'public' || !hasTurso;

  if (readIsLocal) {
    await rdb.execute('PRAGMA journal_mode = WAL');
    await rdb.execute('PRAGMA foreign_keys = ON');
  }
  if (writeIsLocal && wdb !== rdb) {
    await wdb.execute('PRAGMA journal_mode = WAL');
    await wdb.execute('PRAGMA foreign_keys = ON');
  }

  // Use read client for schema init (it's the primary DB)
  const db = rdb;

  // Run schema
  const schema = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf-8');
  // libsql client.execute() can only run one statement at a time.
  // Split schema into individual statements, respecting BEGIN...END blocks (triggers).
  const stmts: string[] = [];
  let current = '';
  let inBlock = false;
  for (const line of schema.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') {
      continue;
    }
    current += line + '\n';
    if (/\bBEGIN\b/i.test(trimmed)) inBlock = true;
    if (inBlock && /\bEND\b/i.test(trimmed) && trimmed.endsWith(';')) {
      stmts.push(current.trim());
      current = '';
      inBlock = false;
    } else if (!inBlock && trimmed.endsWith(';')) {
      stmts.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) stmts.push(current.trim());

  const statements = stmts
    .filter(s => s.length > 0)
    .map(s => ({ sql: s, args: [] as any[] }));

  // Execute schema statements one at a time (batch fails on CREATE VIRTUAL TABLE)
  for (const stmt of statements) {
    try {
      await db.execute(stmt);
    } catch (e: any) {
      // Ignore "already exists" errors — schema is idempotent
      if (!e.message?.includes('already exists')) {
        console.warn('Schema warning:', e.message);
      }
    }
  }

  // ── Migrations ──

  // v2: add view_count column
  await migrateAddColumn(db, 'entries', 'view_count', 'INTEGER DEFAULT 0');

  // v4: new columns for quality system
  await migrateAddColumn(db, 'entries', 'downvotes', 'INTEGER DEFAULT 0');
  await migrateAddColumn(db, 'entries', 'usage_count', 'INTEGER DEFAULT 0');
  await migrateAddColumn(db, 'entries', 'quality_status', "TEXT DEFAULT 'unverified'");

  // v4: new tables for revisions and votes
  await db.execute(`
    CREATE TABLE IF NOT EXISTS entry_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      revision_type TEXT NOT NULL,
      content TEXT NOT NULL,
      submitted_by TEXT DEFAULT 'anonymous',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS entry_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      direction TEXT NOT NULL CHECK(direction IN ('up', 'down')),
      voter_ip TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // v5: add voter_name column to entry_votes
  await migrateAddColumn(db, 'entry_votes', 'voter_name', "TEXT DEFAULT 'anonymous'");

  // v6: canonical entries + freshness
  await migrateAddColumn(db, 'entries', 'is_canonical', 'INTEGER DEFAULT 0');
  await migrateAddColumn(db, 'entries', 'freshness_status', "TEXT DEFAULT 'fresh'");

  // v6: usage_contexts table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS usage_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      context TEXT NOT NULL,
      submitted_by TEXT DEFAULT 'anonymous',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_usage_contexts_entry ON usage_contexts(entry_id)'); } catch {}

  // v6: solution_verifications table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS solution_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      verified_by TEXT NOT NULL,
      version_tested TEXT,
      environment TEXT,
      notes TEXT,
      verified_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_verifications_entry ON solution_verifications(entry_id)'); } catch {}

  // v7: reputation system
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reputation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN (
        'submit', 'upvote_received', 'downvote_received',
        'usage_received', 'verification_received', 'entry_outdated'
      )),
      points INTEGER NOT NULL,
      entry_id INTEGER REFERENCES entries(id),
      source_username TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_rep_events_username ON reputation_events(username)'); } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_rep_events_entry ON reputation_events(entry_id)'); } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_rep_events_created ON reputation_events(created_at)'); } catch {}

  await db.execute(`
    CREATE TABLE IF NOT EXISTS reputation_cache (
      username TEXT PRIMARY KEY,
      total_rep INTEGER NOT NULL DEFAULT 0,
      entries_count INTEGER NOT NULL DEFAULT 0,
      upvotes_received INTEGER NOT NULL DEFAULT 0,
      usages_received INTEGER NOT NULL DEFAULT 0,
      verifications_received INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      earned_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(username, badge_id)
    )
  `);
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_badges_username ON user_badges(username)'); } catch {}

  // v8: accounts + notifications
  await db.execute(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_token TEXT,
      verification_expires INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)'); } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_accounts_token ON accounts(verification_token)'); } catch {}

  await db.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN (
        'upvote', 'downvote', 'usage', 'verification', 'revision', 'badge_earned'
      )),
      entry_id INTEGER REFERENCES entries(id),
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_notifications_username ON notifications(username)'); } catch {}
  try { await db.execute('CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(username, read)'); } catch {}

  await db.execute(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      username TEXT PRIMARY KEY,
      email_frequency TEXT NOT NULL DEFAULT 'daily' CHECK(email_frequency IN ('instant', 'daily', 'weekly', 'never')),
      notify_upvotes INTEGER NOT NULL DEFAULT 1,
      notify_usages INTEGER NOT NULL DEFAULT 1,
      notify_verifications INTEGER NOT NULL DEFAULT 1,
      notify_revisions INTEGER NOT NULL DEFAULT 1,
      notify_badges INTEGER NOT NULL DEFAULT 1
    )
  `);

  // In hybrid mode, the write DB is a separate local SQLite — init its schema too
  if (wdb !== rdb) {
    for (const stmt of statements) {
      try { await wdb.execute(stmt); } catch (e: any) {
        if (!e.message?.includes('already exists')) console.warn('Write DB schema warning:', e.message);
      }
    }
    await migrateAddColumn(wdb, 'entries', 'view_count', 'INTEGER DEFAULT 0');
    await migrateAddColumn(wdb, 'entries', 'downvotes', 'INTEGER DEFAULT 0');
    await migrateAddColumn(wdb, 'entries', 'usage_count', 'INTEGER DEFAULT 0');
    await migrateAddColumn(wdb, 'entries', 'quality_status', "TEXT DEFAULT 'unverified'");
    await wdb.execute(`CREATE TABLE IF NOT EXISTS entry_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES entries(id),
      revision_type TEXT NOT NULL, content TEXT NOT NULL, submitted_by TEXT DEFAULT 'anonymous',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    await wdb.execute(`CREATE TABLE IF NOT EXISTS entry_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES entries(id),
      direction TEXT NOT NULL CHECK(direction IN ('up', 'down')), voter_ip TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    await migrateAddColumn(wdb, 'entry_votes', 'voter_name', "TEXT DEFAULT 'anonymous'");
    await migrateAddColumn(wdb, 'entries', 'is_canonical', 'INTEGER DEFAULT 0');
    await migrateAddColumn(wdb, 'entries', 'freshness_status', "TEXT DEFAULT 'fresh'");
    await wdb.execute(`CREATE TABLE IF NOT EXISTS usage_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES entries(id),
      context TEXT NOT NULL, submitted_by TEXT DEFAULT 'anonymous',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_usage_contexts_entry ON usage_contexts(entry_id)'); } catch {}
    await wdb.execute(`CREATE TABLE IF NOT EXISTS solution_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES entries(id),
      verified_by TEXT NOT NULL, version_tested TEXT, environment TEXT, notes TEXT,
      verified_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_verifications_entry ON solution_verifications(entry_id)'); } catch {}
    // v7: reputation
    await wdb.execute(`CREATE TABLE IF NOT EXISTS reputation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('submit','upvote_received','downvote_received','usage_received','verification_received','entry_outdated')),
      points INTEGER NOT NULL, entry_id INTEGER REFERENCES entries(id), source_username TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_rep_events_username ON reputation_events(username)'); } catch {}
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_rep_events_entry ON reputation_events(entry_id)'); } catch {}
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_rep_events_created ON reputation_events(created_at)'); } catch {}
    await wdb.execute(`CREATE TABLE IF NOT EXISTS reputation_cache (
      username TEXT PRIMARY KEY, total_rep INTEGER NOT NULL DEFAULT 0, entries_count INTEGER NOT NULL DEFAULT 0,
      upvotes_received INTEGER NOT NULL DEFAULT 0, usages_received INTEGER NOT NULL DEFAULT 0,
      verifications_received INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    await wdb.execute(`CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, badge_id TEXT NOT NULL,
      earned_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(username, badge_id))`);
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_badges_username ON user_badges(username)'); } catch {}
    // v8: accounts + notifications
    await wdb.execute(`CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0, verification_token TEXT, verification_expires INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)'); } catch {}
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_accounts_token ON accounts(verification_token)'); } catch {}
    await wdb.execute(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('upvote','downvote','usage','verification','revision','badge_earned')),
      entry_id INTEGER REFERENCES entries(id), message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_notifications_username ON notifications(username)'); } catch {}
    try { await wdb.execute('CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(username, read)'); } catch {}
    await wdb.execute(`CREATE TABLE IF NOT EXISTS notification_preferences (
      username TEXT PRIMARY KEY, email_frequency TEXT NOT NULL DEFAULT 'daily' CHECK(email_frequency IN ('instant','daily','weekly','never')),
      notify_upvotes INTEGER NOT NULL DEFAULT 1, notify_usages INTEGER NOT NULL DEFAULT 1,
      notify_verifications INTEGER NOT NULL DEFAULT 1, notify_revisions INTEGER NOT NULL DEFAULT 1,
      notify_badges INTEGER NOT NULL DEFAULT 1)`);
  }

  initialized = true;
}

async function migrateAddColumn(db: Client, table: string, column: string, definition: string): Promise<void> {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e: any) {
    // Column already exists — ignore the error
    if (!e.message?.includes('duplicate column') && !e.message?.includes('already exists')) {
      throw e;
    }
  }
}

// ── Types ──

export interface Entry {
  id: number;
  title: string;
  category: 'pattern' | 'gotcha' | 'principle' | 'snippet' | 'debug';
  tags: string;
  problem: string;
  solution: string;
  why: string | null;
  gotchas: string;
  learned_from: string | null;
  submitted_by: string;
  created_at: number;
  upvotes: number;
  downvotes: number;
  usage_count: number;
  quality_status: string;
  language: string | null;
  framework: string | null;
  severity: string;
  environment: string;
  error_messages: string;
  version_info: string | null;
  context: string | null;
  keywords: string;
  code_snippets: string;
  related_entries: string;
  view_count: number;
  is_canonical: number;
  freshness_status: string;
}

// ── Row helper ──

function rowToEntry(row: Row): Entry {
  return {
    id: Number(row.id),
    title: String(row.title),
    category: String(row.category) as Entry['category'],
    tags: String(row.tags ?? '[]'),
    problem: String(row.problem),
    solution: String(row.solution),
    why: row.why != null ? String(row.why) : null,
    gotchas: String(row.gotchas ?? '[]'),
    learned_from: row.learned_from != null ? String(row.learned_from) : null,
    submitted_by: String(row.submitted_by ?? 'anonymous'),
    created_at: Number(row.created_at),
    upvotes: Number(row.upvotes ?? 0),
    downvotes: Number(row.downvotes ?? 0),
    usage_count: Number(row.usage_count ?? 0),
    quality_status: String(row.quality_status ?? 'unverified'),
    language: row.language != null ? String(row.language) : null,
    framework: row.framework != null ? String(row.framework) : null,
    severity: String(row.severity ?? 'moderate'),
    environment: String(row.environment ?? '[]'),
    error_messages: String(row.error_messages ?? '[]'),
    version_info: row.version_info != null ? String(row.version_info) : null,
    context: row.context != null ? String(row.context) : null,
    keywords: String(row.keywords ?? '[]'),
    code_snippets: String(row.code_snippets ?? '[]'),
    related_entries: String(row.related_entries ?? '[]'),
    view_count: Number(row.view_count ?? 0),
    is_canonical: Number(row.is_canonical ?? 0),
    freshness_status: String(row.freshness_status ?? 'fresh'),
  };
}

// ── CRUD ──

export async function getAllEntries(opts?: {
  category?: string;
  tag?: string;
  language?: string;
  framework?: string;
  severity?: string;
  environment?: string;
  limit?: number;
  offset?: number;
  cursor?: number;
  sort?: SearchSort;
}): Promise<Entry[]> {
  const db = getDb();
  const args: any[] = [];
  const conditions: string[] = [];
  let useJsonEach = false;

  if (opts?.tag) {
    useJsonEach = true;
    conditions.push('tag_each.value = ?');
    args.push(opts.tag);
  }
  if (opts?.category) {
    conditions.push('entries.category = ?');
    args.push(opts.category);
  }
  if (opts?.language) {
    conditions.push('entries.language = ?');
    args.push(opts.language);
  }
  if (opts?.framework) {
    conditions.push('entries.framework = ?');
    args.push(opts.framework);
  }
  if (opts?.severity) {
    conditions.push('entries.severity = ?');
    args.push(opts.severity);
  }
  if (opts?.environment) {
    conditions.push('EXISTS (SELECT 1 FROM json_each(entries.environment) WHERE value = ?)');
    args.push(opts.environment);
  }

  if (opts?.cursor) {
    conditions.push('entries.id < ?');
    args.push(opts.cursor);
  }

  let query = useJsonEach
    ? 'SELECT entries.* FROM entries, json_each(entries.tags) AS tag_each'
    : 'SELECT entries.* FROM entries';

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  const sortMap: Record<string, string> = {
    votes: '(entries.upvotes - entries.downvotes) DESC',
    newest: 'entries.created_at DESC',
    oldest: 'entries.created_at ASC',
    most_used: 'entries.usage_count DESC',
    severity: `CASE entries.severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 WHEN 'tip' THEN 5 ELSE 3 END ASC`,
  };
  const orderBy = (opts?.sort && sortMap[opts.sort]) || 'entries.id DESC';
  query += ` ORDER BY ${orderBy}`;

  if (opts?.limit) {
    query += ' LIMIT ?';
    args.push(opts.limit);
  }
  if (opts?.offset && !opts?.cursor) {
    query += ' OFFSET ?';
    args.push(opts.offset);
  }

  const result = await db.execute({ sql: query, args });
  return result.rows.map(rowToEntry);
}

export async function getEntry(id: number): Promise<Entry | undefined> {
  const db = getDb();
  const result = await db.execute({ sql: 'SELECT * FROM entries WHERE id = ?', args: [id] });
  return result.rows.length > 0 ? rowToEntry(result.rows[0]) : undefined;
}

// ── Search ──

// Common abbreviations/synonyms agents use
const SYNONYMS: Record<string, string[]> = {
  'js': ['javascript'],
  'ts': ['typescript'],
  'py': ['python'],
  'rb': ['ruby'],
  'rs': ['rust'],
  'cpp': ['c++', 'cplusplus'],
  'csharp': ['c#'],
  'next': ['nextjs', 'next.js'],
  'nextjs': ['next.js', 'next'],
  'react': ['reactjs', 'react.js'],
  'vue': ['vuejs', 'vue.js'],
  'node': ['nodejs', 'node.js'],
  'nodejs': ['node.js', 'node'],
  'express': ['expressjs'],
  'deno': ['denojs'],
  'postgres': ['postgresql', 'psql'],
  'mongo': ['mongodb'],
  'k8s': ['kubernetes'],
  'tf': ['terraform'],
  'gh': ['github'],
  'aws': ['amazon web services'],
  'gcp': ['google cloud'],
  'css': ['stylesheet', 'styling'],
  'env': ['environment'],
  'config': ['configuration'],
  'auth': ['authentication', 'authorization'],
  'deps': ['dependencies'],
  'pkg': ['package'],
  'db': ['database'],
  'err': ['error'],
  'vars': ['variables'],
  'props': ['properties'],
  'fn': ['function'],
  'async': ['asynchronous'],
  'sync': ['synchronous'],
  'ssr': ['server side rendering', 'server-side-rendering'],
  'csr': ['client side rendering'],
  'ci': ['continuous integration'],
  'cd': ['continuous deployment'],
};

// Words too common to be useful in OR fallback — they match everything
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'about', 'up', 'it', 'its', 'this', 'that',
  'what', 'which', 'who', 'whom', 'these', 'those', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'he', 'him', 'she', 'her', 'they', 'them',
  'get', 'got', 'make', 'made', 'use', 'used', 'using', 'work', 'works',
]);

function expandQuery(words: string[]): string[] {
  const expanded: string[] = [...words];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (SYNONYMS[lower]) {
      expanded.push(...SYNONYMS[lower]);
    }
  }
  return [...new Set(expanded)];
}

function isSignificantWord(w: string): boolean {
  return w.length > 2 && !STOP_WORDS.has(w.toLowerCase());
}

const SEVERITY_RANK: Record<string, number> = { critical: 1, major: 2, moderate: 3, minor: 4, tip: 5 };

export type SearchSort = 'relevance' | 'votes' | 'newest' | 'oldest' | 'most_used' | 'severity';

export function computeFreshness(entry: { created_at: number; quality_status: string }, lastVerifiedAt?: number): 'fresh' | 'aging' | 'stale' {
  const now = Math.floor(Date.now() / 1000);
  const ageMonths = (now - entry.created_at) / (30 * 24 * 3600);
  const recentlyVerified = lastVerifiedAt && (now - lastVerifiedAt) < 3 * 30 * 24 * 3600;

  if (entry.quality_status === 'outdated') return 'stale';
  if (recentlyVerified || ageMonths < 6) return 'fresh';
  if (ageMonths > 18) return 'stale';
  return 'aging';
}

function applySorting<T extends Entry>(results: T[], sort: SearchSort): T[] {
  switch (sort) {
    case 'votes': return results.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
    case 'newest': return results.sort((a, b) => b.created_at - a.created_at);
    case 'oldest': return results.sort((a, b) => a.created_at - b.created_at);
    case 'most_used': return results.sort((a, b) => b.usage_count - a.usage_count);
    case 'severity': return results.sort((a, b) => (SEVERITY_RANK[a.severity] || 3) - (SEVERITY_RANK[b.severity] || 3));
    default: return results; // relevance = existing _score sort
  }
}

export async function searchEntries(query: string, sort: SearchSort = 'relevance'): Promise<(Entry & { title_hl?: string; problem_hl?: string; solution_hl?: string; _score?: number })[]> {
  const db = getDb();
  const sanitized = query.replace(/['"]/g, '').trim();
  const words = sanitized.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) return [];

  // Separate significant words from noise
  const significantWords = words.filter(isSignificantWord);
  const searchWords = significantWords.length > 0 ? significantWords : words;

  // Expand with synonyms
  const expanded = expandQuery(searchWords);

  const scoreById = new Map<number, number>();
  const allResults: (Entry & { _score: number; title_hl?: string; problem_hl?: string; solution_hl?: string })[] = [];

  function addResults(rows: Row[], score: number) {
    for (const row of rows) {
      const id = Number(row.id);
      const existingScore = scoreById.get(id);
      if (existingScore === undefined) {
        scoreById.set(id, score);
        const entry = rowToEntry(row) as Entry & { _score: number; title_hl?: string; problem_hl?: string; solution_hl?: string };
        entry._score = score;
        if (row.title_hl != null) entry.title_hl = String(row.title_hl);
        if (row.problem_hl != null) entry.problem_hl = String(row.problem_hl);
        if (row.solution_hl != null) entry.solution_hl = String(row.solution_hl);
        allResults.push(entry);
      } else if (score > existingScore) {
        scoreById.set(id, score);
        const idx = allResults.findIndex(r => r.id === id);
        if (idx !== -1) allResults[idx]._score = score;
      }
    }
  }

  // Title boost: add +15 to score for entries where any search term appears in the title
  function applyTitleBoost() {
    const lowerTerms = searchWords.map(w => w.toLowerCase());
    for (const result of allResults) {
      const lowerTitle = result.title.toLowerCase();
      if (lowerTerms.some(t => lowerTitle.includes(t))) {
        result._score += 15;
        scoreById.set(result.id, result._score);
      }
    }
  }

  // Helper to run an FTS query safely
  async function ftsQuery(matchExpr: string): Promise<Row[]> {
    const ftsSQL = `
      SELECT entries.*,
             highlight(entries_fts, 0, '<mark>', '</mark>') as title_hl,
             highlight(entries_fts, 1, '<mark>', '</mark>') as problem_hl,
             highlight(entries_fts, 2, '<mark>', '</mark>') as solution_hl,
             bm25(entries_fts, 10.0, 5.0, 5.0, 2.0, 3.0, 3.0, 2.0, 4.0, 4.0, 4.0) as bm25_score
      FROM entries_fts
      JOIN entries ON entries.id = entries_fts.rowid
      WHERE entries_fts MATCH ?
      ORDER BY bm25_score
      LIMIT 30
    `;
    try {
      const result = await db.execute({ sql: ftsSQL, args: [matchExpr] });
      return result.rows;
    } catch {
      return [];
    }
  }

  // ── Layer 1: FTS5 full-text search (best quality) ──
  try {
    // 1a: AND query (original words only, not synonyms) — highest precision
    if (searchWords.length > 1) {
      const andQuery = searchWords.map(w => `"${w}"`).join(' AND ');
      const andResults = await ftsQuery(andQuery);
      addResults(andResults, 100);
    }

    // 1b: AND query with synonym expansion
    if (expanded.length > 1 && expanded.length !== searchWords.length) {
      const groups = searchWords.map(w => {
        const lower = w.toLowerCase();
        const syns = SYNONYMS[lower] || [];
        const all = [w, ...syns];
        return all.length === 1 ? `"${all[0]}"` : `(${all.map(s => `"${s}"`).join(' OR ')})`;
      });
      const groupedAndQuery = groups.join(' AND ');
      const andSynResults = await ftsQuery(groupedAndQuery);
      addResults(andSynResults, 95);
    }

    // 1c: Prefix matching (AND) — "hydrat" matches "hydration"
    if (searchWords.length > 1) {
      const prefixQuery = searchWords.map(w => `${w}*`).join(' AND ');
      const prefixResults = await ftsQuery(prefixQuery);
      addResults(prefixResults, 85);
    }

    // 1d: Individual exact terms (catches single-word queries)
    if (searchWords.length === 1) {
      const exactResults = await ftsQuery(`"${expanded[0]}"`);
      addResults(exactResults, 90);
      // Try each synonym individually
      for (const syn of expanded.slice(1)) {
        const synResults = await ftsQuery(`"${syn}"`);
        addResults(synResults, 85);
      }
      // Prefix for single word
      const prefixResults = await ftsQuery(`${expanded[0]}*`);
      addResults(prefixResults, 75);
    }

    // 1e: OR query — only if AND yielded very few results, and only significant terms
    if (allResults.length < 3 && expanded.length > 1) {
      const sigTerms = expanded.filter(w => isSignificantWord(w));
      if (sigTerms.length > 0) {
        const matchCounts = new Map<number, number>();
        const orRowsById = new Map<number, Row>();
        for (const term of sigTerms) {
          const termResults = await ftsQuery(`"${term}"`);
          for (const row of termResults) {
            const rid = Number(row.id);
            matchCounts.set(rid, (matchCounts.get(rid) || 0) + 1);
            if (!orRowsById.has(rid)) orRowsById.set(rid, row);
          }
        }

        const totalSigTerms = sigTerms.length;
        const minMatches = searchWords.length >= 2 ? Math.ceil(totalSigTerms * 0.5) : 1;

        for (const [id, count] of matchCounts) {
          if (count < minMatches) continue;
          const ratio = count / totalSigTerms;
          let orScore: number;
          if (ratio >= 1) orScore = 45;
          else if (ratio >= 0.6) orScore = 35;
          else orScore = 20;

          addResults([orRowsById.get(id)!], orScore);
        }
      }
    }
  } catch { /* FTS completely broken, fall through to other layers */ }

  // ── Layers 2/3/5: Tag, language/framework, keyword matching ──
  const layerMatchCounts = new Map<number, number>();
  const termMatchCounts = new Map<number, Set<string>>();
  const layerRows = new Map<number, Row>();

  function trackLayerMatch(rows: Row[], matchedTerm: string) {
    for (const row of rows) {
      const rid = Number(row.id);
      layerMatchCounts.set(rid, (layerMatchCounts.get(rid) || 0) + 1);
      if (!termMatchCounts.has(rid)) termMatchCounts.set(rid, new Set());
      termMatchCounts.get(rid)!.add(matchedTerm.toLowerCase());
      if (!layerRows.has(rid)) layerRows.set(rid, row);
    }
  }

  // Layer 2: Exact tag matching — per search term
  for (const term of expanded) {
    try {
      const result = await db.execute({
        sql: `SELECT DISTINCT entries.* FROM entries, json_each(entries.tags) AS t
              WHERE LOWER(t.value) = ? LIMIT 20`,
        args: [term.toLowerCase()],
      });
      trackLayerMatch(result.rows, term);
    } catch { /* skip */ }
  }

  // Layer 3: Language/framework column match — per search term
  for (const term of expanded) {
    try {
      const result = await db.execute({
        sql: `SELECT * FROM entries
              WHERE LOWER(language) = ? OR LOWER(framework) = ? LIMIT 20`,
        args: [term.toLowerCase(), term.toLowerCase()],
      });
      trackLayerMatch(result.rows, term);
    } catch { /* skip */ }
  }

  // Layer 5: Keyword matching — per search term
  for (const term of expanded) {
    try {
      const result = await db.execute({
        sql: `SELECT DISTINCT entries.* FROM entries, json_each(entries.keywords) AS kw
              WHERE LOWER(kw.value) = ? LIMIT 20`,
        args: [term.toLowerCase()],
      });
      trackLayerMatch(result.rows, term);
    } catch { /* skip */ }
  }

  // Score by: how many distinct search terms matched AND across how many layers
  for (const [id] of layerMatchCounts) {
    const layers = layerMatchCounts.get(id) || 0;
    const termsMatched = termMatchCounts.get(id)?.size || 0;
    const termRatio = termsMatched / searchWords.length;

    let layerScore: number;
    if (termRatio >= 0.8 && layers >= 2) layerScore = 80;
    else if (termRatio >= 0.8) layerScore = 70;
    else if (searchWords.length === 1) layerScore = 65;
    else if (termRatio >= 0.5 && layers >= 2) layerScore = 40;
    else layerScore = 25;

    addResults([layerRows.get(id)!], layerScore);
  }

  // ── Layer 4: Error message substring search (critical for debugging) ──
  try {
    const ERROR_NOISE = new Set(['error', 'failed', 'cannot', 'unable', 'invalid', 'could', 'found', 'module']);
    const errorTerms = expanded.filter(w => w.length >= 5 && !STOP_WORDS.has(w.toLowerCase()) && !ERROR_NOISE.has(w.toLowerCase()));
    if (errorTerms.length > 0) {
      // First try: match the full original query as a substring
      const fullQuery = sanitized;
      if (fullQuery.length >= 8) {
        const fullResult = await db.execute({
          sql: 'SELECT * FROM entries WHERE error_messages LIKE ? LIMIT 10',
          args: [`%${fullQuery}%`],
        });
        addResults(fullResult.rows, 90);
      }

      // Second: match individual specific terms
      const termClauses = errorTerms.map(() => 'error_messages LIKE ?').join(' OR ');
      const termResult = await db.execute({
        sql: `SELECT * FROM entries WHERE ${termClauses} LIMIT 20`,
        args: errorTerms.map(w => `%${w}%`),
      });
      addResults(termResult.rows, 75);
    }
  } catch { /* skip */ }

  // ── Layer 5b: Environment JSON array search ──
  try {
    const placeholders = expanded.map(() => '?').join(',');
    const envResult = await db.execute({
      sql: `SELECT DISTINCT entries.* FROM entries, json_each(entries.environment) AS env
            WHERE LOWER(env.value) IN (${placeholders}) LIMIT 20`,
      args: expanded.map(w => w.toLowerCase()),
    });
    addResults(envResult.rows, 60);
  } catch { /* skip */ }

  // ── Layer 6: Broad LIKE fallback (catches anything the above missed) ──
  if (allResults.length < 3) {
    try {
      const likeTerms = expanded.filter(isSignificantWord);
      if (likeTerms.length > 0) {
        const likeClauses = likeTerms.map(() =>
          '(title LIKE ? OR problem LIKE ? OR solution LIKE ? OR tags LIKE ? OR error_messages LIKE ? OR keywords LIKE ?)'
        ).join(' OR ');
        const likeArgs = likeTerms.flatMap(w => {
          const p = `%${w}%`;
          return [p, p, p, p, p, p];
        });
        const likeResult = await db.execute({
          sql: `SELECT * FROM entries WHERE ${likeClauses} LIMIT 20`,
          args: likeArgs,
        });
        addResults(likeResult.rows, 30);
      }
    } catch { /* skip */ }
  }

  // Apply title boost before final sort
  applyTitleBoost();

  // Apply canonical boost (+25)
  for (const result of allResults) {
    if (result.is_canonical) {
      result._score += 25;
      scoreById.set(result.id, result._score);
    }
  }

  // Compute freshness on read (without verification data for performance —
  // search freshness is based on age + quality_status only.
  // Detail view at /api/entry/[id] includes verification-aware freshness.)
  for (const result of allResults) {
    result.freshness_status = computeFreshness(result);
  }

  // Sort by score (highest first) for relevance, then apply requested sort
  allResults.sort((a, b) => b._score - a._score);

  // Drop noise: remove results scoring less than 50% of the top result
  let finalResults = allResults;
  if (allResults.length > 1) {
    const topScore = allResults[0]._score;
    const threshold = topScore * 0.5;
    finalResults = allResults.filter(r => r._score >= threshold);
  }

  finalResults = finalResults.slice(0, 50);

  // Apply secondary sort if not relevance
  if (sort !== 'relevance') {
    finalResults = applySorting(finalResults, sort);
  }

  return finalResults;
}

// ── Insert ──

export async function insertEntry(entry: {
  title: string;
  category: string;
  tags?: string[];
  problem: string;
  solution: string;
  why?: string;
  gotchas?: string[];
  learned_from?: string;
  submitted_by?: string;
  language?: string | null;
  framework?: string | null;
  severity?: string;
  environment?: string[];
  error_messages?: string[];
  keywords?: string[];
  context?: string;
  version_info?: string;
  code_snippets?: { code: string; lang?: string; description?: string }[];
  related_entries?: number[];
}): Promise<{ id: number }> {
  const db = getWriteDb();
  const result = await db.execute({
    sql: `INSERT INTO entries (
      title, category, tags, problem, solution, why, gotchas,
      learned_from, submitted_by,
      language, framework, severity, environment,
      error_messages, keywords, context, version_info,
      code_snippets, related_entries
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      entry.title,
      entry.category,
      JSON.stringify(entry.tags || []),
      entry.problem,
      entry.solution,
      entry.why || null,
      JSON.stringify(entry.gotchas || []),
      entry.learned_from || null,
      entry.submitted_by || 'anonymous',
      entry.language || null,
      entry.framework || null,
      entry.severity || 'moderate',
      JSON.stringify(entry.environment || []),
      JSON.stringify(entry.error_messages || []),
      JSON.stringify(entry.keywords || []),
      entry.context || null,
      entry.version_info || null,
      JSON.stringify(entry.code_snippets || []),
      JSON.stringify(entry.related_entries || []),
    ],
  });
  const newId = Number(result.lastInsertRowid);

  // Auto-populate related entries (bidirectional, merged with user-provided)
  try {
    const related = await findRelatedByFTS(entry.title, entry.tags || [], newId);
    if (related.length > 0) {
      const userProvided: number[] = entry.related_entries || [];
      const autoDiscovered = related.map(r => r.id);
      const merged = [...new Set([...userProvided, ...autoDiscovered])].slice(0, 10);
      await db.execute({
        sql: 'UPDATE entries SET related_entries = ? WHERE id = ?',
        args: [JSON.stringify(merged), newId],
      });
      for (const rel of related) {
        const existing: number[] = JSON.parse(rel.related_entries || '[]');
        if (!existing.includes(newId) && existing.length < 10) {
          existing.push(newId);
          await db.execute({
            sql: 'UPDATE entries SET related_entries = ? WHERE id = ?',
            args: [JSON.stringify(existing), rel.id],
          });
        }
      }
    }
  } catch { /* related entries is best-effort */ }

  return { id: newId };
}

// ── Stats ──

export async function getStats() {
  const db = getDb();

  const totalResult = await db.execute('SELECT COUNT(*) as count FROM entries');
  const total = Number(totalResult.rows[0].count);

  const byCategoryResult = await db.execute(
    'SELECT category, COUNT(*) as count FROM entries GROUP BY category'
  );
  const byCategory = byCategoryResult.rows.map(r => ({
    category: String(r.category),
    count: Number(r.count),
  }));

  const allTagsResult = await db.execute('SELECT tags FROM entries');
  const tagCounts: Record<string, number> = {};
  for (const row of allTagsResult.rows) {
    const tags = JSON.parse(String(row.tags)) as string[];
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const languageResult = await db.execute(
    "SELECT language, COUNT(*) as count FROM entries WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY count DESC"
  );
  const languageCounts: Record<string, number> = {};
  for (const row of languageResult.rows) {
    languageCounts[String(row.language)] = Number(row.count);
  }

  const frameworkResult = await db.execute(
    "SELECT framework, COUNT(*) as count FROM entries WHERE framework IS NOT NULL AND framework != '' GROUP BY framework ORDER BY count DESC"
  );
  const frameworkCounts: Record<string, number> = {};
  for (const row of frameworkResult.rows) {
    frameworkCounts[String(row.framework)] = Number(row.count);
  }

  const severityResult = await db.execute(
    "SELECT severity, COUNT(*) as count FROM entries WHERE severity IS NOT NULL AND severity != '' GROUP BY severity ORDER BY count DESC"
  );
  const severityCounts: Record<string, number> = {};
  for (const row of severityResult.rows) {
    severityCounts[String(row.severity)] = Number(row.count);
  }

  const allEnvironmentsResult = await db.execute('SELECT environment FROM entries');
  const environmentCounts: Record<string, number> = {};
  for (const row of allEnvironmentsResult.rows) {
    const envs = JSON.parse(String(row.environment || '[]')) as string[];
    for (const env of envs) {
      environmentCounts[env] = (environmentCounts[env] || 0) + 1;
    }
  }

  return { total, byCategory, tagCounts, languageCounts, frameworkCounts, severityCounts, environmentCounts };
}

// ── Analytics ──

export async function trackView(entryId: number, source: string = 'web'): Promise<void> {
  const db = getWriteDb();
  // Deduplicate: skip if same entry+source was tracked in the last 5 minutes
  const recent = await db.execute({
    sql: 'SELECT 1 FROM analytics_views WHERE entry_id = ? AND source = ? AND created_at > (unixepoch() - 300) LIMIT 1',
    args: [entryId, source],
  });
  if (recent.rows.length > 0) return;
  await db.execute({
    sql: 'INSERT INTO analytics_views (entry_id, source) VALUES (?, ?)',
    args: [entryId, source],
  });
  await db.execute({
    sql: 'UPDATE entries SET view_count = view_count + 1 WHERE id = ?',
    args: [entryId],
  });
}

export async function trackSearch(query: string, resultCount: number, source: string = 'web'): Promise<void> {
  const db = getWriteDb();
  await db.execute({
    sql: 'INSERT INTO analytics_searches (query, result_count, source) VALUES (?, ?, ?)',
    args: [query, resultCount, source],
  });
}

export async function getAnalytics(): Promise<{
  totalViews: number;
  totalSearches: number;
  viewsBySource: Record<string, number>;
  searchesBySource: Record<string, number>;
  recentSearches: { query: string; result_count: number; source: string; created_at: number }[];
  topViewed: { id: number; title: string; view_count: number }[];
  dailyActivity: { date: string; views: number; searches: number }[];
}> {
  const db = getWriteDb();

  const totalViewsResult = await db.execute('SELECT COUNT(*) as c FROM analytics_views');
  const totalViews = Number(totalViewsResult.rows[0].c);

  const totalSearchesResult = await db.execute('SELECT COUNT(*) as c FROM analytics_searches');
  const totalSearches = Number(totalSearchesResult.rows[0].c);

  const viewsBySourceResult = await db.execute('SELECT source, COUNT(*) as c FROM analytics_views GROUP BY source');
  const viewsBySource: Record<string, number> = {};
  for (const row of viewsBySourceResult.rows) viewsBySource[String(row.source)] = Number(row.c);

  const searchesBySourceResult = await db.execute('SELECT source, COUNT(*) as c FROM analytics_searches GROUP BY source');
  const searchesBySource: Record<string, number> = {};
  for (const row of searchesBySourceResult.rows) searchesBySource[String(row.source)] = Number(row.c);

  const recentResult = await db.execute(
    'SELECT query, result_count, source, created_at FROM analytics_searches ORDER BY created_at DESC LIMIT 20'
  );
  const recentSearches = recentResult.rows.map(r => ({
    query: String(r.query),
    result_count: Number(r.result_count),
    source: String(r.source),
    created_at: Number(r.created_at),
  }));

  const topViewedResult = await db.execute(
    'SELECT id, title, view_count FROM entries WHERE view_count > 0 ORDER BY view_count DESC LIMIT 10'
  );
  const topViewed = topViewedResult.rows.map(r => ({
    id: Number(r.id),
    title: String(r.title),
    view_count: Number(r.view_count),
  }));

  // Daily activity for past 30 days
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;

  const dailyViewResult = await db.execute({
    sql: `SELECT date(created_at, 'unixepoch') as date, COUNT(*) as c
          FROM analytics_views WHERE created_at >= ?
          GROUP BY date(created_at, 'unixepoch')`,
    args: [thirtyDaysAgo],
  });

  const dailySearchResult = await db.execute({
    sql: `SELECT date(created_at, 'unixepoch') as date, COUNT(*) as c
          FROM analytics_searches WHERE created_at >= ?
          GROUP BY date(created_at, 'unixepoch')`,
    args: [thirtyDaysAgo],
  });

  const viewMap = new Map(dailyViewResult.rows.map(r => [String(r.date), Number(r.c)]));
  const searchMap = new Map(dailySearchResult.rows.map(r => [String(r.date), Number(r.c)]));

  const dailyActivity: { date: string; views: number; searches: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    dailyActivity.push({
      date: dateStr,
      views: viewMap.get(dateStr) || 0,
      searches: searchMap.get(dateStr) || 0,
    });
  }

  return { totalViews, totalSearches, viewsBySource, searchesBySource, recentSearches, topViewed, dailyActivity };
}

// ── Weekly Digest ──

export async function getWeeklyDigest(): Promise<{
  newEntries: Entry[];
  topEntries: Entry[];
  searchCount: number;
  trendingTags: { tag: string; count: number }[];
}> {
  const db = getDb();
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

  // New entries this week
  const newResult = await db.execute({
    sql: 'SELECT * FROM entries WHERE created_at > ? ORDER BY created_at DESC',
    args: [weekAgo],
  });
  const newEntries = newResult.rows.map(rowToEntry);

  // Top entries this week (by votes + usage)
  const topResult = await db.execute({
    sql: 'SELECT * FROM entries WHERE created_at > ? ORDER BY (upvotes - downvotes + usage_count) DESC LIMIT 3',
    args: [weekAgo],
  });
  const topEntries = topResult.rows.map(rowToEntry);

  // Search count this week
  const searchResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM analytics_searches WHERE created_at > ?',
    args: [weekAgo],
  });
  const searchCount = Number(searchResult.rows[0].count);

  // Trending tags - count occurrences from this week's entries
  const tagCounts: Record<string, number> = {};
  for (const entry of newEntries) {
    try {
      const tags = JSON.parse(entry.tags) as string[];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    } catch { /* skip malformed tags */ }
  }
  const trendingTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { newEntries, topEntries, searchCount, trendingTags };
}

// ── New: Duplicate detection ──

export async function findDuplicates(title: string): Promise<Entry[]> {
  const db = getDb();
  // Use FTS for fuzzy title matching, then fall back to LIKE
  const words = title.replace(/['"]/g, '').split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return [];

  try {
    const ftsMatch = words.map(w => `"${w}"`).join(' AND ');
    const result = await db.execute({
      sql: `SELECT entries.* FROM entries_fts
            JOIN entries ON entries.id = entries_fts.rowid
            WHERE entries_fts MATCH ? LIMIT 10`,
      args: [ftsMatch],
    });
    if (result.rows.length > 0) return result.rows.map(rowToEntry);
  } catch { /* FTS failed, try LIKE */ }

  const likeClauses = words.map(() => 'title LIKE ?').join(' OR ');
  const result = await db.execute({
    sql: `SELECT * FROM entries WHERE ${likeClauses} LIMIT 10`,
    args: words.map(w => `%${w}%`),
  });
  return result.rows.map(rowToEntry);
}

// ── New: Revisions ──

export async function getRevisions(entryId: number): Promise<{ id: number; entry_id: number; revision_type: string; content: string; submitted_by: string; created_at: number }[]> {
  const db = getWriteDb();
  const result = await db.execute({
    sql: 'SELECT * FROM entry_revisions WHERE entry_id = ? ORDER BY created_at DESC',
    args: [entryId],
  });
  return result.rows.map(r => ({
    id: Number(r.id),
    entry_id: Number(r.entry_id),
    revision_type: String(r.revision_type),
    content: String(r.content),
    submitted_by: String(r.submitted_by),
    created_at: Number(r.created_at),
  }));
}

export async function addRevision(entryId: number, type: string, content: string, submittedBy: string = 'anonymous'): Promise<{ id: number }> {
  const db = getWriteDb();
  const result = await db.execute({
    sql: 'INSERT INTO entry_revisions (entry_id, revision_type, content, submitted_by) VALUES (?, ?, ?, ?)',
    args: [entryId, type, content, submittedBy],
  });
  return { id: Number(result.lastInsertRowid) };
}

// ── New: Voting ──

export async function addVote(entryId: number, direction: 'up' | 'down', voterIp: string | null = null, voterName: string = 'anonymous'): Promise<{ id: number }> {
  const db = getWriteDb();
  const col = direction === 'up' ? 'upvotes' : 'downvotes';

  // Atomic: insert vote + update aggregate in one batch
  const results = await db.batch([
    { sql: 'INSERT INTO entry_votes (entry_id, direction, voter_ip, voter_name) VALUES (?, ?, ?, ?)', args: [entryId, direction, voterIp, voterName] },
    { sql: `UPDATE entries SET ${col} = ${col} + 1 WHERE id = ?`, args: [entryId] },
  ]);

  return { id: Number(results[0].lastInsertRowid) };
}

export async function getVoteForIp(entryId: number, voterIp: string, withinHours: number = 24): Promise<{ id: number; direction: string } | null> {
  const db = getWriteDb();
  const cutoff = Math.floor(Date.now() / 1000) - withinHours * 3600;
  const result = await db.execute({
    sql: 'SELECT id, direction FROM entry_votes WHERE entry_id = ? AND voter_ip = ? AND created_at > ? LIMIT 1',
    args: [entryId, voterIp, cutoff],
  });
  if (result.rows.length === 0) return null;
  return { id: Number(result.rows[0].id), direction: String(result.rows[0].direction) };
}

// ── New: Quality management ──

export async function updateQualityStatus(entryId: number, status: string): Promise<void> {
  const db = getWriteDb();
  await db.execute({
    sql: 'UPDATE entries SET quality_status = ? WHERE id = ?',
    args: [status, entryId],
  });
}

export async function incrementUsageCount(entryId: number): Promise<void> {
  const db = getWriteDb();
  await db.execute({
    sql: 'UPDATE entries SET usage_count = usage_count + 1 WHERE id = ?',
    args: [entryId],
  });
}

// ── Hall of Fame / Categories / Stats helpers ──

export async function getTopEntries(limit = 10): Promise<Entry[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT * FROM entries ORDER BY (upvotes - downvotes + usage_count * 2) DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows.map(rowToEntry);
}

export async function getEntriesByCategory(): Promise<Record<string, number>> {
  const db = getDb();
  const result = await db.execute('SELECT category, COUNT(*) as count FROM entries GROUP BY category ORDER BY count DESC');
  const cats: Record<string, number> = {};
  for (const row of result.rows) {
    cats[String(row.category)] = Number(row.count);
  }
  return cats;
}

export async function getTotalUsageCount(): Promise<number> {
  const db = getDb();
  const result = await db.execute('SELECT COALESCE(SUM(usage_count), 0) as total FROM entries');
  return Number(result.rows[0].total);
}

// ── New: Import/Export ──

export async function exportAllEntries(): Promise<Entry[]> {
  const db = getDb();
  const result = await db.execute('SELECT * FROM entries ORDER BY id ASC');
  return result.rows.map(rowToEntry);
}

// ── Canonical entries ──

export async function markCanonical(entryId: number, isCanonical: boolean): Promise<void> {
  const db = getWriteDb();
  await db.execute({
    sql: 'UPDATE entries SET is_canonical = ? WHERE id = ?',
    args: [isCanonical ? 1 : 0, entryId],
  });
}

// ── Usage contexts ──

export async function addUsageContext(entryId: number, context: string, submittedBy: string = 'anonymous'): Promise<{ id: number } | null> {
  const db = getWriteDb();
  // Deduplicate: skip if same entry had a context added in the last 5 minutes
  const recent = await db.execute({
    sql: 'SELECT 1 FROM usage_contexts WHERE entry_id = ? AND created_at > (unixepoch() - 300) LIMIT 1',
    args: [entryId],
  });
  if (recent.rows.length > 0) return null;

  const result = await db.execute({
    sql: 'INSERT INTO usage_contexts (entry_id, context, submitted_by) VALUES (?, ?, ?)',
    args: [entryId, context, submittedBy],
  });
  return { id: Number(result.lastInsertRowid) };
}

export async function getUsageContexts(entryId: number, limit: number = 5): Promise<{ id: number; context: string; submitted_by: string; created_at: number }[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM usage_contexts WHERE entry_id = ? ORDER BY created_at DESC LIMIT ?',
    args: [entryId, limit],
  });
  return result.rows.map(r => ({
    id: Number(r.id),
    context: String(r.context),
    submitted_by: String(r.submitted_by),
    created_at: Number(r.created_at),
  }));
}

// ── Solution verifications ──

export async function addVerification(entryId: number, verifiedBy: string, versionTested?: string, environment?: string, notes?: string): Promise<{ id: number }> {
  const db = getWriteDb();
  const result = await db.execute({
    sql: 'INSERT INTO solution_verifications (entry_id, verified_by, version_tested, environment, notes) VALUES (?, ?, ?, ?, ?)',
    args: [entryId, verifiedBy, versionTested || null, environment || null, notes || null],
  });
  return { id: Number(result.lastInsertRowid) };
}

export async function getVerifications(entryId: number): Promise<{ id: number; verified_by: string; version_tested: string | null; environment: string | null; notes: string | null; verified_at: number }[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM solution_verifications WHERE entry_id = ? ORDER BY verified_at DESC',
    args: [entryId],
  });
  return result.rows.map(r => ({
    id: Number(r.id),
    verified_by: String(r.verified_by),
    version_tested: r.version_tested != null ? String(r.version_tested) : null,
    environment: r.environment != null ? String(r.environment) : null,
    notes: r.notes != null ? String(r.notes) : null,
    verified_at: Number(r.verified_at),
  }));
}

export async function getLatestVerification(entryId: number): Promise<{ verified_at: number; version_tested: string | null } | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT verified_at, version_tested FROM solution_verifications WHERE entry_id = ? ORDER BY verified_at DESC LIMIT 1',
    args: [entryId],
  });
  if (result.rows.length === 0) return null;
  return {
    verified_at: Number(result.rows[0].verified_at),
    version_tested: result.rows[0].version_tested != null ? String(result.rows[0].version_tested) : null,
  };
}

// ── Related entries (FTS-based) ──

export async function findRelatedByFTS(title: string, tags: string[], excludeId: number): Promise<{ id: number; related_entries: string }[]> {
  const db = getDb();
  const words = title.replace(/['"]/g, '').split(/\s+/).filter(w => w.length > 2);
  const sanitizedTags = tags.map(t => t.replace(/['"]/g, ''));
  const searchTerms = [...words, ...sanitizedTags].filter(w => w.length > 2);
  if (searchTerms.length === 0) return [];

  try {
    const orQuery = searchTerms.map(w => `"${w}"`).join(' OR ');
    const result = await db.execute({
      sql: `SELECT entries.id, entries.related_entries FROM entries_fts
            JOIN entries ON entries.id = entries_fts.rowid
            WHERE entries_fts MATCH ? AND entries.id != ?
            ORDER BY bm25(entries_fts) LIMIT 5`,
      args: [orQuery, excludeId],
    });
    return result.rows.map(r => ({
      id: Number(r.id),
      related_entries: String(r.related_entries ?? '[]'),
    }));
  } catch {
    return [];
  }
}

// ── Reputation system ──

import { computeNewBadges, type UserStats } from './badges';

export const REP_POINTS = {
  submit: 10,
  upvote_received: 5,
  downvote_received: -2,
  usage_received: 2,
  verification_received: 20,
  entry_outdated: -5,
} as const;

export type RepEventType = keyof typeof REP_POINTS;

const REP_CACHE_COLUMNS: Record<string, string> = {
  submit: 'entries_count',
  upvote_received: 'upvotes_received',
  usage_received: 'usages_received',
  verification_received: 'verifications_received',
};

export async function addRepEvent(username: string, eventType: RepEventType, entryId: number | null, sourceUsername?: string): Promise<void> {
  if (!username || username === 'anonymous') return;
  const db = getWriteDb();
  const points = REP_POINTS[eventType];

  await db.execute({
    sql: 'INSERT INTO reputation_events (username, event_type, points, entry_id, source_username) VALUES (?, ?, ?, ?, ?)',
    args: [username, eventType, points, entryId, sourceUsername || null],
  });

  // UPSERT reputation_cache
  const counterCol = REP_CACHE_COLUMNS[eventType];
  const counterIncrement = counterCol ? `, ${counterCol} = COALESCE(${counterCol}, 0) + 1` : '';

  await db.execute({
    sql: `INSERT INTO reputation_cache (username, total_rep${counterCol ? `, ${counterCol}` : ''}, updated_at)
          VALUES (?, ?${counterCol ? ', 1' : ''}, unixepoch())
          ON CONFLICT(username) DO UPDATE SET
            total_rep = total_rep + ?${counterIncrement},
            updated_at = unixepoch()`,
    args: [username, points, points],
  });

  // Check and award badges
  await checkAndAwardBadges(username);
}

export async function getReputation(username: string): Promise<{
  username: string; total_rep: number; entries_count: number;
  upvotes_received: number; usages_received: number; verifications_received: number;
} | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM reputation_cache WHERE username = ?',
    args: [username],
  });
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    username: String(r.username),
    total_rep: Number(r.total_rep),
    entries_count: Number(r.entries_count),
    upvotes_received: Number(r.upvotes_received),
    usages_received: Number(r.usages_received),
    verifications_received: Number(r.verifications_received),
  };
}

export async function getLeaderboard(opts?: {
  limit?: number;
  period?: 'all' | 'monthly' | 'weekly';
}): Promise<{ username: string; total_rep: number; entries_count: number; badge_count: number }[]> {
  const db = getDb();
  const limit = opts?.limit || 20;
  const period = opts?.period || 'all';

  if (period === 'all') {
    const result = await db.execute({
      sql: `SELECT rc.username, rc.total_rep, rc.entries_count,
                   (SELECT COUNT(*) FROM user_badges ub WHERE ub.username = rc.username) as badge_count
            FROM reputation_cache rc
            ORDER BY rc.total_rep DESC LIMIT ?`,
      args: [limit],
    });
    return result.rows.map(r => ({
      username: String(r.username),
      total_rep: Number(r.total_rep),
      entries_count: Number(r.entries_count),
      badge_count: Number(r.badge_count),
    }));
  }

  const cutoff = Math.floor(Date.now() / 1000) - (period === 'weekly' ? 7 * 86400 : 30 * 86400);
  const result = await db.execute({
    sql: `SELECT re.username, SUM(re.points) as total_rep,
                 (SELECT COUNT(*) FROM entries e WHERE e.submitted_by = re.username) as entries_count,
                 (SELECT COUNT(*) FROM user_badges ub WHERE ub.username = re.username) as badge_count
          FROM reputation_events re
          WHERE re.created_at > ?
          GROUP BY re.username
          ORDER BY total_rep DESC LIMIT ?`,
    args: [cutoff, limit],
  });
  return result.rows.map(r => ({
    username: String(r.username),
    total_rep: Number(r.total_rep),
    entries_count: Number(r.entries_count),
    badge_count: Number(r.badge_count),
  }));
}

// ── Badges ──

export async function getUserBadges(username: string): Promise<{ badge_id: string; earned_at: number }[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT badge_id, earned_at FROM user_badges WHERE username = ? ORDER BY earned_at DESC',
    args: [username],
  });
  return result.rows.map(r => ({ badge_id: String(r.badge_id), earned_at: Number(r.earned_at) }));
}

export async function awardBadge(username: string, badgeId: string): Promise<boolean> {
  const db = getWriteDb();
  try {
    await db.execute({
      sql: 'INSERT INTO user_badges (username, badge_id) VALUES (?, ?)',
      args: [username, badgeId],
    });
    return true;
  } catch {
    return false; // already exists (UNIQUE constraint)
  }
}

export async function checkAndAwardBadges(username: string): Promise<string[]> {
  const rep = await getReputation(username);
  if (!rep) return [];

  const existing = await getUserBadges(username);
  const existingIds = existing.map(b => b.badge_id);
  const stats: UserStats = {
    total_rep: rep.total_rep,
    entries_count: rep.entries_count,
    upvotes_received: rep.upvotes_received,
    usages_received: rep.usages_received,
    verifications_received: rep.verifications_received,
  };

  const newBadges = computeNewBadges(stats, existingIds);
  const awarded: string[] = [];
  for (const badge of newBadges) {
    const success = await awardBadge(username, badge.id);
    if (success) awarded.push(badge.id);
  }
  return awarded;
}

// ── Accounts ──

export async function createAccount(username: string, email: string): Promise<{ id: number; verification_token: string }> {
  const db = getWriteDb();
  const token = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const expires = Math.floor(Date.now() / 1000) + 24 * 3600; // 24 hours
  const result = await db.execute({
    sql: 'INSERT INTO accounts (username, email, verification_token, verification_expires) VALUES (?, ?, ?, ?)',
    args: [username, email, token, expires],
  });
  return { id: Number(result.lastInsertRowid), verification_token: token };
}

export async function verifyEmail(token: string): Promise<{ username: string } | null> {
  const db = getWriteDb();
  const now = Math.floor(Date.now() / 1000);
  const result = await db.execute({
    sql: 'SELECT id, username, verification_expires FROM accounts WHERE verification_token = ?',
    args: [token],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (Number(row.verification_expires) < now) return null;

  await db.execute({
    sql: 'UPDATE accounts SET email_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?',
    args: [row.id],
  });
  return { username: String(row.username) };
}

export async function getAccountByUsername(username: string): Promise<{
  id: number; username: string; email: string; email_verified: boolean; created_at: number;
} | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM accounts WHERE username = ?',
    args: [username],
  });
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: Number(r.id),
    username: String(r.username),
    email: String(r.email),
    email_verified: Number(r.email_verified) === 1,
    created_at: Number(r.created_at),
  };
}

export async function isUsernameClaimed(username: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT 1 FROM accounts WHERE username = ? LIMIT 1',
    args: [username],
  });
  return result.rows.length > 0;
}

// ── Notifications ──

export async function createNotification(username: string, type: string, entryId: number | null, message: string): Promise<{ id: number }> {
  if (!username || username === 'anonymous') return { id: 0 };
  const db = getWriteDb();
  const result = await db.execute({
    sql: 'INSERT INTO notifications (username, type, entry_id, message) VALUES (?, ?, ?, ?)',
    args: [username, type, entryId, message],
  });
  return { id: Number(result.lastInsertRowid) };
}

export async function getNotifications(username: string, opts?: {
  unreadOnly?: boolean; limit?: number;
}): Promise<{ id: number; type: string; entry_id: number | null; message: string; read: boolean; created_at: number }[]> {
  const db = getDb();
  const limit = opts?.limit || 20;
  const where = opts?.unreadOnly ? 'AND read = 0' : '';
  const result = await db.execute({
    sql: `SELECT * FROM notifications WHERE username = ? ${where} ORDER BY created_at DESC LIMIT ?`,
    args: [username, limit],
  });
  return result.rows.map(r => ({
    id: Number(r.id),
    type: String(r.type),
    entry_id: r.entry_id != null ? Number(r.entry_id) : null,
    message: String(r.message),
    read: Number(r.read) === 1,
    created_at: Number(r.created_at),
  }));
}

export async function markNotificationsRead(username: string, ids?: number[]): Promise<void> {
  const db = getWriteDb();
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    await db.execute({
      sql: `UPDATE notifications SET read = 1 WHERE username = ? AND id IN (${placeholders})`,
      args: [username, ...ids],
    });
  } else {
    await db.execute({
      sql: 'UPDATE notifications SET read = 1 WHERE username = ? AND read = 0',
      args: [username],
    });
  }
}

export async function getUnreadCount(username: string): Promise<number> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT COUNT(*) as c FROM notifications WHERE username = ? AND read = 0',
    args: [username],
  });
  return Number(result.rows[0].c);
}

export async function getNotificationPrefs(username: string): Promise<{
  email_frequency: string; notify_upvotes: boolean; notify_usages: boolean;
  notify_verifications: boolean; notify_revisions: boolean; notify_badges: boolean;
}> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM notification_preferences WHERE username = ?',
    args: [username],
  });
  if (result.rows.length === 0) {
    return { email_frequency: 'daily', notify_upvotes: true, notify_usages: true, notify_verifications: true, notify_revisions: true, notify_badges: true };
  }
  const r = result.rows[0];
  return {
    email_frequency: String(r.email_frequency),
    notify_upvotes: Number(r.notify_upvotes) === 1,
    notify_usages: Number(r.notify_usages) === 1,
    notify_verifications: Number(r.notify_verifications) === 1,
    notify_revisions: Number(r.notify_revisions) === 1,
    notify_badges: Number(r.notify_badges) === 1,
  };
}

export async function updateNotificationPrefs(username: string, prefs: Partial<{
  email_frequency: string; notify_upvotes: boolean; notify_usages: boolean;
  notify_verifications: boolean; notify_revisions: boolean; notify_badges: boolean;
}>): Promise<void> {
  const db = getWriteDb();
  const current = await getNotificationPrefs(username);
  const merged = { ...current, ...prefs };
  await db.execute({
    sql: `INSERT INTO notification_preferences (username, email_frequency, notify_upvotes, notify_usages, notify_verifications, notify_revisions, notify_badges)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET
            email_frequency = excluded.email_frequency,
            notify_upvotes = excluded.notify_upvotes,
            notify_usages = excluded.notify_usages,
            notify_verifications = excluded.notify_verifications,
            notify_revisions = excluded.notify_revisions,
            notify_badges = excluded.notify_badges`,
    args: [username, merged.email_frequency, merged.notify_upvotes ? 1 : 0, merged.notify_usages ? 1 : 0, merged.notify_verifications ? 1 : 0, merged.notify_revisions ? 1 : 0, merged.notify_badges ? 1 : 0],
  });
}

// ── User entries for profile ──

export async function getUserEntries(username: string, limit: number = 5): Promise<Entry[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM entries WHERE submitted_by = ? ORDER BY (upvotes - downvotes + usage_count * 2) DESC LIMIT ?',
    args: [username, limit],
  });
  return result.rows.map(rowToEntry);
}

export async function importEntries(entries: {
  title: string;
  category: string;
  tags?: string[];
  problem: string;
  solution: string;
  why?: string;
  gotchas?: string[];
  learned_from?: string;
  submitted_by?: string;
  language?: string | null;
  framework?: string | null;
  severity?: string;
  environment?: string[];
  error_messages?: string[];
  keywords?: string[];
  context?: string;
  version_info?: string;
  code_snippets?: { code: string; lang?: string; description?: string }[];
  related_entries?: number[];
}[]): Promise<{ imported: number }> {
  const db = getWriteDb();
  let imported = 0;
  await db.execute('BEGIN');
  try {
    for (const entry of entries) {
      await insertEntry(entry);
      imported++;
    }
    await db.execute('COMMIT');
  } catch (e) {
    await db.execute('ROLLBACK');
    throw e;
  }
  return { imported };
}
