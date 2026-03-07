import type { APIRoute } from 'astro';
import { getEntry, markCanonical } from '../../../../lib/db';
import { jsonResponse, requestId, validateUsername, createRateLimiter } from '../../../../lib/api-utils';

const isRateLimited = createRateLimiter(20);

export const POST: APIRoute = async ({ params, request }) => {
  const reqId = requestId();
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  const id = parseInt(params.id || '', 10);
  if (isNaN(id) || id < 1) {
    return jsonResponse({ error: 'Invalid entry ID.' }, 400);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const { canonical, username } = body || {};
  if (typeof canonical !== 'boolean') {
    return jsonResponse({ error: 'Field "canonical" (boolean) is required.' }, 400);
  }

  try {
    const entry = await getEntry(id);
    if (!entry) {
      return jsonResponse({ error: `Entry ${id} not found.` }, 404);
    }

    await markCanonical(id, canonical);
    return jsonResponse({
      id,
      is_canonical: canonical,
      marked_by: validateUsername(username),
    });
  } catch (err) {
    console.error(`[${reqId}] Failed to mark canonical:`, err);
    return jsonResponse({ error: 'Failed to update canonical status.', request_id: reqId }, 500);
  }
};
