import type { APIRoute } from 'astro';
import { getEntry, addVerification, updateQualityStatus } from '../../../../lib/db';
import { jsonResponse, requestId, validateUsername, createRateLimiter, detectInjection } from '../../../../lib/api-utils';

const isRateLimited = createRateLimiter(20);

function truncateField(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLen) : undefined;
}

export const POST: APIRoute = async ({ params, request }) => {
  const reqId = requestId();
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

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

  const { username, version_tested, environment, notes } = body || {};
  const verifiedBy = validateUsername(username);
  if (verifiedBy === 'anonymous') {
    return jsonResponse({ error: 'A username is required to verify entries.' }, 400);
  }

  // Check for injection in text fields
  if (detectInjection({ version_tested, environment, notes })) {
    return jsonResponse({ error: 'Invalid input detected.' }, 400);
  }

  try {
    const entry = await getEntry(id);
    if (!entry) {
      return jsonResponse({ error: `Entry ${id} not found.` }, 404);
    }

    const { id: verificationId } = await addVerification(
      id,
      verifiedBy,
      truncateField(version_tested, 200),
      truncateField(environment, 200),
      truncateField(notes, 2000),
    );

    // Update quality_status to verified if not already
    if (entry.quality_status !== 'verified') {
      await updateQualityStatus(id, 'verified');
    }

    return jsonResponse({
      id: verificationId,
      entry_id: id,
      verified_by: verifiedBy,
      version_tested: version_tested || null,
      status: 'verified',
    }, 201);
  } catch (err) {
    console.error(`[${reqId}] Failed to verify entry:`, err);
    return jsonResponse({ error: 'Failed to verify entry.', request_id: reqId }, 500);
  }
};
