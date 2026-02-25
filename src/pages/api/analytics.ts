import type { APIRoute } from 'astro';
import { getAnalytics } from '../../lib/db';
import { jsonResponse } from '../../lib/api-utils';

export const GET: APIRoute = async () => {
  try {
    const analytics = getAnalytics();
    return jsonResponse(analytics, 200, 10);
  } catch (err) {
    console.error('Analytics failed:', err);
    return jsonResponse({ error: 'Failed to fetch analytics.' }, 500);
  }
};
