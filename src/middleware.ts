import { defineMiddleware } from 'astro:middleware';
import { initDb } from './lib/db';

let initialized = false;

export const onRequest = defineMiddleware(async (context, next) => {
  if (!initialized) {
    try {
      await initDb();
    } catch (e) {
      console.error('initDb failed:', e);
    }
    initialized = true;
  }
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'");
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
});
