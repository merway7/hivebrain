import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { join } = require('path');

const db = new Database(join(process.cwd(), 'db', 'hivebrain.db'));
db.pragma('journal_mode = WAL');

console.log('Rebuilding FTS to include tags, language, framework...');

db.exec('DROP TRIGGER IF EXISTS entries_ai');
db.exec('DROP TRIGGER IF EXISTS entries_au');
db.exec('DROP TRIGGER IF EXISTS entries_ad');
db.exec('DROP TABLE IF EXISTS entries_fts');

db.exec(`
  CREATE VIRTUAL TABLE entries_fts USING fts5(
    title, problem, solution, why,
    error_messages, keywords, context,
    tags, language, framework,
    content='entries', content_rowid='id'
  )
`);

db.exec(`
  CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, title, problem, solution, why, error_messages, keywords, context, tags, language, framework)
    VALUES (new.id, new.title, new.problem, new.solution, new.why, new.error_messages, new.keywords, new.context, new.tags, new.language, new.framework);
  END
`);

db.exec(`
  CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, title, problem, solution, why, error_messages, keywords, context, tags, language, framework)
    VALUES ('delete', old.id, old.title, old.problem, old.solution, old.why, old.error_messages, old.keywords, old.context, old.tags, old.language, old.framework);
    INSERT INTO entries_fts(rowid, title, problem, solution, why, error_messages, keywords, context, tags, language, framework)
    VALUES (new.id, new.title, new.problem, new.solution, new.why, new.error_messages, new.keywords, new.context, new.tags, new.language, new.framework);
  END
`);

db.exec(`
  CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, title, problem, solution, why, error_messages, keywords, context, tags, language, framework)
    VALUES ('delete', old.id, old.title, old.problem, old.solution, old.why, old.error_messages, old.keywords, old.context, old.tags, old.language, old.framework);
  END
`);

db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')");

console.log('FTS rebuilt with 10 indexed fields.');

const tests = [
  ['nextjs', 'tag search'],
  ['python', 'language field'],
  ['playwright', 'framework field'],
  ['react', 'framework + tags'],
  ['docker', 'environment in keywords'],
];

for (const [q, desc] of tests) {
  const results = db.prepare(
    'SELECT entries.title FROM entries_fts JOIN entries ON entries.id = entries_fts.rowid WHERE entries_fts MATCH ? ORDER BY rank LIMIT 5'
  ).all('"' + q + '"');
  console.log('  "' + q + '": ' + results.length + ' results ' + (results.length > 0 ? 'OK' : 'FAIL') + ' (' + desc + ')');
  results.forEach(r => console.log('    -> ' + r.title));
}

db.close();
console.log('Done.');
