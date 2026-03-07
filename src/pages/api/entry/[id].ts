import type { APIRoute } from 'astro';
import { getEntry, trackView, incrementUsageCount, getRevisions, addUsageContext, getLatestVerification, computeFreshness } from '../../../lib/db';
import { jsonResponse, requestId, parseJsonField, stripEmpty, pickFields, validateUsername } from '../../../lib/api-utils';

export const GET: APIRoute = async ({ params, request }) => {
  const reqId = requestId();
  const id = parseInt(params.id || '', 10);

  if (isNaN(id) || id < 1) {
    return jsonResponse({ error: 'Invalid entry ID.' }, 400);
  }

  try {
    const entry = await getEntry(id);
    if (!entry) {
      return jsonResponse({ error: `Entry ${id} not found.` }, 404);
    }

    // Track view
    const url = new URL(request.url);
    const source = url.searchParams.get('source') || 'api';
    await trackView(id, source);

    // Increment usage count for MCP consumers
    if (source === 'mcp') {
      await incrementUsageCount(id);
      // Accept optional usage context (max 500 chars, deduplicated within 5 min)
      const usageContext = url.searchParams.get('usage_context');
      if (usageContext && usageContext.trim().length > 0) {
        const trimmedContext = usageContext.trim().slice(0, 500);
        const submittedBy = validateUsername(url.searchParams.get('username') || undefined);
        await addUsageContext(id, trimmedContext, submittedBy);
      }
    }

    const parsed = stripEmpty({
      ...entry,
      tags: parseJsonField(entry.tags),
      gotchas: parseJsonField(entry.gotchas),
      error_messages: parseJsonField(entry.error_messages),
      keywords: parseJsonField(entry.keywords),
      environment: parseJsonField(entry.environment),
      code_snippets: parseJsonField(entry.code_snippets),
      related_entries: parseJsonField(entry.related_entries),
    });

    // Include revisions
    const revisions = await getRevisions(id);
    if (revisions.length > 0) {
      (parsed as any).revisions = revisions;
    }

    // Include verification status
    const latestVerification = await getLatestVerification(id);
    if (latestVerification) {
      (parsed as any).verified = true;
      (parsed as any).last_verified = new Date(latestVerification.verified_at * 1000).toISOString().split('T')[0];
    }

    // Compute freshness
    const freshness = computeFreshness(entry, latestVerification?.verified_at);
    if (freshness !== 'fresh') {
      (parsed as any).freshness = freshness;
    }

    // Optional field filtering: ?fields=solution,gotchas,error_messages
    const fieldsParam = url.searchParams.get('fields');
    if (fieldsParam) {
      const fields = fieldsParam.split(',').map(f => f.trim()).filter(Boolean);
      return jsonResponse(pickFields(parsed, fields), 200, 300);
    }

    return jsonResponse(parsed, 200, 300);
  } catch (err) {
    console.error(`[${reqId}] Failed to fetch entry ${id}:`, err);
    return jsonResponse({ error: 'Failed to fetch entry.', request_id: reqId }, 500);
  }
};
