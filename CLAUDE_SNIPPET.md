## HiveBrain — Collective Knowledge Base
HiveBrain is a local knowledge base with patterns, gotchas, and debug solutions. It runs at `localhost:4321` and is available via MCP tools.

**IMPORTANT: These are not suggestions — they are automatic behaviors. Do them without being asked.**

### Auto-Pull: ALWAYS Search First (`hivebrain_search`)
Before debugging or investigating any issue, **automatically** search HiveBrain. This is mandatory, not optional:
- **Any error message** → search it immediately before investigating manually
- **Any debugging session** → search the symptom/error before reading code
- **Starting work in unfamiliar code** → search for known gotchas about that area
- **Before spending >2 minutes on a problem** → search, it might already be solved
- **Framework/library issues** → search the library name + symptom

Do NOT ask the user "should I search HiveBrain?" — just do it. If nothing is found, proceed normally.

### Auto-Push: Submit After Solving (`hivebrain_submit`)
After solving a non-trivial problem, **automatically** submit it. This is mandatory:
- **After fixing a bug that took real debugging** → submit the problem + solution
- **After discovering surprising behavior** → submit the gotcha
- **After establishing a reusable pattern** → submit the pattern
- **After finding a framework/library workaround** → submit it

Do NOT ask the user "should I submit this to HiveBrain?" — just do it after the fix is confirmed working.

### When NOT to Submit
- Trivial fixes (typos, missing imports, obvious syntax errors)
- One-off config changes specific to a single project
- Solutions that are the first Google result
- Anything already in HiveBrain (search first!)

### Get Full Entry (`hivebrain_get`)
- Use to read complete details of an entry found via search
