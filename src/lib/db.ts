import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = join(process.cwd(), 'db', 'hivebrain.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  const schema = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf-8');
  db.exec(schema);

  return db;
}

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
}

export function getAllEntries(opts?: {
  category?: string;
  tag?: string;
  language?: string;
  framework?: string;
  severity?: string;
  environment?: string;
  limit?: number;
  offset?: number;
  cursor?: number;
}): Entry[] {
  const db = getDb();
  const params: any[] = [];
  const conditions: string[] = [];
  let useJsonEach = false;

  if (opts?.tag) {
    useJsonEach = true;
    conditions.push('tag_each.value = ?');
    params.push(opts.tag);
  }
  if (opts?.category) {
    conditions.push('entries.category = ?');
    params.push(opts.category);
  }
  if (opts?.language) {
    conditions.push('entries.language = ?');
    params.push(opts.language);
  }
  if (opts?.framework) {
    conditions.push('entries.framework = ?');
    params.push(opts.framework);
  }
  if (opts?.severity) {
    conditions.push('entries.severity = ?');
    params.push(opts.severity);
  }
  if (opts?.environment) {
    conditions.push('EXISTS (SELECT 1 FROM json_each(entries.environment) WHERE value = ?)');
    params.push(opts.environment);
  }

  if (opts?.cursor) {
    conditions.push('entries.id < ?');
    params.push(opts.cursor);
  }

  let query = useJsonEach
    ? 'SELECT entries.* FROM entries, json_each(entries.tags) AS tag_each'
    : 'SELECT entries.* FROM entries';

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY entries.id DESC';

  if (opts?.limit) {
    query += ' LIMIT ?';
    params.push(opts.limit);
  }
  if (opts?.offset && !opts?.cursor) {
    query += ' OFFSET ?';
    params.push(opts.offset);
  }

  return db.prepare(query).all(...params) as Entry[];
}

export function getEntry(id: number): Entry | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as Entry | undefined;
}

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

export function searchEntries(query: string): (Entry & { title_hl?: string; problem_hl?: string; solution_hl?: string; _score?: number })[] {
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
  const allResults: (Entry & { _score: number })[] = [];

  function addResults(rows: any[], score: number) {
    for (const row of rows) {
      const existingScore = scoreById.get(row.id);
      if (existingScore === undefined) {
        scoreById.set(row.id, score);
        allResults.push({ ...row, _score: score });
      } else if (score > existingScore) {
        // Upgrade to the higher score
        scoreById.set(row.id, score);
        const idx = allResults.findIndex(r => r.id === row.id);
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

  // ── Layer 1: FTS5 full-text search (best quality) ──
  // Use bm25() for proper relevance scoring — lower = more relevant in SQLite FTS5
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
    // 1a: AND query (original words only, not synonyms) — highest precision
    if (searchWords.length > 1) {
      const andQuery = searchWords.map(w => `"${w}"`).join(' AND ');
      try {
        const andResults = db.prepare(ftsSQL).all(andQuery) as any[];
        addResults(andResults, 100);
      } catch { /* invalid FTS syntax, skip */ }
    }

    // 1b: AND query with synonym expansion
    if (expanded.length > 1 && expanded.length !== searchWords.length) {
      // Group each original word + its synonyms with OR, then AND groups together
      const groups = searchWords.map(w => {
        const lower = w.toLowerCase();
        const syns = SYNONYMS[lower] || [];
        const all = [w, ...syns];
        return all.length === 1 ? `"${all[0]}"` : `(${all.map(s => `"${s}"`).join(' OR ')})`;
      });
      const groupedAndQuery = groups.join(' AND ');
      try {
        const andSynResults = db.prepare(ftsSQL).all(groupedAndQuery) as any[];
        addResults(andSynResults, 95);
      } catch { /* skip */ }
    }

    // 1c: Prefix matching (AND) — "hydrat" matches "hydration"
    if (searchWords.length > 1) {
      const prefixQuery = searchWords.map(w => `${w}*`).join(' AND ');
      try {
        const prefixResults = db.prepare(ftsSQL).all(prefixQuery) as any[];
        addResults(prefixResults, 85);
      } catch { /* skip */ }
    }

    // 1d: Individual exact terms (catches single-word queries)
    if (searchWords.length === 1) {
      try {
        addResults(db.prepare(ftsSQL).all(`"${expanded[0]}"`) as any[], 90);
      } catch { /* skip */ }
      // Try each synonym individually
      for (const syn of expanded.slice(1)) {
        try {
          addResults(db.prepare(ftsSQL).all(`"${syn}"`) as any[], 85);
        } catch { /* skip */ }
      }
      // Prefix for single word
      try {
        addResults(db.prepare(ftsSQL).all(`${expanded[0]}*`) as any[], 75);
      } catch { /* skip */ }
    }

    // 1e: OR query — only if AND yielded very few results, and only significant terms
    // Score by how many terms each result matches, and require >= 50% match ratio
    if (allResults.length < 3 && expanded.length > 1) {
      const sigTerms = expanded.filter(w => isSignificantWord(w));
      if (sigTerms.length > 0) {
        // Query each significant term individually and track match counts per entry ID
        const matchCounts = new Map<number, number>();
        const orRowsById = new Map<number, any>();
        for (const term of sigTerms) {
          try {
            const termResults = db.prepare(ftsSQL).all(`"${term}"`) as any[];
            for (const row of termResults) {
              matchCounts.set(row.id, (matchCounts.get(row.id) || 0) + 1);
              if (!orRowsById.has(row.id)) orRowsById.set(row.id, row);
            }
          } catch { /* skip individual term */ }
        }

        const totalSigTerms = sigTerms.length;
        const minMatches = searchWords.length >= 2 ? Math.ceil(totalSigTerms * 0.5) : 1;

        for (const [id, count] of matchCounts) {
          if (count < minMatches) continue;
          // Scale score by match ratio: 1/N → 20, 2/N → 35, all → 45
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
  // Track which layers AND which search terms each entry matches
  const layerMatchCounts = new Map<number, number>();
  const termMatchCounts = new Map<number, Set<string>>();
  const layerRows = new Map<number, any>();

  function trackLayerMatch(rows: any[], matchedTerm: string) {
    for (const row of rows) {
      layerMatchCounts.set(row.id, (layerMatchCounts.get(row.id) || 0) + 1);
      if (!termMatchCounts.has(row.id)) termMatchCounts.set(row.id, new Set());
      termMatchCounts.get(row.id)!.add(matchedTerm.toLowerCase());
      if (!layerRows.has(row.id)) layerRows.set(row.id, row);
    }
  }

  // Layer 2: Exact tag matching — per search term for granular tracking
  for (const term of expanded) {
    try {
      const tagResults = db.prepare(`
        SELECT DISTINCT entries.* FROM entries, json_each(entries.tags) AS t
        WHERE LOWER(t.value) = ?
        LIMIT 20
      `).all(term.toLowerCase()) as any[];
      trackLayerMatch(tagResults, term);
    } catch { /* skip */ }
  }

  // Layer 3: Language/framework column match — per search term
  for (const term of expanded) {
    try {
      const metaResults = db.prepare(`
        SELECT * FROM entries
        WHERE LOWER(language) = ? OR LOWER(framework) = ?
        LIMIT 20
      `).all(term.toLowerCase(), term.toLowerCase()) as any[];
      trackLayerMatch(metaResults, term);
    } catch { /* skip */ }
  }

  // Layer 5: Keyword matching — per search term
  for (const term of expanded) {
    try {
      const kwResults = db.prepare(`
        SELECT DISTINCT entries.* FROM entries, json_each(entries.keywords) AS kw
        WHERE LOWER(kw.value) = ?
        LIMIT 20
      `).all(term.toLowerCase()) as any[];
      trackLayerMatch(kwResults, term);
    } catch { /* skip */ }
  }

  // Score by: how many distinct search terms matched AND across how many layers
  for (const [id] of layerMatchCounts) {
    const layers = layerMatchCounts.get(id) || 0;
    const termsMatched = termMatchCounts.get(id)?.size || 0;
    const termRatio = termsMatched / searchWords.length;

    let layerScore: number;
    if (termRatio >= 0.8 && layers >= 2) layerScore = 80;      // most terms + multi-layer
    else if (termRatio >= 0.8) layerScore = 70;                  // most terms, single layer
    else if (layers >= 2) layerScore = 55;                       // few terms but multi-layer
    else if (searchWords.length === 1) layerScore = 65;          // single-word query, any match is good
    else layerScore = 30;                                         // multi-word query, matched only 1 term

    addResults([layerRows.get(id)!], layerScore);
  }

  // ── Layer 4: Error message substring search (critical for debugging) ──
  // Error messages are JSON arrays — FTS tokenizes them poorly.
  // Use LIKE for substring matching against the raw JSON.
  // Only use specific/long terms to avoid matching "error" in every entry.
  try {
    // Filter out generic words that appear in almost every error_messages field
    const ERROR_NOISE = new Set(['error', 'failed', 'cannot', 'unable', 'invalid', 'could', 'found', 'module']);
    const errorTerms = expanded.filter(w => w.length >= 5 && !STOP_WORDS.has(w.toLowerCase()) && !ERROR_NOISE.has(w.toLowerCase()));
    if (errorTerms.length > 0) {
      // First try: match the full original query as a substring (best for pasted error messages)
      const fullQuery = sanitized;
      if (fullQuery.length >= 8) {
        const fullResults = db.prepare(`
          SELECT * FROM entries WHERE error_messages LIKE ? LIMIT 10
        `).all(`%${fullQuery}%`) as any[];
        addResults(fullResults, 90);
      }

      // Second: match individual specific terms (not short common words like "error")
      const termClauses = errorTerms.map(() => 'error_messages LIKE ?').join(' OR ');
      const termResults = db.prepare(`
        SELECT * FROM entries WHERE ${termClauses} LIMIT 20
      `).all(...errorTerms.map(w => `%${w}%`)) as any[];
      addResults(termResults, 75);
    }
  } catch { /* skip */ }

  // ── Layer 5b: Environment JSON array search ──
  try {
    const envResults = db.prepare(`
      SELECT DISTINCT entries.* FROM entries, json_each(entries.environment) AS env
      WHERE LOWER(env.value) IN (${expanded.map(() => '?').join(',')})
      LIMIT 20
    `).all(...expanded.map(w => w.toLowerCase())) as any[];
    addResults(envResults, 60);
  } catch { /* skip */ }

  // ── Layer 6: Broad LIKE fallback (catches anything the above missed) ──
  if (allResults.length < 3) {
    try {
      const likeTerms = expanded.filter(isSignificantWord);
      if (likeTerms.length > 0) {
        const likeClauses = likeTerms.map(() =>
          '(title LIKE ? OR problem LIKE ? OR solution LIKE ? OR tags LIKE ? OR error_messages LIKE ? OR keywords LIKE ?)'
        ).join(' OR ');
        const likeParams = likeTerms.flatMap(w => {
          const p = `%${w}%`;
          return [p, p, p, p, p, p];
        });
        const likeResults = db.prepare(`SELECT * FROM entries WHERE ${likeClauses} LIMIT 20`).all(...likeParams) as any[];
        addResults(likeResults, 30);
      }
    } catch { /* skip */ }
  }

  // Apply title boost before final sort
  applyTitleBoost();

  // Sort by score (highest first)
  allResults.sort((a, b) => b._score - a._score);

  // Drop noise: remove results scoring less than 40% of the top result
  // This prevents weak OR/tag matches from cluttering results when strong AND matches exist
  if (allResults.length > 1) {
    const topScore = allResults[0]._score;
    const threshold = topScore * 0.4;
    const filtered = allResults.filter(r => r._score >= threshold);
    return filtered.slice(0, 50);
  }

  return allResults.slice(0, 50);
}

export function insertEntry(entry: {
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
}): { id: number } {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO entries (
      title, category, tags, problem, solution, why, gotchas,
      learned_from, submitted_by,
      language, framework, severity, environment,
      error_messages, keywords, context, version_info,
      code_snippets, related_entries
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
  );
  return { id: Number(result.lastInsertRowid) };
}

export function getStats() {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as count FROM entries').get() as any).count;
  const byCategory = db.prepare(
    'SELECT category, COUNT(*) as count FROM entries GROUP BY category'
  ).all() as { category: string; count: number }[];
  const allTags = db.prepare('SELECT tags FROM entries').all() as { tags: string }[];

  const tagCounts: Record<string, number> = {};
  for (const row of allTags) {
    const tags = JSON.parse(row.tags) as string[];
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const languageRows = db.prepare(
    "SELECT language, COUNT(*) as count FROM entries WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY count DESC"
  ).all() as { language: string; count: number }[];
  const languageCounts: Record<string, number> = {};
  for (const row of languageRows) {
    languageCounts[row.language] = row.count;
  }

  const frameworkRows = db.prepare(
    "SELECT framework, COUNT(*) as count FROM entries WHERE framework IS NOT NULL AND framework != '' GROUP BY framework ORDER BY count DESC"
  ).all() as { framework: string; count: number }[];
  const frameworkCounts: Record<string, number> = {};
  for (const row of frameworkRows) {
    frameworkCounts[row.framework] = row.count;
  }

  const severityRows = db.prepare(
    "SELECT severity, COUNT(*) as count FROM entries WHERE severity IS NOT NULL AND severity != '' GROUP BY severity ORDER BY count DESC"
  ).all() as { severity: string; count: number }[];
  const severityCounts: Record<string, number> = {};
  for (const row of severityRows) {
    severityCounts[row.severity] = row.count;
  }

  const allEnvironments = db.prepare('SELECT environment FROM entries').all() as { environment: string }[];
  const environmentCounts: Record<string, number> = {};
  for (const row of allEnvironments) {
    const envs = JSON.parse(row.environment || '[]') as string[];
    for (const env of envs) {
      environmentCounts[env] = (environmentCounts[env] || 0) + 1;
    }
  }

  return { total, byCategory, tagCounts, languageCounts, frameworkCounts, severityCounts, environmentCounts };
}
