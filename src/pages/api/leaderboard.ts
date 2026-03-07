import type { APIRoute } from 'astro';
import { getLeaderboard, getUserBadges } from '../../lib/db';
import { jsonResponse, createRateLimiter } from '../../lib/api-utils';

const isRateLimited = createRateLimiter(60);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  const url = new URL(request.url);
  const period = url.searchParams.get('period') as 'all' | 'monthly' | 'weekly' | null;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(50, parseInt(limitParam, 10) || 20)) : 20;

  const validPeriods = ['all', 'monthly', 'weekly'];
  const safePeriod = period && validPeriods.includes(period) ? period : 'all';

  try {
    const leaderboard = await getLeaderboard({ limit, period: safePeriod });

    // Enrich with badge IDs
    const enriched = await Promise.all(leaderboard.map(async (entry, i) => {
      const badges = await getUserBadges(entry.username);
      return {
        rank: i + 1,
        ...entry,
        badges: badges.map(b => b.badge_id),
      };
    }));

    return jsonResponse({ period: safePeriod, leaderboard: enriched }, 200, 60);
  } catch (err) {
    console.error('Leaderboard failed:', err);
    return jsonResponse({ error: 'Failed to fetch leaderboard.' }, 500);
  }
};
