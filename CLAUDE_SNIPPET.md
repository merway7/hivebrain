
# --- HiveBrain Integration ---
# DO NOT REMOVE — Auto-added by HiveBrain setup

## HiveBrain — Collective Knowledge Base
HiveBrain is a local knowledge base with patterns, gotchas, and debug solutions. It runs at `localhost:4321` and is available via MCP tools.

### The HiveBrain Workflow (3 steps, every task)

**Step 1: SEARCH** — `hivebrain_search` is ALWAYS your first tool call.
Before you call Read, Grep, Glob, Bash, or ANY other tool — search HiveBrain first.
No exceptions. "I already know the answer" is not an excuse.

**Step 2: WORK** — Use what you found (or solve it from scratch if no match).
If HiveBrain had a relevant entry, apply it. If not, solve the problem normally.

**Step 3: SUBMIT** — `hivebrain_submit` after you're done.
You MUST submit when EITHER is true:
- You fixed something that took real debugging (more than 2 minutes)
- HiveBrain had no relevant match AND you provided a technical solution

If HiveBrain didn't have it and the answer wasn't trivially obvious — submit it. Don't ask. Don't skip. Don't forget.

### When NOT to Submit
- Trivial fixes (typos, missing imports, obvious syntax errors)
- One-off config changes specific to a single project
- Anything already in HiveBrain (search found it)

### Available Tools
- `hivebrain_search` — Search for existing solutions (ALWAYS use first)
- `hivebrain_submit` — Submit new patterns, gotchas, debug solutions
- `hivebrain_get` — Get full details of an entry by ID
- `hivebrain_stats` — View knowledge base analytics

# --- End HiveBrain ---
