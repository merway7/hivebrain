import type { APIRoute } from 'astro';
import { getNotifications, markNotificationsRead, getUnreadCount } from '../../lib/db';
import { jsonResponse, createRateLimiter, validateUsername } from '../../lib/api-utils';

const isRateLimited = createRateLimiter(60);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  const url = new URL(request.url);
  const username = validateUsername(url.searchParams.get('username') || undefined);
  if (username === 'anonymous') {
    return jsonResponse({ error: 'Username is required.' }, 400);
  }

  const unreadOnly = url.searchParams.get('unread') === 'true';
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(50, parseInt(limitParam, 10) || 20)) : 20;

  try {
    const [notifications, unread] = await Promise.all([
      getNotifications(username, { unreadOnly, limit }),
      getUnreadCount(username),
    ]);

    return jsonResponse({ username, unread_count: unread, notifications }, 200);
  } catch (err) {
    console.error('Notifications fetch failed:', err);
    return jsonResponse({ error: 'Failed to fetch notifications.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const { username, ids } = body || {};
  const cleanUsername = validateUsername(username);
  if (cleanUsername === 'anonymous') {
    return jsonResponse({ error: 'Username is required.' }, 400);
  }

  // Validate ids if provided
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.some((id: any) => typeof id !== 'number' || id < 1)) {
      return jsonResponse({ error: 'ids must be an array of positive integers.' }, 400);
    }
    if (ids.length > 100) {
      return jsonResponse({ error: 'Cannot mark more than 100 notifications at once.' }, 400);
    }
  }

  try {
    await markNotificationsRead(cleanUsername, ids);
    return jsonResponse({ message: 'Notifications marked as read.' }, 200);
  } catch (err) {
    console.error('Mark notifications read failed:', err);
    return jsonResponse({ error: 'Failed to mark notifications as read.' }, 500);
  }
};
