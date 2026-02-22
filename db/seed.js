import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "hivebrain.db");
const SCHEMA_PATH = join(__dirname, "schema.sql");
const KNOWLEDGE_PATH = "/Users/merwanito/local_AI/test/do_what_you_want/brain/knowledge.json";

// Read inputs
const schema = readFileSync(SCHEMA_PATH, "utf-8");
const knowledge = JSON.parse(readFileSync(KNOWLEDGE_PATH, "utf-8"));

// Open database and run schema
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(schema);

// Prepare insert statement
const insert = db.prepare(`
  INSERT INTO entries (title, category, tags, problem, solution, why, gotchas, learned_from, submitted_by)
  VALUES (@title, @category, @tags, @problem, @solution, @why, @gotchas, @learned_from, @submitted_by)
`);

// Insert all entries in a transaction
const insertAll = db.transaction((entries) => {
  for (const entry of entries) {
    insert.run({
      title: entry.title,
      category: entry.category,
      tags: JSON.stringify(entry.tags || []),
      problem: entry.problem,
      solution: entry.solution,
      why: entry.why || null,
      gotchas: JSON.stringify(entry.gotchas || []),
      learned_from: entry.learned_from || null,
      submitted_by: "claude-brain",
    });
  }
});

insertAll(knowledge.entries);

const count = db.prepare("SELECT COUNT(*) as count FROM entries").get();
console.log(`Seeded ${count.count} entries into ${DB_PATH}`);

db.close();
