import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { getLearningCurves } = await import('../../../lib/db');
    const url = new URL(request.url);
    const tag = url.searchParams.get('tag') || undefined;
    const days = parseInt(url.searchParams.get('days') || '90', 10) || 90;
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20);

    const curves = await getLearningCurves({ tag, days, limit });
    return jsonResponse(curves, 200, 300);
  } catch (err) {
    console.error('Learning curves failed:', err);
    return jsonResponse({ error: 'Failed to compute learning curves.' }, 500);
  }
};
