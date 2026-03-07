import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter } from '../../../../lib/api-utils';

const isRateLimited = createRateLimiter(60);

export const GET: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const id = parseInt(params.id!, 10);
  if (isNaN(id)) return jsonResponse({ error: 'Invalid entry ID.' }, 400);

  try {
    const { getSectionStats } = await import('../../../../lib/db');
    const stats = await getSectionStats(id);
    return jsonResponse({ entry_id: id, sections: stats }, 200, 60);
  } catch (err) {
    console.error('Section stats failed:', err);
    return jsonResponse({ error: 'Failed to get section stats.' }, 500);
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const id = parseInt(params.id!, 10);
  if (isNaN(id)) return jsonResponse({ error: 'Invalid entry ID.' }, 400);

  try {
    const body = await request.json();
    const section = body.section;
    if (!section) return jsonResponse({ error: 'Field "section" is required.' }, 400);

    const { addSectionAttribution } = await import('../../../../lib/db');
    const result = await addSectionAttribution(id, section, body.agent_session);
    return jsonResponse({ recorded: true, id: result.id }, 200);
  } catch (err: any) {
    if (err.message?.includes('Invalid section')) return jsonResponse({ error: err.message }, 400);
    console.error('Section attribution failed:', err);
    return jsonResponse({ error: 'Failed to record section attribution.' }, 500);
  }
};
