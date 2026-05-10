import { createClient } from '@libsql/client/http';
import { readFileSync } from 'fs';

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) { console.error('missing TURSO_URL/TURSO_AUTH_TOKEN'); process.exit(1); }

const db = createClient({ url, authToken });
const schema = readFileSync('/Users/merwanito/local_AI/hivebrain/db/schema.sql', 'utf-8');

// Split on top-level statements, respecting BEGIN..END trigger blocks (same logic as initDb).
const stmts = [];
let cur = '';
let inBlock = false;
for (const line of schema.split('\n')) {
  const t = line.trim();
  if (t.startsWith('--') || t === '') continue;
  cur += line + '\n';
  if (/\bBEGIN\b/i.test(t)) inBlock = true;
  if (inBlock && /\bEND\b/i.test(t) && t.endsWith(';')) { stmts.push(cur.trim()); cur = ''; inBlock = false; }
  else if (!inBlock && t.endsWith(';')) { stmts.push(cur.trim()); cur = ''; }
}
if (cur.trim()) stmts.push(cur.trim());

console.log(`applying ${stmts.length} statements…`);
let ok = 0, fail = 0;
for (const sql of stmts) {
  try { await db.execute(sql); ok++; }
  catch (e) {
    fail++;
    if (!/already exists/i.test(e.message)) {
      console.error(`FAIL: ${sql.slice(0, 80)}…\n  ${e.message}`);
    }
  }
}
console.log(`ok=${ok} fail=${fail}`);
const tables = await db.execute("SELECT count(*) c FROM sqlite_master WHERE type='table'");
console.log(`tables now: ${tables.rows[0].c}`);
