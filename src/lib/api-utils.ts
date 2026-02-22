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
    if (key === 'upvotes' && value === 0) continue;
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
