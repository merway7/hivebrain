import { createHash } from 'node:crypto';
import { getDb, getWriteDb } from './db';

// ── Types ──

export interface Comb {
  id: number;
  owner: string;
  slug: string;
  full_slug: string;
  description: string | null;
  is_public: boolean;
  tags: string[];
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface CombFile {
  id: number;
  comb_id: number;
  path: string;
  content: string;
  content_hash: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface CombFileRevision {
  id: number;
  file_id: number;
  path: string;
  content: string;
  content_hash: string;
  revision: number;
  message: string | null;
  pushed_by: string;
  created_at: string;
}

export interface CombFileListing {
  id: number;
  path: string;
  revision: number;
  content_hash: string;
  updated_at: string;
}

export interface PushResult {
  file_id: number;
  path: string;
  changed: boolean;
  revision: number;
}

export interface CombSearchResult {
  comb_id: number;
  comb_full_slug: string;
  comb_description: string | null;
  file_id: number;
  file_path: string;
  snippet: string;
}

// ── Helpers ──

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function ts(unixSeconds: number | bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

function rowToComb(row: any, fileCount = 0): Comb {
  return {
    id: Number(row.id),
    owner: String(row.owner),
    slug: String(row.slug),
    full_slug: String(row.full_slug),
    description: row.description ? String(row.description) : null,
    is_public: Number(row.is_public) === 1,
    tags: JSON.parse(String(row.tags || '[]')),
    file_count: Number(row.file_count ?? fileCount),
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

function rowToFile(row: any): CombFile {
  return {
    id: Number(row.id),
    comb_id: Number(row.comb_id),
    path: String(row.path),
    content: String(row.content),
    content_hash: String(row.content_hash),
    revision: Number(row.revision),
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

function rowToRevision(row: any): CombFileRevision {
  return {
    id: Number(row.id),
    file_id: Number(row.file_id),
    path: String(row.path),
    content: String(row.content),
    content_hash: String(row.content_hash),
    revision: Number(row.revision),
    message: row.message ? String(row.message) : null,
    pushed_by: String(row.pushed_by || 'anonymous'),
    created_at: ts(row.created_at),
  };
}

// ── Comb CRUD ──

export async function createComb(opts: {
  owner: string;
  slug: string;
  description?: string;
  is_public?: boolean;
  tags?: string[];
}): Promise<Comb> {
  const db = getWriteDb();
  const slug = opts.slug.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const full_slug = `${opts.owner}/${slug}`;

  const result = await db.execute({
    sql: `INSERT INTO combs (owner, slug, full_slug, description, is_public, tags)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      opts.owner,
      slug,
      full_slug,
      opts.description || null,
      opts.is_public !== false ? 1 : 0,
      JSON.stringify(opts.tags || []),
    ],
  });

  return (await getCombById(Number(result.lastInsertRowid)))!;
}

export async function getComb(fullSlug: string): Promise<Comb | null> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT c.*, COUNT(cf.id) as file_count
          FROM combs c LEFT JOIN comb_files cf ON cf.comb_id = c.id
          WHERE c.full_slug = ? GROUP BY c.id`,
    args: [fullSlug],
  });
  if (result.rows.length === 0) return null;
  return rowToComb(result.rows[0]);
}

export async function getCombById(id: number): Promise<Comb | null> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT c.*, COUNT(cf.id) as file_count
          FROM combs c LEFT JOIN comb_files cf ON cf.comb_id = c.id
          WHERE c.id = ? GROUP BY c.id`,
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return rowToComb(result.rows[0]);
}

export async function listCombs(opts?: {
  owner?: string;
  is_public?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ combs: Comb[]; total: number }> {
  const db = getDb();
  const conditions: string[] = [];
  const args: any[] = [];

  if (opts?.owner) {
    conditions.push('c.owner = ?');
    args.push(opts.owner);
  }
  if (opts?.is_public !== undefined) {
    conditions.push('c.is_public = ?');
    args.push(opts.is_public ? 1 : 0);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as c FROM combs c ${where}`,
    args,
  });
  const total = Number(countResult.rows[0].c);

  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;

  const result = await db.execute({
    sql: `SELECT c.*, COUNT(cf.id) as file_count
          FROM combs c LEFT JOIN comb_files cf ON cf.comb_id = c.id
          ${where} GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  return { combs: result.rows.map(r => rowToComb(r)), total };
}

export async function updateComb(id: number, updates: {
  description?: string;
  is_public?: boolean;
  tags?: string[];
}): Promise<Comb | null> {
  const db = getWriteDb();
  const sets: string[] = ['updated_at = unixepoch()'];
  const args: any[] = [];

  if (updates.description !== undefined) {
    sets.push('description = ?');
    args.push(updates.description);
  }
  if (updates.is_public !== undefined) {
    sets.push('is_public = ?');
    args.push(updates.is_public ? 1 : 0);
  }
  if (updates.tags !== undefined) {
    sets.push('tags = ?');
    args.push(JSON.stringify(updates.tags));
  }

  args.push(id);
  await db.execute({
    sql: `UPDATE combs SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });

  return getCombById(id);
}

export async function deleteComb(id: number): Promise<boolean> {
  const db = getWriteDb();
  // Delete in order: revisions → files (triggers clean FTS) → comb
  await db.execute({ sql: 'DELETE FROM comb_file_revisions WHERE comb_id = ?', args: [id] });
  // Clean FTS manually before deleting files (triggers may not fire on all drivers)
  const files = await db.execute({ sql: 'SELECT id, path, content FROM comb_files WHERE comb_id = ?', args: [id] });
  for (const f of files.rows) {
    try {
      await db.execute({
        sql: `INSERT INTO combs_fts(combs_fts, rowid, path, content) VALUES ('delete', ?, ?, ?)`,
        args: [Number(f.id), String(f.path), String(f.content)],
      });
    } catch {}
  }
  await db.execute({ sql: 'DELETE FROM comb_files WHERE comb_id = ?', args: [id] });
  const result = await db.execute({ sql: 'DELETE FROM combs WHERE id = ?', args: [id] });
  return Number(result.rowsAffected) > 0;
}

// ── File Operations ──

export async function pushFile(opts: {
  comb_id: number;
  path: string;
  content: string;
  message?: string;
  pushed_by?: string;
}): Promise<PushResult> {
  const db = getWriteDb();
  const hash = hashContent(opts.content);
  const pushedBy = opts.pushed_by || 'anonymous';

  // Check if file already exists
  const existing = await db.execute({
    sql: 'SELECT id, content_hash, revision FROM comb_files WHERE comb_id = ? AND path = ?',
    args: [opts.comb_id, opts.path],
  });

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const existingHash = String(row.content_hash);
    const fileId = Number(row.id);
    const currentRev = Number(row.revision);

    // Content unchanged — no-op
    if (existingHash === hash) {
      return { file_id: fileId, path: opts.path, changed: false, revision: currentRev };
    }

    // Update existing file
    const newRev = currentRev + 1;
    await db.execute({
      sql: `UPDATE comb_files SET content = ?, content_hash = ?, revision = ?, updated_at = unixepoch() WHERE id = ?`,
      args: [opts.content, hash, newRev, fileId],
    });

    // Record revision
    await db.execute({
      sql: `INSERT INTO comb_file_revisions (file_id, comb_id, path, content, content_hash, revision, message, pushed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [fileId, opts.comb_id, opts.path, opts.content, hash, newRev, opts.message || null, pushedBy],
    });

    // Touch comb updated_at
    await db.execute({ sql: 'UPDATE combs SET updated_at = unixepoch() WHERE id = ?', args: [opts.comb_id] });

    return { file_id: fileId, path: opts.path, changed: true, revision: newRev };
  }

  // New file — insert
  const result = await db.execute({
    sql: `INSERT INTO comb_files (comb_id, path, content, content_hash) VALUES (?, ?, ?, ?)`,
    args: [opts.comb_id, opts.path, opts.content, hash],
  });

  const fileId = Number(result.lastInsertRowid);

  // Record initial revision
  await db.execute({
    sql: `INSERT INTO comb_file_revisions (file_id, comb_id, path, content, content_hash, revision, message, pushed_by)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    args: [fileId, opts.comb_id, opts.path, opts.content, hash, opts.message || null, pushedBy],
  });

  // Touch comb updated_at
  await db.execute({ sql: 'UPDATE combs SET updated_at = unixepoch() WHERE id = ?', args: [opts.comb_id] });

  return { file_id: fileId, path: opts.path, changed: true, revision: 1 };
}

export async function pushFiles(opts: {
  comb_id: number;
  files: { path: string; content: string }[];
  message?: string;
  pushed_by?: string;
}): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (const file of opts.files) {
    const r = await pushFile({
      comb_id: opts.comb_id,
      path: file.path,
      content: file.content,
      message: opts.message,
      pushed_by: opts.pushed_by,
    });
    results.push(r);
  }
  return results;
}

export async function getFile(combId: number, path: string): Promise<CombFile | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM comb_files WHERE comb_id = ? AND path = ?',
    args: [combId, path],
  });
  if (result.rows.length === 0) return null;
  return rowToFile(result.rows[0]);
}

export async function listFiles(combId: number): Promise<CombFileListing[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, path, revision, content_hash, updated_at FROM comb_files WHERE comb_id = ? ORDER BY path ASC',
    args: [combId],
  });
  return result.rows.map(r => ({
    id: Number(r.id),
    path: String(r.path),
    revision: Number(r.revision),
    content_hash: String(r.content_hash),
    updated_at: ts(Number(r.updated_at)),
  }));
}

export async function deleteFile(combId: number, path: string): Promise<boolean> {
  const db = getWriteDb();
  const result = await db.execute({
    sql: 'DELETE FROM comb_files WHERE comb_id = ? AND path = ?',
    args: [combId, path],
  });
  if (Number(result.rowsAffected) > 0) {
    await db.execute({ sql: 'UPDATE combs SET updated_at = unixepoch() WHERE id = ?', args: [combId] });
    return true;
  }
  return false;
}

// ── Revisions ──

export async function getFileRevisions(fileId: number, limit = 20, offset = 0): Promise<CombFileRevision[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM comb_file_revisions WHERE file_id = ? ORDER BY revision DESC LIMIT ? OFFSET ?',
    args: [fileId, limit, offset],
  });
  return result.rows.map(rowToRevision);
}

export async function getFileAtRevision(fileId: number, revision: number): Promise<CombFileRevision | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM comb_file_revisions WHERE file_id = ? AND revision = ?',
    args: [fileId, revision],
  });
  if (result.rows.length === 0) return null;
  return rowToRevision(result.rows[0]);
}

export async function getCombRevisions(combId: number, limit = 50, offset = 0): Promise<CombFileRevision[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM comb_file_revisions WHERE comb_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    args: [combId, limit, offset],
  });
  return result.rows.map(rowToRevision);
}

// ── Search ──

export async function searchCombs(query: string, opts?: {
  comb?: string;  // full_slug to scope search
  limit?: number;
}): Promise<CombSearchResult[]> {
  const db = getDb();
  const limit = opts?.limit || 10;

  // Build FTS query — quote terms for safety
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const ftsQuery = terms.map(t => `"${t.replace(/"/g, '')}"`).join(' ');

  let sql: string;
  let args: any[];

  if (opts?.comb) {
    // Scoped to a specific comb
    sql = `SELECT cf.id as file_id, cf.comb_id, cf.path as file_path,
             snippet(combs_fts, 1, '**', '**', '...', 40) as snippet,
             c.full_slug as comb_full_slug, c.description as comb_description
           FROM combs_fts
           JOIN comb_files cf ON cf.id = combs_fts.rowid
           JOIN combs c ON c.id = cf.comb_id
           WHERE combs_fts MATCH ? AND c.full_slug = ?
           ORDER BY rank LIMIT ?`;
    args = [ftsQuery, opts.comb, limit];
  } else {
    // Search all public combs
    sql = `SELECT cf.id as file_id, cf.comb_id, cf.path as file_path,
             snippet(combs_fts, 1, '**', '**', '...', 40) as snippet,
             c.full_slug as comb_full_slug, c.description as comb_description
           FROM combs_fts
           JOIN comb_files cf ON cf.id = combs_fts.rowid
           JOIN combs c ON c.id = cf.comb_id
           WHERE combs_fts MATCH ? AND c.is_public = 1
           ORDER BY rank LIMIT ?`;
    args = [ftsQuery, limit];
  }

  try {
    const result = await db.execute({ sql, args });
    return result.rows.map(r => ({
      comb_id: Number(r.comb_id),
      comb_full_slug: String(r.comb_full_slug),
      comb_description: r.comb_description ? String(r.comb_description) : null,
      file_id: Number(r.file_id),
      file_path: String(r.file_path),
      snippet: String(r.snippet || ''),
    }));
  } catch {
    // FTS match failed (e.g. empty query) — return empty
    return [];
  }
}

// ── Stats ──

export async function getCombStats(combId: number): Promise<{
  file_count: number;
  total_revisions: number;
  last_push: string | null;
}> {
  const db = getDb();

  const fileResult = await db.execute({
    sql: 'SELECT COUNT(*) as c FROM comb_files WHERE comb_id = ?',
    args: [combId],
  });
  const revResult = await db.execute({
    sql: 'SELECT COUNT(*) as c, MAX(created_at) as latest FROM comb_file_revisions WHERE comb_id = ?',
    args: [combId],
  });

  return {
    file_count: Number(fileResult.rows[0].c),
    total_revisions: Number(revResult.rows[0].c),
    last_push: revResult.rows[0].latest ? ts(Number(revResult.rows[0].latest)) : null,
  };
}
