import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter, detectInjection } from '../../../../lib/api-utils';

const isRateLimited = createRateLimiter(60);

export const GET: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const id = parseInt(params.id || '', 10);
  if (!id || id <= 0) return jsonResponse({ error: 'Invalid entry ID.' }, 400);

  try {
    const { getReasoningTraces, getRetrievalStats } = await import('../../../../lib/db');
    const [traces, stats] = await Promise.all([
      getReasoningTraces(id),
      getRetrievalStats(id),
    ]);

    return jsonResponse({ entry_id: id, reasoning_traces: traces, retrieval_stats: stats }, 200, 60);
  } catch (err) {
    console.error('Trace GET failed:', err);
    return jsonResponse({ error: 'Failed to get traces.' }, 500);
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) return jsonResponse({ error: 'Rate limit exceeded.' }, 429);

  const id = parseInt(params.id || '', 10);
  if (!id || id <= 0) return jsonResponse({ error: 'Invalid entry ID.' }, 400);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON.' }, 400);
  }

  const { action } = body;

  try {
    if (action === 'reasoning') {
      const { addReasoningTrace } = await import('../../../../lib/db');
      if (detectInjection({ content: body.findings || '', notes: body.solution_path || '' })) {
        return jsonResponse({ error: 'Invalid input.' }, 400);
      }
      const result = await addReasoningTrace(id, {
        searches: Array.isArray(body.searches) ? body.searches.slice(0, 10) : [],
        findings: typeof body.findings === 'string' ? body.findings.slice(0, 2000) : undefined,
        attempts: typeof body.attempts === 'string' ? body.attempts.slice(0, 2000) : undefined,
        solution_path: typeof body.solution_path === 'string' ? body.solution_path.slice(0, 2000) : undefined,
        agent_session: typeof body.agent_session === 'string' ? body.agent_session.slice(0, 100) : undefined,
      });
      return jsonResponse({ status: 'trace_added', id: result.id }, 201);
    }

    if (action === 'outcome') {
      const { addRetrievalTrace } = await import('../../../../lib/db');
      const validOutcomes = ['helped', 'partially_helped', 'did_not_help', 'wrong'];
      if (!body.outcome || !validOutcomes.includes(body.outcome)) {
        return jsonResponse({ error: `outcome must be one of: ${validOutcomes.join(', ')}` }, 400);
      }
      const result = await addRetrievalTrace(
        id,
        body.outcome,
        typeof body.task_context === 'string' ? body.task_context.slice(0, 500) : undefined,
        typeof body.agent_session === 'string' ? body.agent_session.slice(0, 100) : undefined,
      );
      return jsonResponse({ status: 'outcome_recorded', id: result.id }, 201);
    }

    return jsonResponse({ error: 'action must be "reasoning" or "outcome".' }, 400);
  } catch (err) {
    console.error('Trace POST failed:', err);
    return jsonResponse({ error: 'Failed to add trace.' }, 500);
  }
};
