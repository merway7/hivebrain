import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { findCoverageGaps } = await import('../../../lib/db');
    const gaps = await findCoverageGaps();
    return jsonResponse(gaps, 200, 300);
  } catch (err) {
    console.error('Coverage gaps failed:', err);
    return jsonResponse({ error: 'Failed to find coverage gaps.' }, 500);
  }
};
