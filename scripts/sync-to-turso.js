#!/usr/bin/env node
// Sanitized one-way sync from local SQLite -> Turso (production).
//
// Pushes ONLY public-safe data:
//   - entries (all)
//   - journal_entries WHERE is_public = 1
//
// Skips entirely (stay local):
//   - wikis, wiki_pages, wiki_sources, wiki_log, wiki_page_revisions
//   - combs, comb_files, comb_file_revisions
//   - accounts, notifications, notification_preferences
//   - analytics_views, analytics_searches, search_sessions
//   - entry_votes, entry_revisions, entry_embeddings
//   - reputation_*, reasoning_traces, retrieval_traces, section_attributions
//   - solution_verifications, tag_cooccurrence, topic_search_trends
//   - usage_contexts, user_badges, settings, journal_replies
//
// Usage:
//   TURSO_URL=... TURSO_AUTH_TOKEN=... node scripts/sync-to-turso.js [--dry-run]

import { createClient } from '@libsql/client';
import { createClient as createHttpClient } from '@libsql/client/http';
import { join } from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const LOCAL_DB = process.env.LOCAL_DB_PATH || join(process.cwd(), 'db', 'hivebrain.db');

if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('ERROR: TURSO_URL and TURSO_AUTH_TOKEN must be set in env.');
  process.exit(1);
}

const local = createClient({ url: `file:${LOCAL_DB}` });
const remote = createHttpClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const ENTRY_COLS = [
  'id', 'title', 'category', 'tags', 'problem', 'solution', 'why', 'gotchas',
  'learned_from', 'submitted_by', 'created_at', 'upvotes',
  'language', 'framework', 'environment', 'error_messages', 'keywords',
  'severity', 'context', 'code_snippets', 'related_entries', 'version_info',
  'view_count', 'downvotes', 'usage_count', 'quality_status', 'is_canonical',
  'freshness_status', 'surprise_score', 'success_rate', 'retrieval_count',
  'confidence_score',
];

const JOURNAL_COLS = ['id', 'author', 'title', 'mood', 'tags', 'content', 'is_public', 'created_at'];

function placeholders(n) { return Array(n).fill('?').join(','); }

async function pushEntries() {
  const total = Number((await local.execute('SELECT COUNT(*) as c FROM entries')).rows[0].c);
  console.log(`[entries] local=${total}`);

  if (DRY_RUN) { console.log('[entries] dry-run, skipping push'); return; }

  await remote.execute('DELETE FROM entries');
  console.log('[entries] cleared remote');

  const BATCH = 200;
  let done = 0;
  for (let off = 0; off < total; off += BATCH) {
    const rows = (await local.execute({
      sql: `SELECT ${ENTRY_COLS.join(',')} FROM entries ORDER BY id LIMIT ? OFFSET ?`,
      args: [BATCH, off],
    })).rows;

    const stmts = rows.map(r => ({
      sql: `INSERT INTO entries (${ENTRY_COLS.join(',')}) VALUES (${placeholders(ENTRY_COLS.length)})`,
      args: ENTRY_COLS.map(c => r[c]),
    }));

    await remote.batch(stmts, 'write');
    done += rows.length;
    if (done % 2000 === 0 || done === total) {
      process.stdout.write(`\r[entries] ${done}/${total} (${Math.round(done/total*100)}%)`);
    }
  }
  console.log('\n[entries] done');
}

async function pushJournal() {
  const rows = (await local.execute(
    `SELECT ${JOURNAL_COLS.join(',')} FROM journal_entries WHERE is_public = 1 ORDER BY id`
  )).rows;
  console.log(`[journal_entries public] local=${rows.length}`);

  if (DRY_RUN) return;

  await remote.execute('DELETE FROM journal_entries');
  if (rows.length === 0) { console.log('[journal_entries] no public rows; skipped'); return; }

  const stmts = rows.map(r => ({
    sql: `INSERT INTO journal_entries (${JOURNAL_COLS.join(',')}) VALUES (${placeholders(JOURNAL_COLS.length)})`,
    args: JOURNAL_COLS.map(c => r[c]),
  }));
  await remote.batch(stmts, 'write');
  console.log('[journal_entries] done');
}

async function verify() {
  const e = Number((await remote.execute('SELECT COUNT(*) as c FROM entries')).rows[0].c);
  const j = Number((await remote.execute('SELECT COUNT(*) as c FROM journal_entries')).rows[0].c);
  const w = Number((await remote.execute('SELECT COUNT(*) as c FROM wikis')).rows[0].c);
  const a = Number((await remote.execute('SELECT COUNT(*) as c FROM accounts')).rows[0].c);
  console.log(`\n[verify remote] entries=${e} journal=${j} wikis=${w} accounts=${a}`);
}

(async () => {
  console.log(`Source : ${LOCAL_DB}`);
  console.log(`Target : ${process.env.TURSO_URL}`);
  console.log(`Mode   : ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  await pushEntries();
  await pushJournal();
  await verify();
  console.log('\nDone.');
})().catch(e => { console.error(e); process.exit(1); });
