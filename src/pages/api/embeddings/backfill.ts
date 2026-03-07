import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(5, 60 * 60 * 1000);

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { getEntriesWithoutEmbeddings, embedEntry } = await import('../../../lib/db');
    const url = new URL(request.url);
    const batchSize = Math.min(100, parseInt(url.searchParams.get('batch') || '50', 10) || 50);

    const ids = await getEntriesWithoutEmbeddings(batchSize);
    let embedded = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        await embedEntry(id);
        embedded++;
      } catch {
        failed++;
      }
    }

    return jsonResponse({
      status: 'backfill_complete',
      embedded,
      failed,
      remaining: ids.length === batchSize ? 'more entries to process' : 'none',
    }, 200);
  } catch (err) {
    console.error('Backfill failed:', err);
    return jsonResponse({ error: 'Backfill failed.' }, 500);
  }
};
