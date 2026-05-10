#!/usr/bin/env node
// Resume sync: pushes only entries with id > current max id on remote.
// Use after a sync-to-turso.js run was interrupted.

import { createClient } from '@libsql/client';
import { createClient as createHttpClient } from '@libsql/client/http';
import { join } from 'path';

const LOCAL_DB = process.env.LOCAL_DB_PATH || join(process.cwd(), 'db', 'hivebrain.db');
if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('missing TURSO_URL/TURSO_AUTH_TOKEN'); process.exit(1);
}

const local = createClient({ url: `file:${LOCAL_DB}` });
const remote = createHttpClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const COLS = [
  'id', 'title', 'category', 'tags', 'problem', 'solution', 'why', 'gotchas',
  'learned_from', 'submitted_by', 'created_at', 'upvotes',
  'language', 'framework', 'environment', 'error_messages', 'keywords',
  'severity', 'context', 'code_snippets', 'related_entries', 'version_info',
  'view_count', 'downvotes', 'usage_count', 'quality_status', 'is_canonical',
  'freshness_status', 'surprise_score', 'success_rate', 'retrieval_count',
  'confidence_score',
];

const ph = (n) => Array(n).fill('?').join(',');

const maxR = (await remote.execute('SELECT COALESCE(MAX(id), 0) m FROM entries')).rows[0].m;
const startAfter = Number(maxR);
console.log(`remote max id: ${startAfter}`);

const remaining = Number((await local.execute({
  sql: 'SELECT COUNT(*) c FROM entries WHERE id > ?', args: [startAfter],
})).rows[0].c);
console.log(`local remaining: ${remaining}`);

if (remaining === 0) {
  const totalR = Number((await remote.execute('SELECT COUNT(*) c FROM entries')).rows[0].c);
  console.log(`done. remote total: ${totalR}`);
  process.exit(0);
}

const BATCH = 100;
let last = startAfter;
let done = 0;

while (done < remaining) {
  const rows = (await local.execute({
    sql: `SELECT ${COLS.join(',')} FROM entries WHERE id > ? ORDER BY id LIMIT ?`,
    args: [last, BATCH],
  })).rows;
  if (rows.length === 0) break;

  const stmts = rows.map(r => ({
    sql: `INSERT INTO entries (${COLS.join(',')}) VALUES (${ph(COLS.length)})`,
    args: COLS.map(c => r[c]),
  }));

  try {
    await remote.batch(stmts, 'write');
  } catch (e) {
    console.error(`batch failed at last=${last}: ${e.message}`);
    process.exit(1);
  }

  last = Number(rows[rows.length - 1].id);
  done += rows.length;
  process.stdout.write(`\r[entries] ${done}/${remaining} (last id=${last})  `);
}

console.log();
const totalR = Number((await remote.execute('SELECT COUNT(*) c FROM entries')).rows[0].c);
console.log(`done. remote total: ${totalR}`);
