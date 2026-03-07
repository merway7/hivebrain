import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { getSearchChains } = await import('../../../lib/db');
    const url = new URL(request.url);
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10));
    const chains = await getSearchChains(2, limit);
    return jsonResponse(chains, 200, 120);
  } catch (err) {
    console.error('Search chains failed:', err);
    return jsonResponse({ error: 'Failed to get search chains.' }, 500);
  }
};
