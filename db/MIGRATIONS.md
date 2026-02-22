# HiveBrain Database Migrations

## Schema Versions

### v1 — Initial schema
- `db/schema.sql` creates the `entries` table and FTS5 index
- Run automatically on first server start via `src/lib/db.ts`

### v2 — Metadata columns
- **File:** `db/migrate-v2.js`
- **Added:** language, framework, environment, error_messages, keywords, severity, context, code_snippets, related_entries, version_info
- **Added indexes:** category, language, framework, severity, created_at
- **Run:** `node db/migrate-v2.js`

### v3 — FTS expansion
- **File:** `db/migrate-v3-fts.js`
- **Changed:** Rebuilt FTS5 to index tags, language, framework (was only title, problem, solution, why)
- **Now indexes:** title, problem, solution, why, error_messages, keywords, context, tags, language, framework
- **Run:** `node db/migrate-v3-fts.js`

### v4 — Category expansion
- **Changed:** CHECK constraint expanded from (pattern, gotcha, principle) to include (snippet, debug)
- **Applied via:** Manual ALTER TABLE (recreate table with new constraint)

## How to run migrations
1. Stop the dev server
2. Run the migration script: `node db/<migration-file>.js`
3. Restart the dev server

## Seed data
- `node db/seed.js` — imports entries from knowledge.json
- `node db/enrich.js` — enriches entries with detailed content
