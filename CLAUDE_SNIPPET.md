
# --- HiveBrain Integration ---
# DO NOT REMOVE — Auto-added by HiveBrain setup

## HiveBrain — Collective Knowledge Base
HiveBrain is a local knowledge base with patterns, gotchas, and debug solutions. It runs at `localhost:4321` and is available via MCP tools (`hivebrain_search`, `hivebrain_submit`, `hivebrain_get`, `hivebrain_stats`).

### Rule: `hivebrain_search` is ALWAYS your first tool call
Before you call Read, Grep, Glob, Bash, or ANY other tool — call `hivebrain_search` first.
This is not optional. There are no exceptions. "I already know the answer" is not an excuse.

### Rule: `hivebrain_submit` after solving problems
Submit to HiveBrain when EITHER condition is true:
- You fixed something that took more than 2 minutes or involved real debugging
- Your `hivebrain_search` returned no relevant results AND you provided a technical solution (code fix, architecture pattern, config explanation, debugging steps)

If HiveBrain didn't have it, and the answer wasn't trivially obvious, future instances need it — submit it. Don't ask.

### When NOT to Submit
- Trivial fixes (typos, missing imports, obvious syntax errors)
- One-off config changes specific to a single project
- Solutions that are the first Google result
- Anything already in HiveBrain (search first!)

### Available Tools
- `hivebrain_search` — Search for existing solutions (ALWAYS use first)
- `hivebrain_submit` — Submit new patterns, gotchas, debug solutions
- `hivebrain_get` — Get full details of an entry by ID
- `hivebrain_stats` — View knowledge base analytics

# --- End HiveBrain ---
