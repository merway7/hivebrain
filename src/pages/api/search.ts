import type { APIRoute } from 'astro';
import { searchEntries, trackSearch, type SearchSort } from '../../lib/db';
import { jsonResponse, requestId, parseJsonField, truncate, stripEmpty } from '../../lib/api-utils';

const VALID_SORTS: SearchSort[] = ['relevance', 'votes', 'newest', 'oldest', 'most_used', 'severity'];

export const GET: APIRoute = async ({ request }) => {
  const reqId = requestId();
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const full = url.searchParams.get('full') === 'true';
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(50, parseInt(limitParam, 10) || 50)) : undefined;
  const sortParam = url.searchParams.get('sort') as SearchSort | null;
  const sort: SearchSort = sortParam && VALID_SORTS.includes(sortParam) ? sortParam : 'relevance';

  if (!q || q.trim() === '') {
    return jsonResponse({ error: 'Query parameter "q" is required. Add &full=true for complete entries.' }, 400);
  }

  try {
    const results = await searchEntries(q.trim(), sort);
    const source = url.searchParams.get('source') || 'api';
    await trackSearch(q.trim(), results.length, source);

    // Apply limit if specified
    const limited = limit ? results.slice(0, limit) : results;

    if (full) {
      const parsed = limited.map(({ _score, bm25_score, ...entry }: any) => stripEmpty({
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
    const compact = limited.map(({ _score, bm25_score, ...entry }: any) => {
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
        is_canonical: entry.is_canonical ? true : undefined,
        freshness: entry.freshness_status !== 'fresh' ? entry.freshness_status : undefined,
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
