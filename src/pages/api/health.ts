import type { APIRoute } from 'astro';
import { getEntriesCount, getMode } from '../../lib/db';

export const GET: APIRoute = async () => {
  try {
    const entries = await getEntriesCount();
    return new Response(JSON.stringify({
      status: 'ok',
      version: '2.1.0',
      mode: getMode(),
      entries,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      status: 'error',
      message: err.message,
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
