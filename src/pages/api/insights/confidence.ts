import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { getConfidenceDistribution } = await import('../../../lib/db');
    const distribution = await getConfidenceDistribution();
    return jsonResponse(distribution, 200, 300);
  } catch (err) {
    console.error('Confidence distribution failed:', err);
    return jsonResponse({ error: 'Failed to get confidence distribution.' }, 500);
  }
};
