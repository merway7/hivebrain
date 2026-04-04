import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter, validateUsername } from '../../lib/api-utils';

const isRateLimited = createRateLimiter(60);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  try {
    const { listWikis, searchWikis } = await import('../../lib/wikis');
    const url = new URL(request.url);
    const q = url.searchParams.get('q');

    if (q && q.trim()) {
      const wiki = url.searchParams.get('wiki') || undefined;
      const limit = Math.max(1, Math.min(20, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
      const results = await searchWikis(q.trim(), { wiki, limit });
      return jsonResponse({ query: q.trim(), count: results.length, results }, 200, 30);
    }

    const owner = url.searchParams.get('owner') || undefined;
    const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

    const { wikis, total } = await listWikis({ owner, is_public: true, limit, offset });
    return jsonResponse({ wikis, total, limit, offset }, 200, 30);
  } catch (err) {
    console.error('Wikis GET failed:', err);
    return jsonResponse({ error: 'Failed to list wikis.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const { createWiki, getWiki } = await import('../../lib/wikis');
    const { slug, description, schema_content, is_public, tags, username } = body || {};

    if (!slug || typeof slug !== 'string' || slug.trim().length < 2) {
      return jsonResponse({ error: 'slug is required (min 2 chars).' }, 400);
    }

    const owner = validateUsername(username || process.env.HIVEBRAIN_USERNAME);
    if (owner === 'anonymous') {
      return jsonResponse({ error: 'username is required to create a wiki.' }, 400);
    }

    const normalizedSlug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const fullSlug = `${owner}/${normalizedSlug}`;

    const existing = await getWiki(fullSlug);
    if (existing) {
      return jsonResponse({ error: `Wiki "${fullSlug}" already exists.`, existing_id: existing.id }, 409);
    }

    const wiki = await createWiki({
      owner, slug: normalizedSlug,
      description: typeof description === 'string' ? description.trim().slice(0, 500) : undefined,
      schema_content: typeof schema_content === 'string' ? schema_content.slice(0, 50000) : undefined,
      is_public: is_public !== false,
      tags: Array.isArray(tags) ? tags.slice(0, 20).map((t: any) => String(t).trim().slice(0, 50)) : [],
    });

    return jsonResponse({ status: 'created', wiki }, 201);
  } catch (err) {
    console.error('Wikis POST failed:', err);
    return jsonResponse({ error: 'Failed to create wiki.' }, 500);
  }
};
