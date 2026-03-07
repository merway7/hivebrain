import type { APIRoute } from 'astro';
import { getNotificationPrefs, updateNotificationPrefs } from '../../../lib/db';
import { jsonResponse, createRateLimiter, validateUsername } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(30);

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

  try {
    const prefs = await getNotificationPrefs(username);
    return jsonResponse({ username, ...prefs }, 200);
  } catch (err) {
    console.error('Get notification prefs failed:', err);
    return jsonResponse({ error: 'Failed to fetch notification preferences.' }, 500);
  }
};

const VALID_FREQUENCIES = ['instant', 'daily', 'weekly', 'none'];
const BOOLEAN_FIELDS = ['notify_upvotes', 'notify_usages', 'notify_verifications', 'notify_revisions', 'notify_badges'] as const;

export const PUT: APIRoute = async ({ request }) => {
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

  const { username, ...updates } = body || {};
  const cleanUsername = validateUsername(username);
  if (cleanUsername === 'anonymous') {
    return jsonResponse({ error: 'Username is required.' }, 400);
  }

  // Validate updates
  const prefs: Record<string, any> = {};

  if ('email_frequency' in updates) {
    if (!VALID_FREQUENCIES.includes(updates.email_frequency)) {
      return jsonResponse({ error: `email_frequency must be one of: ${VALID_FREQUENCIES.join(', ')}` }, 400);
    }
    prefs.email_frequency = updates.email_frequency;
  }

  for (const field of BOOLEAN_FIELDS) {
    if (field in updates) {
      if (typeof updates[field] !== 'boolean') {
        return jsonResponse({ error: `${field} must be a boolean.` }, 400);
      }
      prefs[field] = updates[field];
    }
  }

  if (Object.keys(prefs).length === 0) {
    return jsonResponse({ error: 'No valid preferences to update.' }, 400);
  }

  try {
    await updateNotificationPrefs(cleanUsername, prefs);
    const updated = await getNotificationPrefs(cleanUsername);
    return jsonResponse({ username: cleanUsername, ...updated }, 200);
  } catch (err) {
    console.error('Update notification prefs failed:', err);
    return jsonResponse({ error: 'Failed to update notification preferences.' }, 500);
  }
};
