import { createHash } from 'node:crypto';
import { getDb, getWriteDb } from './db';

// ── Types ──

export interface Wiki {
  id: number;
  owner: string;
  slug: string;
  full_slug: string;
  description: string | null;
  schema_content: string | null;
  is_public: boolean;
  tags: string[];
  page_count: number;
  source_count: number;
  created_at: string;
  updated_at: string;
}

export interface WikiSource {
  id: number;
  wiki_id: number;
  path: string;
  content: string;
  content_hash: string;
  mime_type: string;
  ingested_by: string;
  created_at: string;
}

export interface WikiPage {
  id: number;
  wiki_id: number;
  path: string;
  content: string;
  content_hash: string;
  revision: number;
  wikilinks: string[];
  created_at: string;
  updated_at: string;
}

export interface WikiPageRevision {
  id: number;
  page_id: number;
  path: string;
  content: string;
  content_hash: string;
  revision: number;
  message: string | null;
  pushed_by: string;
  created_at: string;
}

export interface WikiLogEntry {
  id: number;
  wiki_id: number;
  operation: 'ingest' | 'query' | 'lint';
  summary: string;
  details: string | null;
  performed_by: string;
  created_at: string;
}

export interface WikiPageListing {
  id: number;
  path: string;
  revision: number;
  content_hash: string;
  wikilinks: string[];
  updated_at: string;
}

export interface WikiSourceListing {
  id: number;
  path: string;
  content_hash: string;
  mime_type: string;
  ingested_by: string;
  created_at: string;
}

export interface PushPageResult {
  page_id: number;
  path: string;
  changed: boolean;
  revision: number;
}

export interface WikiSearchResult {
  wiki_id: number;
  wiki_full_slug: string;
  wiki_description: string | null;
  page_id: number;
  page_path: string;
  snippet: string;
}

// ── Helpers ──

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function ts(unixSeconds: number | bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

export function extractWikilinks(content: string): string[] {
  const matches = content.match(/\[\[(.+?)\]\]/g);
  if (!matches) return [];
  const links = new Set<string>();
  for (const m of matches) {
    const inner = m.slice(2, -2).split('|')[0].trim();
    if (inner) links.add(inner);
  }
  return [...links];
}

function rowToWiki(row: any): Wiki {
  return {
    id: Number(row.id),
    owner: String(row.owner),
    slug: String(row.slug),
    full_slug: String(row.full_slug),
    description: row.description ? String(row.description) : null,
    schema_content: row.schema_content ? String(row.schema_content) : null,
    is_public: Number(row.is_public) === 1,
    tags: JSON.parse(String(row.tags || '[]')),
    page_count: Number(row.page_count ?? 0),
    source_count: Number(row.source_count ?? 0),
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

function rowToSource(row: any): WikiSource {
  return {
    id: Number(row.id),
    wiki_id: Number(row.wiki_id),
    path: String(row.path),
    content: String(row.content),
    content_hash: String(row.content_hash),
    mime_type: String(row.mime_type || 'text/markdown'),
    ingested_by: String(row.ingested_by || 'anonymous'),
    created_at: ts(row.created_at),
  };
}

function rowToPage(row: any): WikiPage {
  return {
    id: Number(row.id),
    wiki_id: Number(row.wiki_id),
    path: String(row.path),
    content: String(row.content),
    content_hash: String(row.content_hash),
    revision: Number(row.revision),
    wikilinks: JSON.parse(String(row.wikilinks || '[]')),
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

function rowToRevision(row: any): WikiPageRevision {
  return {
    id: Number(row.id),
    page_id: Number(row.page_id),
    path: String(row.path),
    content: String(row.content),
    content_hash: String(row.content_hash),
    revision: Number(row.revision),
    message: row.message ? String(row.message) : null,
    pushed_by: String(row.pushed_by || 'anonymous'),
    created_at: ts(row.created_at),
  };
}

function rowToLogEntry(row: any): WikiLogEntry {
  return {
    id: Number(row.id),
    wiki_id: Number(row.wiki_id),
    operation: String(row.operation) as WikiLogEntry['operation'],
    summary: String(row.summary),
    details: row.details ? String(row.details) : null,
    performed_by: String(row.performed_by || 'anonymous'),
    created_at: ts(row.created_at),
  };
}

// ── Wiki CRUD ──

export async function createWiki(opts: {
  owner: string;
  slug: string;
  description?: string;
  schema_content?: string;
  is_public?: boolean;
  tags?: string[];
}): Promise<Wiki> {
  const db = getWriteDb();
  const slug = opts.slug.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const full_slug = `${opts.owner}/${slug}`;

  await db.execute({
    sql: `INSERT INTO wikis (owner, slug, full_slug, description, schema_content, is_public, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [opts.owner, slug, full_slug, opts.description || null,
      opts.schema_content || null, opts.is_public !== false ? 1 : 0,
      JSON.stringify(opts.tags || [])],
  });

  return (await getWiki(full_slug))!;
}

export async function getWiki(fullSlug: string): Promise<Wiki | null> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT w.*,
            (SELECT COUNT(*) FROM wiki_pages WHERE wiki_id = w.id) as page_count,
            (SELECT COUNT(*) FROM wiki_sources WHERE wiki_id = w.id) as source_count
          FROM wikis w WHERE w.full_slug = ?`,
    args: [fullSlug],
  });
  if (result.rows.length === 0) return null;
  return rowToWiki(result.rows[0]);
}

export async function getWikiById(id: number): Promise<Wiki | null> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT w.*,
            (SELECT COUNT(*) FROM wiki_pages WHERE wiki_id = w.id) as page_count,
            (SELECT COUNT(*) FROM wiki_sources WHERE wiki_id = w.id) as source_count
          FROM wikis w WHERE w.id = ?`,
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return rowToWiki(result.rows[0]);
}

export async function listWikis(opts?: {
  owner?: string;
  is_public?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ wikis: Wiki[]; total: number }> {
  const db = getDb();
  const conditions: string[] = [];
  const args: any[] = [];

  if (opts?.owner) { conditions.push('w.owner = ?'); args.push(opts.owner); }
  if (opts?.is_public !== undefined) { conditions.push('w.is_public = ?'); args.push(opts.is_public ? 1 : 0); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const countResult = await db.execute({ sql: `SELECT COUNT(*) as c FROM wikis w ${where}`, args });
  const total = Number(countResult.rows[0].c);

  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;
  const result = await db.execute({
    sql: `SELECT w.*,
            (SELECT COUNT(*) FROM wiki_pages WHERE wiki_id = w.id) as page_count,
            (SELECT COUNT(*) FROM wiki_sources WHERE wiki_id = w.id) as source_count
          FROM wikis w ${where} ORDER BY w.updated_at DESC LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  return { wikis: result.rows.map(r => rowToWiki(r)), total };
}

export async function updateWiki(id: number, updates: {
  description?: string;
  schema_content?: string;
  is_public?: boolean;
  tags?: string[];
}): Promise<Wiki | null> {
  const db = getWriteDb();
  const sets: string[] = ['updated_at = unixepoch()'];
  const args: any[] = [];

  if (updates.description !== undefined) { sets.push('description = ?'); args.push(updates.description); }
  if (updates.schema_content !== undefined) { sets.push('schema_content = ?'); args.push(updates.schema_content); }
  if (updates.is_public !== undefined) { sets.push('is_public = ?'); args.push(updates.is_public ? 1 : 0); }
  if (updates.tags !== undefined) { sets.push('tags = ?'); args.push(JSON.stringify(updates.tags)); }

  args.push(id);
  await db.execute({ sql: `UPDATE wikis SET ${sets.join(', ')} WHERE id = ?`, args });
  return getWikiById(id);
}

export async function deleteWiki(id: number): Promise<boolean> {
  const db = getWriteDb();
  // Manual cascade: log → revisions → FTS cleanup → pages → sources → wiki
  await db.execute({ sql: 'DELETE FROM wiki_log WHERE wiki_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM wiki_page_revisions WHERE wiki_id = ?', args: [id] });
  const pages = await db.execute({ sql: 'SELECT id, path, content FROM wiki_pages WHERE wiki_id = ?', args: [id] });
  for (const p of pages.rows) {
    try {
      await db.execute({
        sql: `INSERT INTO wikis_fts(wikis_fts, rowid, path, content) VALUES ('delete', ?, ?, ?)`,
        args: [Number(p.id), String(p.path), String(p.content)],
      });
    } catch {}
  }
  await db.execute({ sql: 'DELETE FROM wiki_pages WHERE wiki_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM wiki_sources WHERE wiki_id = ?', args: [id] });
  const result = await db.execute({ sql: 'DELETE FROM wikis WHERE id = ?', args: [id] });
  return Number(result.rowsAffected) > 0;
}

// ── Source Operations (immutable) ──

export async function pushSource(opts: {
  wiki_id: number;
  path: string;
  content: string;
  mime_type?: string;
  ingested_by?: string;
}): Promise<{ source_id: number; path: string; already_existed: boolean }> {
  const db = getWriteDb();
  const hash = hashContent(opts.content);

  // Check if source already exists
  const existing = await db.execute({
    sql: 'SELECT id FROM wiki_sources WHERE wiki_id = ? AND path = ?',
    args: [opts.wiki_id, opts.path],
  });

  if (existing.rows.length > 0) {
    return { source_id: Number(existing.rows[0].id), path: opts.path, already_existed: true };
  }

  const result = await db.execute({
    sql: `INSERT INTO wiki_sources (wiki_id, path, content, content_hash, mime_type, ingested_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [opts.wiki_id, opts.path, opts.content, hash,
      opts.mime_type || 'text/markdown', opts.ingested_by || 'anonymous'],
  });

  await db.execute({ sql: 'UPDATE wikis SET updated_at = unixepoch() WHERE id = ?', args: [opts.wiki_id] });
  return { source_id: Number(result.lastInsertRowid), path: opts.path, already_existed: false };
}

export async function getSource(wikiId: number, path: string): Promise<WikiSource | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM wiki_sources WHERE wiki_id = ? AND path = ?',
    args: [wikiId, path],
  });
  if (result.rows.length === 0) return null;
  return rowToSource(result.rows[0]);
}

export async function listSources(wikiId: number): Promise<WikiSourceListing[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, path, content_hash, mime_type, ingested_by, created_at FROM wiki_sources WHERE wiki_id = ? ORDER BY path ASC',
    args: [wikiId],
  });
  return result.rows.map(r => ({
    id: Number(r.id),
    path: String(r.path),
    content_hash: String(r.content_hash),
    mime_type: String(r.mime_type || 'text/markdown'),
    ingested_by: String(r.ingested_by || 'anonymous'),
    created_at: ts(Number(r.created_at)),
  }));
}

export async function deleteSource(wikiId: number, path: string): Promise<boolean> {
  const db = getWriteDb();
  const result = await db.execute({
    sql: 'DELETE FROM wiki_sources WHERE wiki_id = ? AND path = ?',
    args: [wikiId, path],
  });
  return Number(result.rowsAffected) > 0;
}

// ── Page Operations (versioned, with wikilinks) ──

export async function pushPage(opts: {
  wiki_id: number;
  path: string;
  content: string;
  message?: string;
  pushed_by?: string;
}): Promise<PushPageResult> {
  const db = getWriteDb();
  const hash = hashContent(opts.content);
  const pushedBy = opts.pushed_by || 'anonymous';
  const wikilinks = JSON.stringify(extractWikilinks(opts.content));

  const existing = await db.execute({
    sql: 'SELECT id, content_hash, revision FROM wiki_pages WHERE wiki_id = ? AND path = ?',
    args: [opts.wiki_id, opts.path],
  });

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const pageId = Number(row.id);
    const currentRev = Number(row.revision);

    if (String(row.content_hash) === hash) {
      return { page_id: pageId, path: opts.path, changed: false, revision: currentRev };
    }

    const newRev = currentRev + 1;
    await db.execute({
      sql: `UPDATE wiki_pages SET content = ?, content_hash = ?, revision = ?, wikilinks = ?, updated_at = unixepoch() WHERE id = ?`,
      args: [opts.content, hash, newRev, wikilinks, pageId],
    });

    await db.execute({
      sql: `INSERT INTO wiki_page_revisions (page_id, wiki_id, path, content, content_hash, revision, message, pushed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [pageId, opts.wiki_id, opts.path, opts.content, hash, newRev, opts.message || null, pushedBy],
    });

    await db.execute({ sql: 'UPDATE wikis SET updated_at = unixepoch() WHERE id = ?', args: [opts.wiki_id] });
    return { page_id: pageId, path: opts.path, changed: true, revision: newRev };
  }

  // New page
  const result = await db.execute({
    sql: `INSERT INTO wiki_pages (wiki_id, path, content, content_hash, wikilinks) VALUES (?, ?, ?, ?, ?)`,
    args: [opts.wiki_id, opts.path, opts.content, hash, wikilinks],
  });

  const pageId = Number(result.lastInsertRowid);
  await db.execute({
    sql: `INSERT INTO wiki_page_revisions (page_id, wiki_id, path, content, content_hash, revision, message, pushed_by)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    args: [pageId, opts.wiki_id, opts.path, opts.content, hash, opts.message || null, pushedBy],
  });

  await db.execute({ sql: 'UPDATE wikis SET updated_at = unixepoch() WHERE id = ?', args: [opts.wiki_id] });
  return { page_id: pageId, path: opts.path, changed: true, revision: 1 };
}

export async function pushPages(opts: {
  wiki_id: number;
  pages: { path: string; content: string }[];
  message?: string;
  pushed_by?: string;
}): Promise<PushPageResult[]> {
  const results: PushPageResult[] = [];
  for (const page of opts.pages) {
    results.push(await pushPage({
      wiki_id: opts.wiki_id, path: page.path, content: page.content,
      message: opts.message, pushed_by: opts.pushed_by,
    }));
  }
  return results;
}

export async function getPage(wikiId: number, path: string): Promise<WikiPage | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM wiki_pages WHERE wiki_id = ? AND path = ?',
    args: [wikiId, path],
  });
  if (result.rows.length === 0) return null;
  return rowToPage(result.rows[0]);
}

export async function listPages(wikiId: number): Promise<WikiPageListing[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, path, revision, content_hash, wikilinks, updated_at FROM wiki_pages WHERE wiki_id = ? ORDER BY path ASC',
    args: [wikiId],
  });
  return result.rows.map(r => ({
    id: Number(r.id),
    path: String(r.path),
    revision: Number(r.revision),
    content_hash: String(r.content_hash),
    wikilinks: JSON.parse(String(r.wikilinks || '[]')),
    updated_at: ts(Number(r.updated_at)),
  }));
}

export async function deletePage(wikiId: number, path: string): Promise<boolean> {
  const db = getWriteDb();
  await db.execute({
    sql: 'DELETE FROM wiki_page_revisions WHERE wiki_id = ? AND path = ?',
    args: [wikiId, path],
  });
  const result = await db.execute({
    sql: 'DELETE FROM wiki_pages WHERE wiki_id = ? AND path = ?',
    args: [wikiId, path],
  });
  return Number(result.rowsAffected) > 0;
}

// ── Revisions ──

export async function getPageRevisions(pageId: number, limit = 20, offset = 0): Promise<WikiPageRevision[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM wiki_page_revisions WHERE page_id = ? ORDER BY revision DESC LIMIT ? OFFSET ?',
    args: [pageId, limit, offset],
  });
  return result.rows.map(rowToRevision);
}

export async function getPageAtRevision(pageId: number, revision: number): Promise<WikiPageRevision | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM wiki_page_revisions WHERE page_id = ? AND revision = ?',
    args: [pageId, revision],
  });
  if (result.rows.length === 0) return null;
  return rowToRevision(result.rows[0]);
}

export async function getWikiRevisions(wikiId: number, limit = 50, offset = 0): Promise<WikiPageRevision[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM wiki_page_revisions WHERE wiki_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    args: [wikiId, limit, offset],
  });
  return result.rows.map(rowToRevision);
}

// ── Log ──

export async function appendLog(opts: {
  wiki_id: number;
  operation: 'ingest' | 'query' | 'lint';
  summary: string;
  details?: string;
  performed_by?: string;
}): Promise<WikiLogEntry> {
  const db = getWriteDb();
  const result = await db.execute({
    sql: `INSERT INTO wiki_log (wiki_id, operation, summary, details, performed_by)
          VALUES (?, ?, ?, ?, ?)`,
    args: [opts.wiki_id, opts.operation, opts.summary,
      opts.details || null, opts.performed_by || 'anonymous'],
  });
  return {
    id: Number(result.lastInsertRowid),
    wiki_id: opts.wiki_id,
    operation: opts.operation,
    summary: opts.summary,
    details: opts.details || null,
    performed_by: opts.performed_by || 'anonymous',
    created_at: new Date().toISOString(),
  };
}

export async function getLog(wikiId: number, limit = 50, offset = 0): Promise<WikiLogEntry[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM wiki_log WHERE wiki_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    args: [wikiId, limit, offset],
  });
  return result.rows.map(rowToLogEntry);
}

// ── Index Generation ──

export async function generateIndex(wikiId: number): Promise<string> {
  const pages = await listPages(wikiId);
  const db = getDb();

  if (pages.length === 0) return '# Index\n\nNo pages yet.';

  // Group by directory
  const dirs = new Map<string, WikiPageListing[]>();
  const root: WikiPageListing[] = [];

  for (const p of pages) {
    const parts = p.path.split('/');
    if (parts.length === 1) {
      root.push(p);
    } else {
      const dir = parts[0];
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir)!.push(p);
    }
  }

  // Build markdown
  const lines: string[] = ['# Index', '', `${pages.length} pages in this wiki.`, ''];

  // Get first lines for summaries
  async function getFirstLine(path: string): Promise<string> {
    const page = await getPage(wikiId, path);
    if (!page) return '';
    const first = page.content.split('\n').find(l => l.trim() && !l.startsWith('#'));
    return first?.trim().slice(0, 100) || '';
  }

  if (root.length > 0) {
    for (const p of root) {
      const summary = await getFirstLine(p.path);
      lines.push(`- [[${p.path}]] (v${p.revision}) — ${summary}`);
    }
    lines.push('');
  }

  for (const [dir, files] of [...dirs.entries()].sort()) {
    lines.push(`## ${dir}/`);
    for (const p of files) {
      const summary = await getFirstLine(p.path);
      const name = p.path.split('/').slice(1).join('/');
      lines.push(`- [[${p.path}|${name}]] (v${p.revision}) — ${summary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Search ──

export async function searchWikis(query: string, opts?: {
  wiki?: string;
  limit?: number;
}): Promise<WikiSearchResult[]> {
  const db = getDb();
  const limit = opts?.limit || 10;

  const terms = query.trim().split(/\s+/).filter(Boolean);
  const ftsQuery = terms.map(t => `"${t.replace(/"/g, '')}"`).join(' ');

  let sql: string;
  let args: any[];

  if (opts?.wiki) {
    sql = `SELECT wp.id as page_id, wp.wiki_id, wp.path as page_path,
             snippet(wikis_fts, 1, '**', '**', '...', 40) as snippet,
             w.full_slug as wiki_full_slug, w.description as wiki_description
           FROM wikis_fts
           JOIN wiki_pages wp ON wp.id = wikis_fts.rowid
           JOIN wikis w ON w.id = wp.wiki_id
           WHERE wikis_fts MATCH ? AND w.full_slug = ?
           ORDER BY rank LIMIT ?`;
    args = [ftsQuery, opts.wiki, limit];
  } else {
    sql = `SELECT wp.id as page_id, wp.wiki_id, wp.path as page_path,
             snippet(wikis_fts, 1, '**', '**', '...', 40) as snippet,
             w.full_slug as wiki_full_slug, w.description as wiki_description
           FROM wikis_fts
           JOIN wiki_pages wp ON wp.id = wikis_fts.rowid
           JOIN wikis w ON w.id = wp.wiki_id
           WHERE wikis_fts MATCH ? AND w.is_public = 1
           ORDER BY rank LIMIT ?`;
    args = [ftsQuery, limit];
  }

  try {
    const result = await db.execute({ sql, args });
    return result.rows.map(r => ({
      wiki_id: Number(r.wiki_id),
      wiki_full_slug: String(r.wiki_full_slug),
      wiki_description: r.wiki_description ? String(r.wiki_description) : null,
      page_id: Number(r.page_id),
      page_path: String(r.page_path),
      snippet: String(r.snippet || ''),
    }));
  } catch {
    return [];
  }
}

// ── Lint Helpers ──

export async function findOrphanPages(wikiId: number): Promise<string[]> {
  const pages = await listPages(wikiId);
  const allLinks = new Set<string>();
  for (const p of pages) {
    for (const link of p.wikilinks) allLinks.add(link);
  }
  // Pages that no other page links to
  return pages
    .filter(p => {
      const name = p.path.replace(/\.md$/, '');
      return !allLinks.has(name) && !allLinks.has(p.path) && p.path !== 'index.md';
    })
    .map(p => p.path);
}

export async function findBrokenLinks(wikiId: number): Promise<{ page: string; broken_link: string }[]> {
  const pages = await listPages(wikiId);
  const pagePaths = new Set(pages.map(p => p.path));
  const pageNames = new Set(pages.map(p => p.path.replace(/\.md$/, '')));

  const broken: { page: string; broken_link: string }[] = [];
  for (const p of pages) {
    for (const link of p.wikilinks) {
      if (!pagePaths.has(link) && !pagePaths.has(link + '.md') && !pageNames.has(link)) {
        broken.push({ page: p.path, broken_link: link });
      }
    }
  }
  return broken;
}

export async function findStalePages(wikiId: number, daysSinceUpdate = 30): Promise<string[]> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - (daysSinceUpdate * 86400);
  const result = await db.execute({
    sql: 'SELECT path FROM wiki_pages WHERE wiki_id = ? AND updated_at < ? ORDER BY updated_at ASC',
    args: [wikiId, cutoff],
  });
  return result.rows.map(r => String(r.path));
}

// ── Stats ──

export async function getWikiStats(wikiId: number): Promise<{
  page_count: number;
  source_count: number;
  log_count: number;
  last_activity: string | null;
}> {
  const db = getDb();
  const pageResult = await db.execute({ sql: 'SELECT COUNT(*) as c FROM wiki_pages WHERE wiki_id = ?', args: [wikiId] });
  const sourceResult = await db.execute({ sql: 'SELECT COUNT(*) as c FROM wiki_sources WHERE wiki_id = ?', args: [wikiId] });
  const logResult = await db.execute({
    sql: 'SELECT COUNT(*) as c, MAX(created_at) as latest FROM wiki_log WHERE wiki_id = ?',
    args: [wikiId],
  });

  return {
    page_count: Number(pageResult.rows[0].c),
    source_count: Number(sourceResult.rows[0].c),
    log_count: Number(logResult.rows[0].c),
    last_activity: logResult.rows[0].latest ? ts(Number(logResult.rows[0].latest)) : null,
  };
}
