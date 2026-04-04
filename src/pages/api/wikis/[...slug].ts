import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter, validateUsername } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(60);

function parseSlug(slug: string | undefined): string | null {
  if (!slug) return null;
  const parts = slug.split('/');
  if (parts.length < 2) return null;
  return `${parts[0]}/${parts[1]}`;
}

export const GET: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const fullSlug = parseSlug(params.slug);
  if (!fullSlug) return jsonResponse({ error: 'Invalid wiki slug. Use owner/name format.' }, 400);

  try {
    const { getWiki, listPages, listSources, getPage, getSource, getPageRevisions,
            getWikiRevisions, getWikiStats, getLog, generateIndex,
            findOrphanPages, findBrokenLinks, findStalePages } = await import('../../../lib/wikis');
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    const wiki = await getWiki(fullSlug);
    if (!wiki) return jsonResponse({ error: `Wiki "${fullSlug}" not found.` }, 404);

    if (action === 'page') {
      const path = url.searchParams.get('path');
      if (!path) return jsonResponse({ error: 'path parameter is required.' }, 400);
      const revision = url.searchParams.get('revision');
      if (revision) {
        const pageRow = await getPage(wiki.id, path);
        if (!pageRow) return jsonResponse({ error: `Page "${path}" not found.` }, 404);
        const { getPageAtRevision } = await import('../../../lib/wikis');
        const rev = await getPageAtRevision(pageRow.id, parseInt(revision, 10));
        if (!rev) return jsonResponse({ error: `Revision ${revision} not found.` }, 404);
        return jsonResponse(rev, 200, 30);
      }
      const page = await getPage(wiki.id, path);
      if (!page) return jsonResponse({ error: `Page "${path}" not found.` }, 404);
      return jsonResponse(page, 200, 30);
    }

    if (action === 'source') {
      const path = url.searchParams.get('path');
      if (!path) return jsonResponse({ error: 'path parameter is required.' }, 400);
      const source = await getSource(wiki.id, path);
      if (!source) return jsonResponse({ error: `Source "${path}" not found.` }, 404);
      return jsonResponse(source, 200, 30);
    }

    if (action === 'pages') {
      const pages = await listPages(wiki.id);
      return jsonResponse({ wiki: fullSlug, pages }, 200, 30);
    }

    if (action === 'sources') {
      const sources = await listSources(wiki.id);
      return jsonResponse({ wiki: fullSlug, sources }, 200, 30);
    }

    if (action === 'log') {
      const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const log = await getLog(wiki.id, limit, offset);
      return jsonResponse({ wiki: fullSlug, log }, 200, 30);
    }

    if (action === 'index') {
      const index = await generateIndex(wiki.id);
      return jsonResponse({ wiki: fullSlug, index }, 200, 30);
    }

    if (action === 'revisions') {
      const path = url.searchParams.get('path');
      const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      if (path) {
        const page = await getPage(wiki.id, path);
        if (!page) return jsonResponse({ error: `Page "${path}" not found.` }, 404);
        const revisions = await getPageRevisions(page.id, limit, offset);
        return jsonResponse({ page_path: path, revisions }, 200, 30);
      }
      const revisions = await getWikiRevisions(wiki.id, limit, offset);
      return jsonResponse({ wiki: fullSlug, revisions }, 200, 30);
    }

    if (action === 'stats') {
      const stats = await getWikiStats(wiki.id);
      return jsonResponse({ wiki: fullSlug, ...stats }, 200, 30);
    }

    if (action === 'schema') {
      return jsonResponse({ wiki: fullSlug, schema_content: wiki.schema_content }, 200, 30);
    }

    if (action === 'lint') {
      const [orphans, broken, stale] = await Promise.all([
        findOrphanPages(wiki.id),
        findBrokenLinks(wiki.id),
        findStalePages(wiki.id, 30),
      ]);
      return jsonResponse({
        wiki: fullSlug,
        orphan_pages: orphans,
        broken_links: broken,
        stale_pages: stale,
        summary: {
          orphans: orphans.length,
          broken_links: broken.length,
          stale: stale.length,
        },
      }, 200, 30);
    }

    // Default: wiki metadata + page listing
    const pages = await listPages(wiki.id);
    const sources = await listSources(wiki.id);
    return jsonResponse({ ...wiki, pages, sources }, 200, 30);
  } catch (err) {
    console.error('Wiki GET failed:', err);
    return jsonResponse({ error: 'Failed to get wiki.' }, 500);
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const fullSlug = parseSlug(params.slug);
  if (!fullSlug) return jsonResponse({ error: 'Invalid wiki slug.' }, 400);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const { getWiki, pushPages, pushSource, appendLog } = await import('../../../lib/wikis');
    const wiki = await getWiki(fullSlug);
    if (!wiki) return jsonResponse({ error: `Wiki "${fullSlug}" not found.` }, 404);

    const { type, username } = body || {};
    const pushedBy = validateUsername(username || process.env.HIVEBRAIN_USERNAME);

    const MAX_FILE_SIZE = 1 * 1024 * 1024;
    const MAX_PUSH_SIZE = 10 * 1024 * 1024;

    if (type === 'sources') {
      const { sources } = body;
      if (!Array.isArray(sources) || sources.length === 0) {
        return jsonResponse({ error: 'sources array is required.' }, 400);
      }
      let totalSize = 0;
      for (const s of sources) {
        if (!s.path || !s.content) return jsonResponse({ error: 'Each source needs path and content.' }, 400);
        if (s.content.length > MAX_FILE_SIZE) return jsonResponse({ error: `Source "${s.path}" exceeds 1MB.` }, 400);
        totalSize += s.content.length;
      }
      if (totalSize > MAX_PUSH_SIZE) return jsonResponse({ error: 'Total push exceeds 10MB.' }, 400);

      const results = [];
      for (const s of sources) {
        results.push(await pushSource({
          wiki_id: wiki.id, path: String(s.path).trim(), content: String(s.content),
          mime_type: s.mime_type, ingested_by: pushedBy,
        }));
      }
      const newCount = results.filter(r => !r.already_existed).length;
      return jsonResponse({ status: 'ingested', wiki: fullSlug, new_sources: newCount, results }, 200);
    }

    if (type === 'pages') {
      const { pages, message } = body;
      if (!Array.isArray(pages) || pages.length === 0) {
        return jsonResponse({ error: 'pages array is required.' }, 400);
      }
      let totalSize = 0;
      for (const p of pages) {
        if (!p.path || !p.content) return jsonResponse({ error: 'Each page needs path and content.' }, 400);
        if (p.content.length > MAX_FILE_SIZE) return jsonResponse({ error: `Page "${p.path}" exceeds 1MB.` }, 400);
        totalSize += p.content.length;
      }
      if (totalSize > MAX_PUSH_SIZE) return jsonResponse({ error: 'Total push exceeds 10MB.' }, 400);

      const results = await pushPages({
        wiki_id: wiki.id,
        pages: pages.map((p: any) => ({ path: String(p.path).trim(), content: String(p.content) })),
        message: typeof message === 'string' ? message.trim().slice(0, 500) : undefined,
        pushed_by: pushedBy,
      });
      const changed = results.filter(r => r.changed).length;
      return jsonResponse({ status: 'pushed', wiki: fullSlug, changed, unchanged: results.length - changed, pages: results }, 200);
    }

    if (type === 'log') {
      const { operation, summary, details } = body;
      if (!operation || !['ingest', 'query', 'lint'].includes(operation)) {
        return jsonResponse({ error: 'operation must be ingest, query, or lint.' }, 400);
      }
      if (!summary || typeof summary !== 'string') {
        return jsonResponse({ error: 'summary is required.' }, 400);
      }
      const entry = await appendLog({
        wiki_id: wiki.id, operation, summary: summary.trim().slice(0, 500),
        details: typeof details === 'string' ? details.slice(0, 5000) : undefined,
        performed_by: pushedBy,
      });
      return jsonResponse({ status: 'logged', entry }, 201);
    }

    if (type === 'schema') {
      const { schema_content } = body;
      if (typeof schema_content !== 'string') {
        return jsonResponse({ error: 'schema_content string is required.' }, 400);
      }
      const { updateWiki } = await import('../../../lib/wikis');
      await updateWiki(wiki.id, { schema_content: schema_content.slice(0, 50000) });
      return jsonResponse({ status: 'schema_updated', wiki: fullSlug }, 200);
    }

    // Default: treat as page push (backwards compat with combs-like interface)
    const { files, message } = body;
    if (Array.isArray(files) && files.length > 0) {
      let totalSize = 0;
      for (const f of files) {
        if (!f.path || !f.content) return jsonResponse({ error: 'Each file needs path and content.' }, 400);
        if (f.content.length > MAX_FILE_SIZE) return jsonResponse({ error: `File "${f.path}" exceeds 1MB.` }, 400);
        totalSize += f.content.length;
      }
      if (totalSize > MAX_PUSH_SIZE) return jsonResponse({ error: 'Total push exceeds 10MB.' }, 400);

      const results = await pushPages({
        wiki_id: wiki.id,
        pages: files.map((f: any) => ({ path: String(f.path).trim(), content: String(f.content) })),
        message: typeof message === 'string' ? message.trim().slice(0, 500) : undefined,
        pushed_by: pushedBy,
      });
      const changed = results.filter(r => r.changed).length;
      return jsonResponse({ status: 'pushed', wiki: fullSlug, changed, unchanged: results.length - changed, pages: results }, 200);
    }

    return jsonResponse({ error: 'Specify type: "pages", "sources", "log", or "schema".' }, 400);
  } catch (err) {
    console.error('Wiki POST failed:', err);
    return jsonResponse({ error: 'Failed to process wiki request.' }, 500);
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const fullSlug = parseSlug(params.slug);
  if (!fullSlug) return jsonResponse({ error: 'Invalid wiki slug.' }, 400);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const { getWiki, updateWiki } = await import('../../../lib/wikis');
    const wiki = await getWiki(fullSlug);
    if (!wiki) return jsonResponse({ error: `Wiki "${fullSlug}" not found.` }, 404);

    const updates: any = {};
    if (body.description !== undefined) updates.description = String(body.description).trim().slice(0, 500);
    if (body.is_public !== undefined) updates.is_public = body.is_public === true;
    if (Array.isArray(body.tags)) updates.tags = body.tags.slice(0, 20).map((t: any) => String(t).trim().slice(0, 50));
    if (body.schema_content !== undefined) updates.schema_content = String(body.schema_content).slice(0, 50000);

    const updated = await updateWiki(wiki.id, updates);
    return jsonResponse({ status: 'updated', wiki: updated }, 200);
  } catch (err) {
    console.error('Wiki PATCH failed:', err);
    return jsonResponse({ error: 'Failed to update wiki.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const fullSlug = parseSlug(params.slug);
  if (!fullSlug) return jsonResponse({ error: 'Invalid wiki slug.' }, 400);

  try {
    const { getWiki, deleteWiki } = await import('../../../lib/wikis');
    const wiki = await getWiki(fullSlug);
    if (!wiki) return jsonResponse({ error: `Wiki "${fullSlug}" not found.` }, 404);
    await deleteWiki(wiki.id);
    return jsonResponse({ status: 'deleted', wiki: fullSlug }, 200);
  } catch (err) {
    console.error('Wiki DELETE failed:', err);
    return jsonResponse({ error: 'Failed to delete wiki.' }, 500);
  }
};
