import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter, parseJsonField, stripEmpty, truncate } from '../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { getCurriculum } = await import('../../lib/db');
    const url = new URL(request.url);
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20);
    const format = url.searchParams.get('format'); // 'compact' for MCP

    const entries = await getCurriculum(limit);

    if (format === 'compact') {
      // Ultra-compact for MCP bootstrap: just title + problem + solution
      const compact = entries.map((e: any) => ({
        id: e.id,
        title: e.title,
        category: e.category,
        problem: truncate(e.problem, 200),
        solution: truncate(e.solution, 300),
        tags: parseJsonField(e.tags),
      }));
      return jsonResponse(compact, 200, 600);
    }

    const full = entries.map((e: any) => stripEmpty({
      id: e.id,
      title: e.title,
      category: e.category,
      severity: e.severity,
      tags: parseJsonField(e.tags),
      problem: e.problem,
      solution: e.solution,
      why: e.why,
      usage_count: e.usage_count,
      success_rate: e.success_rate,
      upvotes: e.upvotes - e.downvotes,
    }));

    return jsonResponse({ entries: full, total: full.length }, 200, 600);
  } catch (err) {
    console.error('Curriculum failed:', err);
    return jsonResponse({ error: 'Failed to generate curriculum.' }, 500);
  }
};
