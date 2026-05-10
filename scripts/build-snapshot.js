#!/usr/bin/env node
// Build-time snapshot: reads the LOCAL SQLite DB and bakes a JSON file with
// the data the homepage and key listing pages need. At runtime, if Turso
// throws (e.g. quota exhausted), pages serve this snapshot instead of 500.
//
// Run automatically by `astro build` via the `prebuild` npm script.

import { createClient } from '@libsql/client';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = process.env.SNAPSHOT_DB_PATH || join(ROOT, 'db', 'hivebrain.db');
const OUT_PATH = join(ROOT, 'src', 'data', 'build-snapshot.json');

async function main() {
  let snapshot = {
    generatedAt: new Date().toISOString(),
    stats: { total: 0, byCategory: [], tagCounts: {}, languageCounts: {}, frameworkCounts: {}, severityCounts: {}, environmentCounts: {} },
    recentEntries: [],
    entryActivity: { weeklyCount: 0, monthlyCount: 0, weeklyDelta: 0 },
    totalUsage: 0,
    note: 'placeholder snapshot — local DB was not available at build time',
  };

  try {
    const db = createClient({ url: `file:${DB_PATH}` });

    const total = Number((await db.execute('SELECT COUNT(*) c FROM entries')).rows[0].c);

    const byCategory = (await db.execute(
      'SELECT category, COUNT(*) c FROM entries GROUP BY category'
    )).rows.map(r => ({ category: String(r.category), count: Number(r.c) }));

    const tagCounts = {};
    for (const r of (await db.execute(
      `SELECT t.value tag, COUNT(*) c FROM entries, json_each(entries.tags) t
       GROUP BY t.value ORDER BY c DESC LIMIT 100`
    )).rows) tagCounts[String(r.tag)] = Number(r.c);

    const languageCounts = {};
    for (const r of (await db.execute(
      "SELECT language, COUNT(*) c FROM entries WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY c DESC"
    )).rows) languageCounts[String(r.language)] = Number(r.c);

    const frameworkCounts = {};
    for (const r of (await db.execute(
      "SELECT framework, COUNT(*) c FROM entries WHERE framework IS NOT NULL AND framework != '' GROUP BY framework ORDER BY c DESC"
    )).rows) frameworkCounts[String(r.framework)] = Number(r.c);

    const severityCounts = {};
    for (const r of (await db.execute(
      "SELECT severity, COUNT(*) c FROM entries WHERE severity IS NOT NULL AND severity != '' GROUP BY severity ORDER BY c DESC"
    )).rows) severityCounts[String(r.severity)] = Number(r.c);

    const environmentCounts = {};
    for (const r of (await db.execute(
      `SELECT e.value env, COUNT(*) c FROM entries, json_each(entries.environment) e
       GROUP BY e.value ORDER BY c DESC LIMIT 50`
    )).rows) environmentCounts[String(r.env)] = Number(r.c);

    const recentEntries = (await db.execute(
      `SELECT id, title, category, tags, problem, solution, why, language, framework,
              severity, created_at, upvotes, downvotes
       FROM entries ORDER BY created_at DESC LIMIT 10`
    )).rows.map(r => ({
      id: Number(r.id),
      title: String(r.title || ''),
      category: String(r.category || ''),
      tags: safeParseArray(r.tags),
      problem: String(r.problem || ''),
      solution: String(r.solution || ''),
      why: r.why ? String(r.why) : null,
      language: r.language ? String(r.language) : null,
      framework: r.framework ? String(r.framework) : null,
      severity: r.severity ? String(r.severity) : null,
      created_at: Number(r.created_at || 0),
      upvotes: Number(r.upvotes || 0),
      downvotes: Number(r.downvotes || 0),
    }));

    const totalUsage = Number((await db.execute(
      'SELECT COALESCE(SUM(usage_count),0) c FROM entries'
    )).rows[0].c);

    const now = Math.floor(Date.now() / 1000);
    const oneWeekAgo = now - 7 * 86400;
    const twoWeeksAgo = now - 14 * 86400;
    const thirtyDaysAgo = now - 30 * 86400;
    const actRow = (await db.execute({
      sql: `SELECT
              SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) weekly,
              SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) monthly,
              SUM(CASE WHEN created_at > ? AND created_at <= ? THEN 1 ELSE 0 END) prior_week
            FROM entries`,
      args: [oneWeekAgo, thirtyDaysAgo, twoWeeksAgo, oneWeekAgo],
    })).rows[0];
    const weeklyCount = Number(actRow.weekly || 0);
    const monthlyCount = Number(actRow.monthly || 0);
    const priorWeek = Number(actRow.prior_week || 0);

    snapshot = {
      generatedAt: snapshot.generatedAt,
      stats: { total, byCategory, tagCounts, languageCounts, frameworkCounts, severityCounts, environmentCounts },
      recentEntries,
      entryActivity: { weeklyCount, monthlyCount, weeklyDelta: weeklyCount - priorWeek },
      totalUsage,
    };
    console.log(`[snapshot] wrote ${total} entries summary`);
  } catch (e) {
    console.warn(`[snapshot] local DB unavailable (${e.message}); writing placeholder`);
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`[snapshot] -> ${OUT_PATH}`);
}

function safeParseArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

main().catch(e => { console.error(e); process.exit(1); });
