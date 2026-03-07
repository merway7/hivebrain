import type { APIRoute } from 'astro';
import { getReputation, getUserBadges, getUserEntries } from '../../../lib/db';
import { jsonResponse, createRateLimiter, validateUsername } from '../../../lib/api-utils';
import { BADGES } from '../../../lib/badges';

const isRateLimited = createRateLimiter(60);

export const GET: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  const username = validateUsername(params.username);
  if (username === 'anonymous') {
    return jsonResponse({ error: 'Invalid username.' }, 400);
  }

  try {
    const rep = await getReputation(username);
    const badges = await getUserBadges(username);
    const recentEntries = await getUserEntries(username, 5);

    const enrichedBadges = badges.map(b => {
      const def = BADGES.find(d => d.id === b.badge_id);
      return {
        id: b.badge_id,
        name: def?.name || b.badge_id,
        icon: def?.icon || '',
        description: def?.description || '',
        earned_at: b.earned_at,
      };
    });

    return jsonResponse({
      username,
      total_rep: rep?.total_rep || 0,
      entries_count: rep?.entries_count || 0,
      upvotes_received: rep?.upvotes_received || 0,
      usages_received: rep?.usages_received || 0,
      verifications_received: rep?.verifications_received || 0,
      badges: enrichedBadges,
      recent_entries: recentEntries.map(e => ({
        id: e.id,
        title: e.title,
        category: e.category,
        severity: e.severity,
        upvotes: e.upvotes,
        usage_count: e.usage_count,
      })),
    }, 200, 60);
  } catch (err) {
    console.error('User profile failed:', err);
    return jsonResponse({ error: 'Failed to fetch user profile.' }, 500);
  }
};
