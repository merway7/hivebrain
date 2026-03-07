import type { APIRoute } from 'astro';
import { addVote, getVoteForIp, getEntry, addRepEvent } from '../../../../lib/db';
import { jsonResponse, requestId, validateUsername } from '../../../../lib/api-utils';
import { dispatchNotification } from '../../../../lib/notifications';

export const POST: APIRoute = async ({ params, request }) => {
  const reqId = requestId();
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

  const { direction, username } = body || {};
  if (direction !== 'up' && direction !== 'down') {
    return jsonResponse({ error: 'direction is required. Must be "up" or "down".' }, 400);
  }

  const ip = request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip')
    || 'unknown';

  try {
    const entry = await getEntry(id);
    if (!entry) {
      return jsonResponse({ error: `Entry ${id} not found.` }, 404);
    }

    // Rate limit: 1 vote per IP per entry per hour
    const existing = await getVoteForIp(id, ip, 1);
    if (existing) {
      return jsonResponse({
        error: 'Rate limited. You can vote on this entry once per hour.',
        existing_vote: existing.direction,
      }, 429);
    }

    const result = await addVote(id, direction, ip, validateUsername(username));

    // Reputation + notification for entry author (fire-and-forget, skip self-votes)
    const voterName = validateUsername(username);
    if (voterName === 'anonymous' || voterName !== entry.submitted_by) {
      const repType = direction === 'up' ? 'upvote_received' : 'downvote_received';
      addRepEvent(entry.submitted_by, repType, id, voterName).catch(e => console.warn('Rep event failed:', e));
      const notifType = direction === 'up' ? 'upvote' : 'downvote';
      dispatchNotification(entry.submitted_by, notifType, id, { sourceUsername: voterName, entryTitle: entry.title }).catch(() => {});
    }

    return jsonResponse({ id: result.id, status: 'recorded', direction }, 201);
  } catch (err) {
    console.error(`[${reqId}] Failed to record vote for entry ${id}:`, err);
    return jsonResponse({ error: 'Failed to record vote.', request_id: reqId }, 500);
  }
};
