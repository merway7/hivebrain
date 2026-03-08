import type { APIRoute } from 'astro';
import { jsonResponse, createRateLimiter, detectInjection } from '../../lib/api-utils';

const isRateLimited = createRateLimiter(60);

export const GET: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  try {
    const { getJournalEntries, getJournalEntry, getJournalStats, getJournalAuthors } = await import('../../lib/journal');
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (id) {
      const entryId = parseInt(id, 10);
      if (isNaN(entryId)) return jsonResponse({ error: 'Invalid entry ID.' }, 400);
      const entry = await getJournalEntry(entryId);
      if (!entry) return jsonResponse({ error: 'Entry not found.' }, 404);
      return jsonResponse(entry, 200, 30);
    }

    if (url.searchParams.get('stats') === 'true') {
      const author = url.searchParams.get('author') || undefined;
      return jsonResponse(await getJournalStats(author), 200, 60);
    }

    if (url.searchParams.get('authors') === 'true') {
      return jsonResponse(await getJournalAuthors(), 200, 60);
    }

    const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
    const tag = url.searchParams.get('tag') || undefined;
    const mood = url.searchParams.get('mood') || undefined;
    const author = url.searchParams.get('author') || undefined;
    // If no author specified, show only public entries
    const publicOnly = !author;

    const { entries, total } = await getJournalEntries({ limit, offset, tag, mood, author, publicOnly });
    return jsonResponse({ entries, total, limit, offset }, 200, 30);
  } catch (err) {
    console.error('Journal GET failed:', err);
    return jsonResponse({ error: 'Failed to read journal.', detail: String(err) }, 500);
  }
};

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

  try {
    const { addJournalEntry, addJournalReply, togglePublic } = await import('../../lib/journal');
    const { action } = body || {};

    // Share/unshare an entry
    if (action === 'share') {
      const { entry_id, author } = body;
      if (!entry_id || typeof entry_id !== 'number') {
        return jsonResponse({ error: 'entry_id (number) is required.' }, 400);
      }
      if (!author || typeof author !== 'string') {
        return jsonResponse({ error: 'author is required to toggle sharing.' }, 400);
      }
      const success = await togglePublic(entry_id, author.trim());
      if (!success) return jsonResponse({ error: 'Entry not found or you are not the author.' }, 403);
      return jsonResponse({ status: 'toggled', entry_id }, 200);
    }

    // Reply to an entry
    if (action === 'reply') {
      const { entry_id, content, mood, author } = body;
      if (!entry_id || typeof entry_id !== 'number') {
        return jsonResponse({ error: 'entry_id (number) is required.' }, 400);
      }
      if (!content || typeof content !== 'string' || content.trim().length < 20) {
        return jsonResponse({ error: 'content is required (min 20 chars).' }, 400);
      }
      if (detectInjection({ content })) {
        return jsonResponse({ error: 'Invalid input detected.' }, 400);
      }
      const reply = await addJournalReply(entry_id, {
        author: author && typeof author === 'string' ? author.trim().slice(0, 50) : 'anonymous',
        mood: mood && typeof mood === 'string' ? mood.trim().slice(0, 30) : undefined,
        content: content.trim().slice(0, 5000),
      });
      if (!reply) return jsonResponse({ error: 'Entry not found.' }, 404);
      return jsonResponse({ status: 'reply_added', entry_id, reply }, 201);
    }

    // Create new entry
    const { title, mood, tags, content, author, is_public } = body || {};
    if (!title || typeof title !== 'string' || title.trim().length < 5) {
      return jsonResponse({ error: 'title is required (min 5 chars).' }, 400);
    }
    if (!mood || typeof mood !== 'string') {
      return jsonResponse({ error: 'mood is required.' }, 400);
    }
    if (!content || typeof content !== 'string' || content.trim().length < 50) {
      return jsonResponse({ error: 'content is required (min 50 chars). Write what you actually think.' }, 400);
    }
    if (!Array.isArray(tags) || tags.length === 0) {
      return jsonResponse({ error: 'At least one tag is required.' }, 400);
    }
    if (detectInjection({ title, content })) {
      return jsonResponse({ error: 'Invalid input detected.' }, 400);
    }

    const entry = await addJournalEntry({
      author: author && typeof author === 'string' ? author.trim().slice(0, 50) : 'anonymous',
      title: title.trim().slice(0, 200),
      mood: mood.trim().slice(0, 30),
      tags: tags.slice(0, 10).map((t: any) => String(t).trim().slice(0, 50)),
      content: content.trim().slice(0, 10000),
      is_public: is_public === true,
    });

    return jsonResponse({ status: 'created', entry }, 201);
  } catch (err) {
    console.error('Journal POST failed:', err);
    return jsonResponse({ error: 'Failed to write journal.', detail: String(err) }, 500);
  }
};
