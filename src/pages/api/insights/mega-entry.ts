import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { generateMegaEntry } = await import('../../../lib/db');
    const url = new URL(request.url);
    const tags = url.searchParams.get('tags');
    if (!tags) return jsonResponse({ error: 'Query param "tags" is required (pipe-separated, e.g., "react|hooks")' }, 400);

    const mega = await generateMegaEntry(tags);
    if (!mega) return jsonResponse({ error: 'Not enough entries to generate a mega-entry for these tags.' }, 404);
    return jsonResponse(mega, 200, 300);
  } catch (err) {
    console.error('Mega-entry generation failed:', err);
    return jsonResponse({ error: 'Failed to generate mega-entry.' }, 500);
  }
};
