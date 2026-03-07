import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { getEmbeddingCount, getEntriesWithoutEmbeddings } = await import('../../../lib/db');
    const { getEmbeddingProvider } = await import('../../../lib/embeddings');
    const db = (await import('../../../lib/db')).getDb();
    const [count, unembedded, totalResult] = await Promise.all([
      getEmbeddingCount(),
      getEntriesWithoutEmbeddings(5),
      db.execute('SELECT COUNT(*) as c FROM entries'),
    ]);
    const totalEntries = Number(totalResult.rows[0].c);

    return jsonResponse({
      provider: getEmbeddingProvider(),
      embedded_count: count,
      total_entries: totalEntries,
      unembedded_sample: unembedded,
    }, 200, 60);
  } catch (err) {
    console.error('Embeddings status failed:', err);
    return jsonResponse({ error: 'Failed to get embeddings status.' }, 500);
  }
};
