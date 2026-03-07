import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(20);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const url = new URL(request.url);
    const entryId = parseInt(url.searchParams.get('entry_id') || '', 10);
    if (!entryId || entryId <= 0) return jsonResponse({ error: 'entry_id required.' }, 400);

    const { findContradictions } = await import('../../../lib/db');
    const contradictions = await findContradictions(entryId);
    return jsonResponse({ entry_id: entryId, contradictions }, 200, 300);
  } catch (err) {
    console.error('Contradictions failed:', err);
    return jsonResponse({ error: 'Failed to find contradictions.' }, 500);
  }
};
