import type { APIRoute } from 'astro';
import { searchEntries, trackSearch } from '../../lib/db';
import { jsonResponse, requestId, parseJsonField, truncate, stripEmpty } from '../../lib/api-utils';

export const GET: APIRoute = async ({ request }) => {
  const reqId = requestId();
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const full = url.searchParams.get('full') === 'true';

  if (!q || q.trim() === '') {
    return jsonResponse({ error: 'Query parameter "q" is required. Add &full=true for complete entries.' }, 400);
  }

  try {
    const results = searchEntries(q.trim());
    const source = url.searchParams.get('source') || 'api';
    trackSearch(q.trim(), results.length, source);

    if (full) {
      const parsed = results.map(({ _score, bm25_score, ...entry }: any) => stripEmpty({
        ...entry,
        tags: parseJsonField(entry.tags),
        gotchas: parseJsonField(entry.gotchas),
        error_messages: parseJsonField(entry.error_messages),
        keywords: parseJsonField(entry.keywords),
        environment: parseJsonField(entry.environment),
        code_snippets: parseJsonField(entry.code_snippets),
        related_entries: parseJsonField(entry.related_entries),
      }));
      return jsonResponse(parsed, 200, 60);
    }

    // Default: compact mode — just enough to decide which entry to read
    const compact = results.map(({ _score, bm25_score, ...entry }: any) => {
      const tags = parseJsonField(entry.tags) as string[];
      const errorMsgs = parseJsonField(entry.error_messages) as string[];

      return stripEmpty({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        language: entry.language,
        framework: entry.framework,
        severity: entry.severity,
        tags: Array.isArray(tags) ? tags.slice(0, 5) : [],
        error_messages: Array.isArray(errorMsgs) ? errorMsgs.slice(0, 1) : [],
        problem_snippet: truncate(entry.problem, 120),
        url: `/api/entry/${entry.id}`,
      });
    });

    return jsonResponse({
      query: q.trim(),
      count: compact.length,
      results: compact,
      hint: 'Use /api/entry/{id} for full details. Add &full=true to get complete entries inline.',
    }, 200, 60);
  } catch (err) {
    console.error(`[${reqId}] Search failed:`, err);
    return jsonResponse({ error: 'Search failed.', request_id: reqId }, 500);
  }
};
