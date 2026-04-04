import type { APIRoute } from 'astro';
import { jsonResponse, requestId, createRateLimiter, validateUsername } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(60);

function parseSlug(slug: string | undefined): string | null {
  if (!slug) return null;
  // Expect owner/name format
  const parts = slug.split('/');
  if (parts.length < 2) return null;
  return `${parts[0]}/${parts[1]}`;
}

export const GET: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const fullSlug = parseSlug(params.slug);
  if (!fullSlug) return jsonResponse({ error: 'Invalid comb slug. Use owner/name format.' }, 400);

  try {
    const { getComb, listFiles, getFile, getFileRevisions, getCombRevisions, getCombStats } = await import('../../../lib/combs');
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    const comb = await getComb(fullSlug);
    if (!comb) return jsonResponse({ error: `Comb "${fullSlug}" not found.` }, 404);

    // Get a specific file
    if (action === 'file') {
      const path = url.searchParams.get('path');
      if (!path) return jsonResponse({ error: 'path parameter is required.' }, 400);

      const revision = url.searchParams.get('revision');
      if (revision) {
        // Get file at specific revision
        const fileRow = await getFile(comb.id, path);
        if (!fileRow) return jsonResponse({ error: `File "${path}" not found.` }, 404);
        const { getFileAtRevision } = await import('../../../lib/combs');
        const rev = await getFileAtRevision(fileRow.id, parseInt(revision, 10));
        if (!rev) return jsonResponse({ error: `Revision ${revision} not found.` }, 404);
        return jsonResponse(rev, 200, 30);
      }

      const file = await getFile(comb.id, path);
      if (!file) return jsonResponse({ error: `File "${path}" not found.` }, 404);
      return jsonResponse(file, 200, 30);
    }

    // List file revisions
    if (action === 'revisions') {
      const path = url.searchParams.get('path');
      const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

      if (path) {
        const file = await getFile(comb.id, path);
        if (!file) return jsonResponse({ error: `File "${path}" not found.` }, 404);
        const revisions = await getFileRevisions(file.id, limit, offset);
        return jsonResponse({ file_path: path, revisions }, 200, 30);
      }

      // All revisions for the comb
      const revisions = await getCombRevisions(comb.id, limit, offset);
      return jsonResponse({ comb: fullSlug, revisions }, 200, 30);
    }

    // Stats
    if (action === 'stats') {
      const stats = await getCombStats(comb.id);
      return jsonResponse({ comb: fullSlug, ...stats }, 200, 30);
    }

    // Default: comb metadata + file listing
    const files = await listFiles(comb.id);
    return jsonResponse({ ...comb, files }, 200, 30);
  } catch (err) {
    console.error('Comb GET failed:', err);
    return jsonResponse({ error: 'Failed to get comb.' }, 500);
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const fullSlug = parseSlug(params.slug);
  if (!fullSlug) return jsonResponse({ error: 'Invalid comb slug.' }, 400);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const { getComb, pushFiles } = await import('../../../lib/combs');

    const comb = await getComb(fullSlug);
    if (!comb) return jsonResponse({ error: `Comb "${fullSlug}" not found.` }, 404);

    const { files, message, username } = body || {};

    if (!Array.isArray(files) || files.length === 0) {
      return jsonResponse({ error: 'files array is required with at least one { path, content } object.' }, 400);
    }

    // Validate files
    const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB per file
    const MAX_PUSH_SIZE = 10 * 1024 * 1024; // 10MB total
    let totalSize = 0;

    for (const f of files) {
      if (!f.path || typeof f.path !== 'string') {
        return jsonResponse({ error: 'Each file must have a path string.' }, 400);
      }
      if (!f.content || typeof f.content !== 'string') {
        return jsonResponse({ error: `File "${f.path}" must have content string.` }, 400);
      }
      if (f.content.length > MAX_FILE_SIZE) {
        return jsonResponse({ error: `File "${f.path}" exceeds 1MB limit.` }, 400);
      }
      totalSize += f.content.length;
    }
    if (totalSize > MAX_PUSH_SIZE) {
      return jsonResponse({ error: 'Total push size exceeds 10MB limit.' }, 400);
    }

    const pushedBy = validateUsername(username || process.env.HIVEBRAIN_USERNAME);

    const results = await pushFiles({
      comb_id: comb.id,
      files: files.map((f: any) => ({ path: String(f.path).trim(), content: String(f.content) })),
      message: typeof message === 'string' ? message.trim().slice(0, 500) : undefined,
      pushed_by: pushedBy,
    });

    const changed = results.filter(r => r.changed).length;
    const unchanged = results.filter(r => !r.changed).length;

    return jsonResponse({
      status: 'pushed',
      comb: fullSlug,
      changed,
      unchanged,
      files: results,
    }, 200);
  } catch (err) {
    console.error('Comb push failed:', err);
    return jsonResponse({ error: 'Failed to push files.' }, 500);
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const fullSlug = parseSlug(params.slug);
  if (!fullSlug) return jsonResponse({ error: 'Invalid comb slug.' }, 400);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const { getComb, updateComb } = await import('../../../lib/combs');

    const comb = await getComb(fullSlug);
    if (!comb) return jsonResponse({ error: `Comb "${fullSlug}" not found.` }, 404);

    const updates: any = {};
    if (body.description !== undefined) updates.description = String(body.description).trim().slice(0, 500);
    if (body.is_public !== undefined) updates.is_public = body.is_public === true;
    if (Array.isArray(body.tags)) updates.tags = body.tags.slice(0, 20).map((t: any) => String(t).trim().slice(0, 50));

    const updated = await updateComb(comb.id, updates);
    return jsonResponse({ status: 'updated', comb: updated }, 200);
  } catch (err) {
    console.error('Comb PATCH failed:', err);
    return jsonResponse({ error: 'Failed to update comb.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const fullSlug = parseSlug(params.slug);
  if (!fullSlug) return jsonResponse({ error: 'Invalid comb slug.' }, 400);

  try {
    const { getComb, deleteComb } = await import('../../../lib/combs');

    const comb = await getComb(fullSlug);
    if (!comb) return jsonResponse({ error: `Comb "${fullSlug}" not found.` }, 404);

    await deleteComb(comb.id);
    return jsonResponse({ status: 'deleted', comb: fullSlug }, 200);
  } catch (err) {
    console.error('Comb DELETE failed:', err);
    return jsonResponse({ error: 'Failed to delete comb.' }, 500);
  }
};
