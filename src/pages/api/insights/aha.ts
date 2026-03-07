import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter, parseJsonField, stripEmpty, truncate } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { getAhaEntries } = await import('../../../lib/db');
    const url = new URL(request.url);
    const limit = Math.min(30, parseInt(url.searchParams.get('limit') || '10', 10) || 10);

    const entries = await getAhaEntries(limit);
    const compact = entries.map((e: any) => stripEmpty({
      id: e.id,
      title: e.title,
      category: e.category,
      severity: e.severity,
      tags: parseJsonField(e.tags),
      problem_snippet: truncate(e.problem, 150),
      usage_count: e.usage_count,
      success_rate: e.success_rate,
      surprise_score: e.surprise_score,
      upvotes: e.upvotes - e.downvotes,
    }));

    return jsonResponse({ entries: compact, total: compact.length }, 200, 300);
  } catch (err) {
    console.error('Aha feed failed:', err);
    return jsonResponse({ error: 'Failed to get aha entries.' }, 500);
  }
};
