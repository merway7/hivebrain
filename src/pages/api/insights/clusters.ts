import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(10);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { getDistillationClusters } = await import('../../../lib/db');
    const url = new URL(request.url);
    const minSize = Math.max(2, parseInt(url.searchParams.get('min_size') || '3', 10) || 3);

    const clusters = await getDistillationClusters(minSize);
    return jsonResponse({ clusters, total: clusters.length }, 200, 600);
  } catch (err) {
    console.error('Clusters failed:', err);
    return jsonResponse({ error: 'Failed to compute clusters.' }, 500);
  }
};
