import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);
const isHeavyRateLimited = createRateLimiter(2);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { getCooccurringTags } = await import('../../../lib/db');
    const url = new URL(request.url);
    const tag = url.searchParams.get('tag');
    if (!tag) return jsonResponse({ error: 'Query param "tag" is required.' }, 400);

    const related = await getCooccurringTags(tag);
    return jsonResponse({ tag, related }, 200, 300);
  } catch (err) {
    console.error('Tag co-occurrence failed:', err);
    return jsonResponse({ error: 'Failed to get co-occurring tags.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isHeavyRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { buildTagCooccurrence } = await import('../../../lib/db');
    const count = await buildTagCooccurrence();
    return jsonResponse({ rebuilt: true, pairs: count }, 200);
  } catch (err) {
    console.error('Tag co-occurrence rebuild failed:', err);
    return jsonResponse({ error: 'Failed to rebuild co-occurrence matrix.' }, 500);
  }
};
