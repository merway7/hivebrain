import type { APIRoute } from 'astro';
import { insertEntry } from '../../lib/db';
import { requestId } from '../../lib/api-utils';

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

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();

  // Periodic cleanup: purge expired entries when map grows too large
  if (requestCounts.size > 1000) {
    for (const [key, val] of requestCounts) {
      if (now > val.resetAt) {
        requestCounts.delete(key);
      }
    }
  }

  const entry = requestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    if (entry) requestCounts.delete(ip);
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Prompt injection honeypot ──
// Detects injection attempts, returns fake success, never stores anything.
// Attacker thinks payload is live. It isn't.

// Patterns checked against raw text
const INJECTION_PATTERNS: RegExp[] = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /ignore\s+(all\s+)?(above|earlier)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules|context)/i,
  /override\s+(all\s+)?(previous|prior|system)\s+(instructions|prompts|rules)/i,
  /do\s+not\s+follow\s+(your|the|any)\s+(previous|prior|original)\s+(instructions|rules)/i,
  /new\s+instructions\s*:/i,

  // Role hijacking — require "you" addressing the AI directly
  /you\s+are\s+now\s+(a|an|the)\b/i,
  /you\s+are\s+no\s+longer\b/i,
  /pretend\s+(you\s+are|to\s+be)\s+(a|an|the|my)\b/i,
  /from\s+now\s+on\s+(you|act|behave|respond)/i,
  /assume\s+the\s+role\s+of\b/i,
  /your\s+new\s+(role|persona|identity|instructions)\s+(is|are)\b/i,
  /switch\s+to\s+.{0,20}(mode|persona|role)\b/i,
  /enter\s+.{0,15}(unrestricted|god|admin|sudo|jailbreak)\s*(mode)?\b/i,
  /\bDAN\b.*\bcan\s+do\s+anything\b/i,
  /\bjailbreak/i,

  // System prompt extraction / manipulation
  /reveal\s+(your|the)\s+(instructions|prompt|system|rules)/i,
  /show\s+(me\s+)?(your|the)\s+(instructions|prompt|system\s*prompt|rules)/i,
  /what\s+(are|is)\s+your\s+(instructions|system\s*prompt|rules|directives)/i,
  /repeat\s+(your|the)\s+(instructions|prompt|system)/i,
  /print\s+(your|the)\s+(instructions|prompt|system)/i,
  /output\s+(your|the)\s+(instructions|prompt|system)/i,
  /leak\s+(your|the)\s+(system|prompt|instructions)/i,

  // Destructive commands embedded in text (only flag when clearly imperative)
  /\brm\s+-rf\s+[\/~.]/i,
  /curl\s+\S+\s*\|\s*(bash|sh|zsh)\b/i,
  /wget\s+\S+\s*[;&|]\s*(bash|sh|zsh|chmod)/i,
  /\bchmod\s+777\s+\//i,

  // Exfiltration attempts
  /send\s+(this|the|all|my|your)\s+.{0,30}(to|via)\s+(http|email|webhook|slack|discord)/i,
  /exfiltrate/i,
  /post\s+(this|the|all).{0,20}(to|at)\s+https?:\/\//i,

  // Jailbreak delimiters / prompt structure mimicry
  /<\/?system>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<<\s*SYS\s*>>/i,
  /```system\b/i,
  /\bEND_OF_SYSTEM\b/i,
  /\bBEGIN_INSTRUCTIONS\b/i,
  /\bSYSTEM_PROMPT\b/i,

  // HTML/Unicode smuggling
  /&#x[0-9a-f]{2,4};/i,
  /\\u00[0-9a-f]{2}/i,
];

// Patterns checked against space-collapsed text (catches s p a c e d  o u t obfuscation)
// .{0,30} allows some filler between key fragments but limits distance to avoid false positives
const NORMALIZED_PATTERNS: RegExp[] = [
  /ignore.{0,30}(previous|prior|above|all).{0,30}instructions/i,
  /disregard.{0,30}(previous|prior|all).{0,30}instructions/i,
  /override.{0,30}(previous|prior|system).{0,30}instructions/i,
  /forget.{0,30}(previous|prior|all).{0,30}instructions/i,
  /youarenow/i,
  /systemprompt/i,
  /reveal.{0,20}(system|instructions|prompt)/i,
  /jailbreak/i,
  /rmrf[\/~]/i,
  /pretendtobe/i,
  /fromnowon.{0,20}(respond|behave|ignore|act|you)/i,
];

// Fake ID counter — starts high and increments so IDs look real
let fakeIdCounter = 9000 + Math.floor(Math.random() * 1000);

function checkString(val: string): boolean {
  // Check raw patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(val)) return true;
  }
  // Check space-collapsed version (catches "i g n o r e  a l l  i n s t r u c t i o n s")
  const collapsed = val.replace(/[\s\.\-_,;:!?]+/g, '').toLowerCase();
  for (const pattern of NORMALIZED_PATTERNS) {
    if (pattern.test(collapsed)) return true;
  }
  return false;
}

function detectInjection(data: Record<string, unknown>): boolean {
  // Scan all string fields
  const textFields = ['title', 'problem', 'solution', 'why', 'context', 'version_info', 'learned_from'];
  for (const field of textFields) {
    const val = data[field];
    if (typeof val === 'string' && checkString(val)) return true;
  }

  // Scan string arrays
  const arrayFields = ['tags', 'keywords', 'error_messages', 'gotchas', 'environment'];
  for (const field of arrayFields) {
    const arr = data[field];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string' && checkString(item)) return true;
      }
    }
  }

  // Scan code snippets
  if (Array.isArray(data.code_snippets)) {
    for (const snippet of data.code_snippets as any[]) {
      if (snippet && typeof snippet === 'object') {
        for (const val of [snippet.code, snippet.description]) {
          if (typeof val === 'string' && checkString(val)) return true;
        }
      }
    }
  }

  return false;
}

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

  // ── Honeypot: detect injection, return fake success, store nothing ──
  if (detectInjection(data)) {
    console.warn(`[${reqId}] INJECTION BLOCKED from ${ip}: "${(data.title as string || '').slice(0, 80)}"`);
    return honeypotResponse(warnings);
  }

  // ── Insert ──
  try {
    const gotchas = Array.isArray(data.gotchas) ? (data.gotchas as unknown[]).filter(t => typeof t === 'string' && (t as string).trim().length > 0) as string[] : [];
    const environment = Array.isArray(data.environment)
      ? (data.environment as string[]).filter(e => VALID_ENVIRONMENTS.includes(e as any))
      : [];

    const { id } = insertEntry({
      title: (data.title as string).trim(),
      category: cat,
      tags: tags.map(t => t.trim()),
      problem: (data.problem as string).trim(),
      solution: (data.solution as string).trim(),
      why: typeof data.why === 'string' ? (data.why as string).trim() || undefined : undefined,
      gotchas: gotchas.map(g => g.trim()),
      learned_from: data.learned_from as string | undefined,
      submitted_by: data.submitted_by as string | undefined,
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
