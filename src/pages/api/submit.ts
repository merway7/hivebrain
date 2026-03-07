import type { APIRoute } from 'astro';
import { insertEntry, findDuplicates } from '../../lib/db';
import { requestId, jsonResponse, createRateLimiter, detectInjection, validateUsername } from '../../lib/api-utils';

const VALID_CATEGORIES = ['pattern', 'gotcha', 'principle', 'snippet', 'debug'] as const;
const VALID_LANGUAGES = [
  'python', 'javascript', 'typescript', 'rust', 'go', 'java', 'c', 'cpp',
  'csharp', 'ruby', 'php', 'swift', 'kotlin', 'sql', 'css', 'html', 'bash',
  'yaml', 'toml', 'shell',
] as const;
const VALID_FRAMEWORKS = [
  'react', 'nextjs', 'remix', 'vue', 'nuxt', 'svelte', 'sveltekit', 'angular',
  'django', 'flask', 'fastapi', 'express', 'nestjs', 'hono', 'fastify',
  'rails', 'spring', 'laravel', 'gin', 'echo', 'actix',
  'astro', 'gatsby', 'eleventy', 'hugo',
  'playwright', 'jest', 'pytest', 'vitest', 'cypress',
  'docker', 'kubernetes', 'terraform',
  'tailwind', 'bootstrap',
  'prisma', 'drizzle', 'sequelize', 'sqlalchemy',
  'git',
] as const;
const VALID_SEVERITIES = ['critical', 'major', 'moderate', 'minor', 'tip'] as const;
const VALID_ENVIRONMENTS = [
  'macos', 'linux', 'windows', 'docker', 'ci-cd', 'browser', 'nodejs',
  'ssr', 'edge', 'mobile', 'terminal', 'claude-code', 'ide', 'editor',
] as const;

const isRateLimited = createRateLimiter(10);

// ── Personal terms blocklist (from HIVEBRAIN_BLOCKLIST env var) ──
// Comma-separated list of project names, brand names, etc. that should never appear in entries.
// Example: HIVEBRAIN_BLOCKLIST=Flair,SnapQuote,Lasting Words,MyCompany
function getBlocklist(): string[] {
  const raw = import.meta.env.HIVEBRAIN_BLOCKLIST || process.env.HIVEBRAIN_BLOCKLIST || '';
  return raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
}

function checkBlocklist(data: Record<string, unknown>): { blocked: boolean; term: string; field: string } | null {
  const blocklist = getBlocklist();
  if (blocklist.length === 0) return null;

  const textFields: [string, string][] = [
    ['title', String(data.title || '')],
    ['problem', String(data.problem || '')],
    ['solution', String(data.solution || '')],
    ['why', String(data.why || '')],
    ['context', String(data.context || '')],
  ];

  // Also check tags and keywords arrays
  if (Array.isArray(data.tags)) {
    textFields.push(['tags', (data.tags as string[]).join(' ')]);
  }
  if (Array.isArray(data.keywords)) {
    textFields.push(['keywords', (data.keywords as string[]).join(' ')]);
  }

  for (const term of blocklist) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    for (const [field, text] of textFields) {
      if (regex.test(text)) {
        return { blocked: true, term, field };
      }
    }
  }
  return null;
}

// Fake ID counter — starts high and increments so IDs look real
let fakeIdCounter = 9000 + Math.floor(Math.random() * 1000);

function honeypotResponse(warnings: Warning[]): Response {
  const fakeId = ++fakeIdCounter;
  // Simulate realistic server latency (50-200ms) so it doesn't look instant
  const response: Record<string, unknown> = {
    id: fakeId,
    status: 'created',
    url: `/api/entry/${fakeId}`,
  };
  if (warnings.length > 0) {
    response.warnings = warnings;
  }
  return jsonResponse(response, 201);
}

type Issue = { field: string; issue: string };
type Warning = { field: string; suggestion: string };

export const POST: APIRoute = async ({ request }) => {
  const reqId = requestId();
  const ip = request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip')
    || 'unknown';

  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded. Max 10 requests per hour.' }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Request body must be a JSON object.' }, 400);
  }

  const data = body as Record<string, unknown>;
  const issues: Issue[] = [];
  const warnings: Warning[] = [];

  // ── Required fields ──
  // Prose can be short — metadata makes it findable

  // title: min 10 chars
  if (!data.title || typeof data.title !== 'string' || (data.title as string).trim().length < 10) {
    issues.push({ field: 'title', issue: `Required, min 10 chars. Current: ${typeof data.title === 'string' ? (data.title as string).trim().length : 0}` });
  }

  // category
  if (!data.category || !VALID_CATEGORIES.includes(data.category as any)) {
    issues.push({ field: 'category', issue: `Required. One of: ${VALID_CATEGORIES.join(', ')}` });
  }

  // problem: min 50 chars (was 200 — metadata carries the discovery burden now)
  if (!data.problem || typeof data.problem !== 'string' || (data.problem as string).trim().length < 50) {
    issues.push({ field: 'problem', issue: `Required, min 50 chars. Describe what goes wrong. Current: ${typeof data.problem === 'string' ? (data.problem as string).trim().length : 0}` });
  }

  // solution: min 80 chars (was 300 — concise solutions with code are fine)
  if (!data.solution || typeof data.solution !== 'string' || (data.solution as string).trim().length < 80) {
    issues.push({ field: 'solution', issue: `Required, min 80 chars. How to fix it. Current: ${typeof data.solution === 'string' ? (data.solution as string).trim().length : 0}` });
  }

  // severity: required
  if (!data.severity || !VALID_SEVERITIES.includes(data.severity as any)) {
    issues.push({ field: 'severity', issue: `Required. One of: ${VALID_SEVERITIES.join(', ')}` });
  }

  // ── Required metadata (this is what makes search work) ──

  // tags: min 3
  const tags = Array.isArray(data.tags) ? (data.tags as unknown[]).filter(t => typeof t === 'string' && (t as string).trim().length > 0) as string[] : [];
  if (tags.length < 3) {
    issues.push({ field: 'tags', issue: `Min 3 tags required (got ${tags.length}). Include: language, topic, tools.` });
  }

  // keywords: min 3 (these are the hidden search magnets)
  const keywords = Array.isArray(data.keywords) ? (data.keywords as unknown[]).filter(t => typeof t === 'string' && (t as string).trim().length > 0) as string[] : [];
  if (keywords.length < 3) {
    issues.push({ field: 'keywords', issue: `Min 3 keywords required (got ${keywords.length}). These are search terms beyond tags — synonyms, related concepts, tools.` });
  }

  // error_messages: required for gotcha/debug categories
  const errorMessages = Array.isArray(data.error_messages) ? (data.error_messages as unknown[]).filter(t => typeof t === 'string' && (t as string).trim().length > 0) as string[] : [];
  const cat = data.category as string;
  if ((cat === 'gotcha' || cat === 'debug') && errorMessages.length === 0) {
    issues.push({ field: 'error_messages', issue: `Required for '${cat}' category. Include exact error strings agents would see.` });
  }

  // ── Category-specific template validation ──
  const CATEGORY_TEMPLATES: Record<string, { required: string[]; recommended: string[] }> = {
    debug:     { required: ['error_messages'], recommended: ['environment', 'version_info', 'context'] },
    gotcha:    { required: ['error_messages'], recommended: ['why', 'gotchas'] },
    snippet:   { required: ['code_snippets'],  recommended: ['context', 'version_info'] },
    pattern:   { required: [],                 recommended: ['why', 'gotchas', 'context'] },
    principle: { required: ['why'],            recommended: ['gotchas', 'code_snippets'] },
  };
  const template = CATEGORY_TEMPLATES[cat];
  if (template) {
    for (const field of template.required) {
      if (field === 'error_messages' || field === 'code_snippets') {
        // error_messages already checked above for gotcha/debug
        if (field === 'code_snippets' && (!Array.isArray(data.code_snippets) || (data.code_snippets as unknown[]).length === 0)) {
          issues.push({ field, issue: `Required for '${cat}' category. Include at least one code snippet.` });
        }
      } else if (field === 'why') {
        if (!data.why || typeof data.why !== 'string' || (data.why as string).trim().length === 0) {
          issues.push({ field, issue: `Required for '${cat}' category. Explain the root cause or reasoning.` });
        }
      }
    }
    for (const field of template.recommended) {
      const val = data[field];
      const isEmpty = !val || (typeof val === 'string' && val.trim() === '') || (Array.isArray(val) && val.length === 0);
      if (isEmpty) {
        warnings.push({ field, suggestion: `Recommended for '${cat}' entries. Improves quality and searchability.` });
      }
    }
  }

  // language: validate if provided
  if (data.language != null && data.language !== '') {
    if (!VALID_LANGUAGES.includes(data.language as any)) {
      issues.push({ field: 'language', issue: `"${data.language}" not recognized. Valid: ${VALID_LANGUAGES.join(', ')}` });
    }
  }

  // framework: validate if provided
  if (data.framework != null && data.framework !== '') {
    if (!VALID_FRAMEWORKS.includes(data.framework as any)) {
      issues.push({ field: 'framework', issue: `"${data.framework}" not recognized. Valid: ${VALID_FRAMEWORKS.join(', ')}` });
    }
  }

  // ── Recommended fields (warnings, not blockers) ──

  if (!data.why || typeof data.why !== 'string' || (data.why as string).trim().length === 0) {
    warnings.push({ field: 'why', suggestion: 'Explain the root cause. Makes the entry much more useful.' });
  }

  if (!Array.isArray(data.gotchas) || (data.gotchas as unknown[]).length === 0) {
    warnings.push({ field: 'gotchas', suggestion: 'Add edge cases or common mistakes.' });
  }

  if (!data.framework || data.framework === '') {
    warnings.push({ field: 'framework', suggestion: 'Specify framework if relevant (react, nextjs, django, etc.).' });
  }

  if (!Array.isArray(data.environment) || (data.environment as unknown[]).length === 0) {
    warnings.push({ field: 'environment', suggestion: `Where does this apply? Valid: ${VALID_ENVIRONMENTS.join(', ')}` });
  }

  if (!data.context || typeof data.context !== 'string') {
    warnings.push({ field: 'context', suggestion: 'When does this happen? (e.g., "during deployment", "at build time")' });
  }

  if (!data.version_info || typeof data.version_info !== 'string') {
    warnings.push({ field: 'version_info', suggestion: 'Version constraints? (e.g., "React 18+", "Python 3.10+")' });
  }

  if (errorMessages.length === 0 && cat !== 'gotcha' && cat !== 'debug') {
    warnings.push({ field: 'error_messages', suggestion: 'Include exact error strings for better searchability.' });
  }

  // code_snippets: optional, validate structure if provided
  let codeSnippets: { code: string; lang?: string; description?: string }[] = [];
  if (data.code_snippets != null) {
    if (!Array.isArray(data.code_snippets)) {
      issues.push({ field: 'code_snippets', issue: 'Must be an array of {code, lang?, description?} objects.' });
    } else {
      const items = data.code_snippets as unknown[];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || typeof item !== 'object' || typeof (item as any).code !== 'string' || (item as any).code.trim().length === 0) {
          issues.push({ field: 'code_snippets', issue: `Item [${i}] must have a non-empty "code" string.` });
        } else {
          codeSnippets.push({
            code: (item as any).code,
            lang: typeof (item as any).lang === 'string' ? (item as any).lang : undefined,
            description: typeof (item as any).description === 'string' ? (item as any).description : undefined,
          });
        }
      }
    }
  } else {
    warnings.push({ field: 'code_snippets', suggestion: 'Add code examples as [{code, lang, description}] for richer entries.' });
  }

  // related_entries: optional, validate as array of numbers
  let relatedEntries: number[] = [];
  if (data.related_entries != null) {
    if (!Array.isArray(data.related_entries)) {
      issues.push({ field: 'related_entries', issue: 'Must be an array of entry ID numbers.' });
    } else {
      const items = data.related_entries as unknown[];
      for (let i = 0; i < items.length; i++) {
        if (typeof items[i] !== 'number' || !Number.isInteger(items[i])) {
          issues.push({ field: 'related_entries', issue: `Item [${i}] must be an integer entry ID.` });
        } else {
          relatedEntries.push(items[i] as number);
        }
      }
    }
  } else {
    warnings.push({ field: 'related_entries', suggestion: 'Link related entry IDs as [1, 2, 3] for cross-referencing.' });
  }

  // ── Reject if issues ──
  if (issues.length > 0) {
    return jsonResponse({
      error: 'Submission rejected',
      issues,
      warnings,
      hint: 'Focus on metadata: tags, keywords, error_messages. These make entries findable. Prose can be concise.',
      token_budget: {
        problem: '50-300 chars',
        solution: '80-500 chars',
        tags: '3+ strings',
        keywords: '3+ strings (search terms beyond tags)',
        error_messages: 'exact error strings (required for gotcha/debug)',
      },
    }, 400);
  }

  // ── Blocklist: reject entries containing personal/project terms ──
  const blockHit = checkBlocklist(data);
  if (blockHit) {
    return jsonResponse({
      error: 'Submission contains a blocked personal term',
      issues: [{ field: blockHit.field, issue: `Contains blocked term "${blockHit.term}". HiveBrain entries must be generic — remove project names, brand names, and personal identifiers. Use generic terms like "the app" instead.` }],
      hint: 'Check your HIVEBRAIN_BLOCKLIST in .env for the full list of blocked terms.',
    }, 400);
  }

  // ── Honeypot: detect injection, return fake success, store nothing ──
  if (detectInjection(data)) {
    console.warn(`[${reqId}] INJECTION BLOCKED from ${ip}: "${(data.title as string || '').slice(0, 80)}"`);
    return honeypotResponse(warnings);
  }

  // ── Duplicate detection ──
  try {
    const duplicates = await findDuplicates((data.title as string).trim());
    if (duplicates.length > 0) {
      warnings.push({
        field: 'title',
        suggestion: `Possible duplicates found: ${duplicates.slice(0, 3).map(d => `#${d.id} "${d.title}"`).join(', ')}. Consider updating an existing entry instead.`,
      });
    }
  } catch { /* duplicate check is best-effort */ }

  // ── Insert ──
  try {
    const gotchas = Array.isArray(data.gotchas) ? (data.gotchas as unknown[]).filter(t => typeof t === 'string' && (t as string).trim().length > 0) as string[] : [];
    const environment = Array.isArray(data.environment)
      ? (data.environment as string[]).filter(e => VALID_ENVIRONMENTS.includes(e as any))
      : [];

    const { id } = await insertEntry({
      title: (data.title as string).trim(),
      category: cat,
      tags: tags.map(t => t.trim()),
      problem: (data.problem as string).trim(),
      solution: (data.solution as string).trim(),
      why: typeof data.why === 'string' ? (data.why as string).trim() || undefined : undefined,
      gotchas: gotchas.map(g => g.trim()),
      learned_from: data.learned_from as string | undefined,
      submitted_by: validateUsername(data.username as string || data.submitted_by as string),
      language: (data.language as string) || null,
      framework: (data.framework as string) || null,
      severity: data.severity as string,
      environment,
      error_messages: errorMessages.map(e => e.trim()),
      keywords: keywords.map(k => k.trim()),
      context: data.context as string | undefined,
      version_info: data.version_info as string | undefined,
      code_snippets: codeSnippets.length > 0 ? codeSnippets : undefined,
      related_entries: relatedEntries.length > 0 ? relatedEntries : undefined,
    });

    const response: Record<string, unknown> = {
      id,
      status: 'created',
      url: `/api/entry/${id}`,
    };

    if (warnings.length > 0) {
      response.warnings = warnings;
    }

    return jsonResponse(response, 201);
  } catch (err) {
    console.error(`[${reqId}] Failed to insert entry:`, err);
    return jsonResponse({ error: 'Failed to create entry.', request_id: reqId }, 500);
  }
};
