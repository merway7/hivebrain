// Bulk insert entries from JSON files into HiveBrain DB
// Usage: node bulk-insert.js batch-*.json
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'hivebrain.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const countBefore = db.prepare('SELECT COUNT(*) as c FROM entries').get().c;
console.log(`Entries before: ${countBefore}`);

const insert = db.prepare(`
  INSERT INTO entries (title, category, tags, problem, solution, why, gotchas,
    language, framework, environment, error_messages, keywords, severity,
    context, code_snippets, version_info, submitted_by)
  VALUES (@title, @category, @tags, @problem, @solution, @why, @gotchas,
    @language, @framework, @environment, @error_messages, @keywords, @severity,
    @context, @code_snippets, @version_info, 'seed')
`);

const insertMany = db.transaction((entries) => {
  for (const e of entries) {
    insert.run({
      title: e.title,
      category: e.category,
      tags: JSON.stringify(e.tags || []),
      problem: e.problem,
      solution: e.solution,
      why: e.why || null,
      gotchas: JSON.stringify(e.gotchas || []),
      language: e.language || null,
      framework: e.framework || null,
      environment: JSON.stringify(e.environment || []),
      error_messages: JSON.stringify(e.error_messages || []),
      keywords: JSON.stringify(e.keywords || []),
      severity: e.severity || 'moderate',
      context: e.context || null,
      code_snippets: JSON.stringify(e.code_snippets || []),
      version_info: e.version_info || null,
    });
  }
});

const files = process.argv.slice(2);
if (files.length === 0) {
  // If no args, load all batch-*.json in this directory
  const all = fs.readdirSync(__dirname).filter(f => f.startsWith('batch-') && f.endsWith('.json')).sort();
  files.push(...all.map(f => path.join(__dirname, f)));
}

let total = 0;
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  insertMany(data);
  total += data.length;
  console.log(`  Inserted ${data.length} from ${path.basename(file)}`);
}

const countAfter = db.prepare('SELECT COUNT(*) as c FROM entries').get().c;
console.log(`\nEntries after: ${countAfter} (+${countAfter - countBefore})`);
console.log(`Total inserted: ${total}`);
db.close();
