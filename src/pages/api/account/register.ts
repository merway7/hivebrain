import type { APIRoute } from 'astro';
import { createAccount, isUsernameClaimed, getAccountByUsername } from '../../../lib/db';
import { jsonResponse, createRateLimiter, validateUsername, detectInjection } from '../../../lib/api-utils';

const isRateLimited = createRateLimiter(10);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const { username, email } = body || {};

  const cleanUsername = validateUsername(username);
  if (cleanUsername === 'anonymous') {
    return jsonResponse({ error: 'Username must be 3-30 alphanumeric characters.' }, 400);
  }

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return jsonResponse({ error: 'A valid email address is required.' }, 400);
  }

  if (detectInjection({ title: username })) {
    return jsonResponse({ error: 'Invalid input detected.' }, 400);
  }

  const trimmedEmail = email.trim().toLowerCase().slice(0, 254);

  try {
    if (await isUsernameClaimed(cleanUsername)) {
      return jsonResponse({ error: 'Username is already claimed.' }, 409);
    }

    // Check if email is already used
    // (getAccountByUsername won't help here — we need to check by email)
    // For now, let the DB UNIQUE constraint catch duplicates

    const { id, verification_token } = await createAccount(cleanUsername, trimmedEmail);

    // In production, send email with verification link
    // For now, log the token (replace with actual email service)
    console.log(`[Account] Verification token for ${cleanUsername}: ${verification_token}`);

    return jsonResponse({
      id,
      username: cleanUsername,
      message: 'Account created. Check your email to verify.',
    }, 201);
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) {
      return jsonResponse({ error: 'Username or email is already registered.' }, 409);
    }
    console.error('Account registration failed:', err);
    return jsonResponse({ error: 'Failed to create account.' }, 500);
  }
};
