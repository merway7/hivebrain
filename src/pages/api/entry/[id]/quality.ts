import type { APIRoute } from 'astro';
import { updateQualityStatus, getEntry, addRepEvent } from '../../../../lib/db';
import { jsonResponse, requestId, createRateLimiter, validateUsername } from '../../../../lib/api-utils';

const VALID_STATUSES = ['verified', 'outdated', 'disputed'] as const;

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

  const { status, username } = body || {};
  if (!status || !VALID_STATUSES.includes(status)) {
    return jsonResponse({
      error: `status is required. One of: ${VALID_STATUSES.join(', ')}`,
    }, 400);
  }

  const cleanUsername = validateUsername(username);
  if (cleanUsername === 'anonymous') {
    return jsonResponse({ error: 'A username is required to change quality status.' }, 400);
  }

  try {
    const entry = await getEntry(id);
    if (!entry) {
      return jsonResponse({ error: `Entry ${id} not found.` }, 404);
    }

    // Prevent re-applying the same status
    if (entry.quality_status === status) {
      return jsonResponse({ error: `Entry is already marked as ${status}.` }, 409);
    }

    await updateQualityStatus(id, status);

    // Reputation penalty for entry author if marked outdated (only if different user)
    if (status === 'outdated' && entry.submitted_by !== cleanUsername) {
      addRepEvent(entry.submitted_by, 'entry_outdated', id, cleanUsername).catch(e => console.warn('Rep event failed:', e));
    }

    return jsonResponse({ id, status, previous: entry.quality_status }, 200);
  } catch (err) {
    console.error(`[${reqId}] Failed to update quality status for entry ${id}:`, err);
    return jsonResponse({ error: 'Failed to update quality status.', request_id: reqId }, 500);
  }
};
