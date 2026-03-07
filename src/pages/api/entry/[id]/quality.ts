import type { APIRoute } from 'astro';
import { updateQualityStatus, getEntry, addRepEvent } from '../../../../lib/db';
import { jsonResponse, requestId } from '../../../../lib/api-utils';

const VALID_STATUSES = ['verified', 'outdated', 'disputed'] as const;

export const POST: APIRoute = async ({ params, request }) => {
  const reqId = requestId();
  const id = parseInt(params.id || '', 10);
  if (isNaN(id) || id < 1) {
    return jsonResponse({ error: 'Invalid entry ID.' }, 400);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const { status } = body || {};
  if (!status || !VALID_STATUSES.includes(status)) {
    return jsonResponse({
      error: `status is required. One of: ${VALID_STATUSES.join(', ')}`,
    }, 400);
  }

  try {
    const entry = await getEntry(id);
    if (!entry) {
      return jsonResponse({ error: `Entry ${id} not found.` }, 404);
    }

    await updateQualityStatus(id, status);

    // Reputation penalty for entry author if marked outdated
    if (status === 'outdated') {
      addRepEvent(entry.submitted_by, 'entry_outdated', id).catch(e => console.warn('Rep event failed:', e));
    }

    return jsonResponse({ id, status, previous: entry.quality_status }, 200);
  } catch (err) {
    console.error(`[${reqId}] Failed to update quality status for entry ${id}:`, err);
    return jsonResponse({ error: 'Failed to update quality status.', request_id: reqId }, 500);
  }
};
