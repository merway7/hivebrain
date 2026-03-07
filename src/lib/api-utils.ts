/**
 * Shared utilities for API endpoints.
 * Focused on minimizing token consumption for AI agent consumers.
 */

export function requestId(): string {
  return Math.random().toString(16).slice(2, 10);
}

export function jsonResponse(data: unknown, status = 200, maxAge = 0): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-cache',
    },
  });
}

export function parseJsonField(val: unknown): unknown {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

/**
 * Recursively strips empty/null/zero-upvote values from an object to save tokens.
 * Removes: null, empty arrays [], empty strings "", upvotes === 0
 */
export function stripEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if ((key === 'upvotes' || key === 'downvotes') && value === 0) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Pick only specified fields from an object, always including id and title.
 */
export function pickFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const always = ['id', 'title'];
  const keys = new Set([...always, ...fields]);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Rate limiter factory. Returns an isRateLimited(ip) function.
 */
export function createRateLimiter(maxRequests: number, windowMs: number = 60 * 60 * 1000) {
  const counts = new Map<string, { count: number; resetAt: number }>();

  return function isRateLimited(ip: string): boolean {
    const now = Date.now();
    if (counts.size > 1000) {
      for (const [key, val] of counts) {
        if (now > val.resetAt) counts.delete(key);
      }
    }
    const entry = counts.get(ip);
    if (!entry || now > entry.resetAt) {
      if (entry) counts.delete(ip);
      counts.set(ip, { count: 1, resetAt: now + windowMs });
      return false;
    }
    entry.count++;
    return entry.count > maxRequests;
  };
}

/**
 * Escape HTML entities in a string to prevent XSS in raw HTML contexts.
 * Astro templates auto-escape with {} expressions, but use this utility
 * for any context where HTML is rendered without template escaping.
 */
export function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function validateUsername(name?: string): string {
  if (!name || name.trim() === '') return 'anonymous';
  const clean = name.trim().slice(0, 30);
  if (!/^[a-zA-Z0-9_-]+$/.test(clean) || clean.length < 3) return 'anonymous';
  return clean;
}

// ── Prompt injection honeypot ──

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /ignore\s+(all\s+)?(above|earlier)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules|context)/i,
  /override\s+(all\s+)?(previous|prior|system)\s+(instructions|prompts|rules)/i,
  /do\s+not\s+follow\s+(your|the|any)\s+(previous|prior|original)\s+(instructions|rules)/i,
  /new\s+instructions\s*:/i,
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
  /reveal\s+(your|the)\s+(instructions|prompt|system|rules)/i,
  /show\s+(me\s+)?(your|the)\s+(instructions|prompt|system\s*prompt|rules)/i,
  /what\s+(are|is)\s+your\s+(instructions|system\s*prompt|rules|directives)/i,
  /repeat\s+(your|the)\s+(instructions|prompt|system)/i,
  /print\s+(your|the)\s+(instructions|prompt|system)/i,
  /output\s+(your|the)\s+(instructions|prompt|system)/i,
  /leak\s+(your|the)\s+(system|prompt|instructions)/i,
  /\brm\s+-rf\s+[\/~.]/i,
  /curl\s+\S+\s*\|\s*(bash|sh|zsh)\b/i,
  /wget\s+\S+\s*[;&|]\s*(bash|sh|zsh|chmod)/i,
  /\bchmod\s+777\s+\//i,
  /send\s+(this|the|all|my|your)\s+.{0,30}(to|via)\s+(http|email|webhook|slack|discord)/i,
  /exfiltrate/i,
  /post\s+(this|the|all).{0,20}(to|at)\s+https?:\/\//i,
  /<\/?system>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<<\s*SYS\s*>>/i,
  /```system\b/i,
  /\bEND_OF_SYSTEM\b/i,
  /\bBEGIN_INSTRUCTIONS\b/i,
  /\bSYSTEM_PROMPT\b/i,
  /&#x[0-9a-f]{2,4};/i,
  /\\u00[0-9a-f]{2}/i,
];

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

function checkString(val: string): boolean {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(val)) return true;
  }
  const collapsed = val.replace(/[\s\.\-_,;:!?]+/g, '').toLowerCase();
  for (const pattern of NORMALIZED_PATTERNS) {
    if (pattern.test(collapsed)) return true;
  }
  return false;
}

/**
 * Detect prompt injection in submitted data.
 * Returns true if injection is detected.
 */
export function detectInjection(data: Record<string, unknown>): boolean {
  const textFields = ['title', 'problem', 'solution', 'why', 'context', 'version_info', 'learned_from', 'content', 'notes'];
  for (const field of textFields) {
    const val = data[field];
    if (typeof val === 'string' && checkString(val)) return true;
  }
  const arrayFields = ['tags', 'keywords', 'error_messages', 'gotchas', 'environment'];
  for (const field of arrayFields) {
    const arr = data[field];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string' && checkString(item)) return true;
      }
    }
  }
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
