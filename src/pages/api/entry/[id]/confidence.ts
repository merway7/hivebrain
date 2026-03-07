import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

export const GET: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const id = parseInt(params.id!, 10);
  if (isNaN(id)) return jsonResponse({ error: 'Invalid entry ID.' }, 400);

  try {
    const { computeConfidence } = await import('../../../../lib/db');
    const result = await computeConfidence(id);
    return jsonResponse(result, 200, 60);
  } catch (err) {
    console.error('Confidence computation failed:', err);
    return jsonResponse({ error: 'Failed to compute confidence.' }, 500);
  }
};
