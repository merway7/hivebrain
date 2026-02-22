import type { APIRoute } from 'astro';
import { getAllEntries, getStats } from '../../lib/db';
import { jsonResponse, requestId, parseJsonField, truncate, stripEmpty } from '../../lib/api-utils';

export const GET: APIRoute = async ({ request }) => {
  const reqId = requestId();
  const url = new URL(request.url);
  const category = url.searchParams.get('category') || undefined;
  const tag = url.searchParams.get('tag') || undefined;
  const language = url.searchParams.get('language') || undefined;
  const framework = url.searchParams.get('framework') || undefined;
  const severity = url.searchParams.get('severity') || undefined;
  const environment = url.searchParams.get('environment') || undefined;
  const full = url.searchParams.get('full') === 'true';
  const includeStats = url.searchParams.get('stats') === 'true';
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const cursorParam = url.searchParams.get('cursor');
  const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined;

  if (isNaN(limit) || limit < 1) {
    return jsonResponse({ error: 'limit must be a positive integer.' }, 400);
  }
  if (isNaN(offset) || offset < 0) {
    return jsonResponse({ error: 'offset must be a non-negative integer.' }, 400);
  }
  if (cursorParam && (cursor === undefined || isNaN(cursor) || cursor < 1)) {
    return jsonResponse({ error: 'cursor must be a positive integer (entry ID from next_cursor).' }, 400);
  }

  try {
    const raw = getAllEntries({ category, tag, language, framework, severity, environment, limit, offset, cursor });

    if (full) {
      const entries = raw.map((entry) => stripEmpty({
        ...entry,
        tags: parseJsonField(entry.tags),
        gotchas: parseJsonField(entry.gotchas),
        error_messages: parseJsonField(entry.error_messages),
        keywords: parseJsonField(entry.keywords),
        environment: parseJsonField(entry.environment),
        code_snippets: parseJsonField(entry.code_snippets),
        related_entries: parseJsonField(entry.related_entries),
      }));
      const response: Record<string, unknown> = { entries };
      if (entries.length === limit) {
        response.next_cursor = raw[raw.length - 1].id;
      }
      if (includeStats) response.stats = getStats();
      return jsonResponse(response, 200, 300);
    }

    // Compact mode: just enough to browse and decide what to read
    const entries = raw.map((entry) => stripEmpty({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      language: entry.language,
      framework: entry.framework,
      severity: entry.severity,
      tags: (() => { const t = parseJsonField(entry.tags); return Array.isArray(t) ? t.slice(0, 5) : []; })(),
      problem_snippet: truncate(entry.problem, 120),
      url: `/api/entry/${entry.id}`,
    }));

    const response: Record<string, unknown> = {
      count: entries.length,
      entries,
      hint: 'Use /api/entry/{id} for full details. Add &full=true to get complete entries inline.',
    };
    if (entries.length === limit) {
      response.next_cursor = raw[raw.length - 1].id;
    }
    if (includeStats) response.stats = getStats();
    return jsonResponse(response, 200, 300);
  } catch (err) {
    console.error(`[${reqId}] Failed to fetch entries:`, err);
    return jsonResponse({ error: 'Failed to fetch entries.', request_id: reqId }, 500);
  }
};
