import { getDb, getWriteDb } from './db';

export interface JournalEntry {
  id: number;
  author: string;
  title: string;
  mood: string;
  tags: string[];
  content: string;
  is_public: boolean;
  created_at: string;
  replies: JournalReply[];
}

export interface JournalReply {
  id: number;
  author: string;
  date: string;
  mood?: string;
  content: string;
}

function rowToEntry(row: any, replies: JournalReply[] = []): JournalEntry {
  return {
    id: Number(row.id),
    author: String(row.author || 'anonymous'),
    title: String(row.title),
    mood: String(row.mood || 'reflective'),
    tags: JSON.parse(String(row.tags || '[]')),
    content: String(row.content || ''),
    is_public: Number(row.is_public) === 1,
    created_at: new Date(Number(row.created_at) * 1000).toISOString(),
    replies,
  };
}

async function getRepliesForEntry(entryId: number): Promise<JournalReply[]> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM journal_replies WHERE entry_id = ? ORDER BY created_at ASC',
    args: [entryId],
  });
  return result.rows.map(r => ({
    id: Number(r.id),
    author: String(r.author || 'anonymous'),
    date: new Date(Number(r.created_at) * 1000).toISOString(),
    mood: r.mood ? String(r.mood) : undefined,
    content: String(r.content),
  }));
}

export async function getJournalEntries(opts?: {
  limit?: number;
  offset?: number;
  tag?: string;
  mood?: string;
  author?: string;
  publicOnly?: boolean;
}): Promise<{ entries: JournalEntry[]; total: number }> {
  const db = getDb();
  const conditions: string[] = [];
  const args: any[] = [];

  if (opts?.publicOnly) {
    conditions.push('is_public = 1');
  }
  if (opts?.author) {
    conditions.push('author = ?');
    args.push(opts.author);
  }
  if (opts?.mood) {
    conditions.push('mood = ?');
    args.push(opts.mood);
  }
  if (opts?.tag) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE LOWER(value) = ?)");
    args.push(opts.tag.toLowerCase());
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as c FROM journal_entries ${where}`,
    args,
  });
  const total = Number(countResult.rows[0].c);

  const limit = opts?.limit || 20;
  const offset = opts?.offset || 0;

  const result = await db.execute({
    sql: `SELECT * FROM journal_entries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });

  const entries: JournalEntry[] = [];
  for (const row of result.rows) {
    const replies = await getRepliesForEntry(Number(row.id));
    entries.push(rowToEntry(row, replies));
  }

  return { entries, total };
}

export async function getJournalEntry(id: number): Promise<JournalEntry | null> {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM journal_entries WHERE id = ?',
    args: [id],
  });
  if (result.rows.length === 0) return null;
  const replies = await getRepliesForEntry(id);
  return rowToEntry(result.rows[0], replies);
}

export async function addJournalEntry(entry: {
  author: string;
  title: string;
  mood: string;
  tags: string[];
  content: string;
  is_public?: boolean;
}): Promise<JournalEntry> {
  const db = getWriteDb();
  const result = await db.execute({
    sql: `INSERT INTO journal_entries (author, title, mood, tags, content, is_public)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      entry.author || 'anonymous',
      entry.title,
      entry.mood,
      JSON.stringify(entry.tags),
      entry.content,
      entry.is_public ? 1 : 0,
    ],
  });
  const id = Number(result.lastInsertRowid);
  return (await getJournalEntry(id))!;
}

export async function addJournalReply(entryId: number, reply: {
  author: string;
  mood?: string;
  content: string;
}): Promise<JournalReply | null> {
  const db = getWriteDb();
  // Verify entry exists
  const entry = await getJournalEntry(entryId);
  if (!entry) return null;

  const result = await db.execute({
    sql: 'INSERT INTO journal_replies (entry_id, author, mood, content) VALUES (?, ?, ?, ?)',
    args: [entryId, reply.author || 'anonymous', reply.mood || null, reply.content],
  });
  return {
    id: Number(result.lastInsertRowid),
    author: reply.author || 'anonymous',
    date: new Date().toISOString(),
    mood: reply.mood,
    content: reply.content,
  };
}

export async function togglePublic(entryId: number, author: string): Promise<boolean> {
  const db = getWriteDb();
  // Only the author can toggle
  const entry = await getJournalEntry(entryId);
  if (!entry || entry.author !== author) return false;

  const newValue = entry.is_public ? 0 : 1;
  await db.execute({
    sql: 'UPDATE journal_entries SET is_public = ? WHERE id = ?',
    args: [newValue, entryId],
  });
  return true;
}

export async function getJournalStats(author?: string): Promise<{
  total: number;
  public_count: number;
  moods: Record<string, number>;
  tags: Record<string, number>;
  authors: { author: string; count: number }[];
  firstEntry: string | null;
  latestEntry: string | null;
}> {
  const db = getDb();
  const authorWhere = author ? 'WHERE author = ?' : '';
  const authorArgs = author ? [author] : [];

  const totalResult = await db.execute({
    sql: `SELECT COUNT(*) as c FROM journal_entries ${authorWhere}`,
    args: authorArgs,
  });
  const total = Number(totalResult.rows[0].c);

  const publicResult = await db.execute({
    sql: `SELECT COUNT(*) as c FROM journal_entries WHERE is_public = 1 ${author ? 'AND author = ?' : ''}`,
    args: authorArgs,
  });
  const public_count = Number(publicResult.rows[0].c);

  const moodResult = await db.execute({
    sql: `SELECT mood, COUNT(*) as c FROM journal_entries ${authorWhere} GROUP BY mood ORDER BY c DESC`,
    args: authorArgs,
  });
  const moods: Record<string, number> = {};
  for (const r of moodResult.rows) moods[String(r.mood)] = Number(r.c);

  const tagResult = await db.execute({
    sql: `SELECT value as tag, COUNT(*) as c FROM journal_entries, json_each(tags) ${authorWhere} GROUP BY value ORDER BY c DESC LIMIT 30`,
    args: authorArgs,
  });
  const tags: Record<string, number> = {};
  for (const r of tagResult.rows) tags[String(r.tag)] = Number(r.c);

  const authorsResult = await db.execute(
    'SELECT author, COUNT(*) as c FROM journal_entries GROUP BY author ORDER BY c DESC LIMIT 20'
  );
  const authors = authorsResult.rows.map(r => ({
    author: String(r.author),
    count: Number(r.c),
  }));

  const firstResult = await db.execute({
    sql: `SELECT created_at FROM journal_entries ${authorWhere} ORDER BY created_at ASC LIMIT 1`,
    args: authorArgs,
  });
  const lastResult = await db.execute({
    sql: `SELECT created_at FROM journal_entries ${authorWhere} ORDER BY created_at DESC LIMIT 1`,
    args: authorArgs,
  });

  return {
    total,
    public_count,
    moods,
    tags,
    authors,
    firstEntry: firstResult.rows.length > 0 ? new Date(Number(firstResult.rows[0].created_at) * 1000).toISOString() : null,
    latestEntry: lastResult.rows.length > 0 ? new Date(Number(lastResult.rows[0].created_at) * 1000).toISOString() : null,
  };
}

export async function getJournalAuthors(): Promise<{ author: string; count: number; latest: string }[]> {
  const db = getDb();
  const result = await db.execute(`
    SELECT author, COUNT(*) as c, MAX(created_at) as latest
    FROM journal_entries
    GROUP BY author
    ORDER BY latest DESC
  `);
  return result.rows.map(r => ({
    author: String(r.author),
    count: Number(r.c),
    latest: new Date(Number(r.latest) * 1000).toISOString(),
  }));
}
