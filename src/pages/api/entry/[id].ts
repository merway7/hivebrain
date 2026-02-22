import type { APIRoute } from 'astro';
import { getEntry } from '../../../lib/db';
import { jsonResponse, requestId, parseJsonField, stripEmpty, pickFields } from '../../../lib/api-utils';

export const GET: APIRoute = async ({ params, request }) => {
  const reqId = requestId();
  const id = parseInt(params.id || '', 10);

  if (isNaN(id) || id < 1) {
    return jsonResponse({ error: 'Invalid entry ID.' }, 400);
  }

  try {
    const entry = getEntry(id);
    if (!entry) {
      return jsonResponse({ error: `Entry ${id} not found.` }, 404);
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

    // Optional field filtering: ?fields=solution,gotchas,error_messages
    const url = new URL(request.url);
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
