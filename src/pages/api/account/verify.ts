import type { APIRoute } from 'astro';
import { verifyEmail } from '../../../lib/db';
import { jsonResponse, createRateLimiter } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(20);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token || typeof token !== 'string' || token.length < 16 || token.length > 64) {
    return jsonResponse({ error: 'Invalid or missing verification token.' }, 400);
  }

  // Only allow hex characters
  if (!/^[a-f0-9]+$/i.test(token)) {
    return jsonResponse({ error: 'Invalid token format.' }, 400);
  }

  try {
    const result = await verifyEmail(token);
    if (!result) {
      return jsonResponse({ error: 'Token is invalid or expired.' }, 400);
    }

    return jsonResponse({
      username: result.username,
      message: 'Email verified successfully. Your username is now claimed.',
    }, 200);
  } catch (err) {
    console.error('Email verification failed:', err);
    return jsonResponse({ error: 'Failed to verify email.' }, 500);
  }
};
