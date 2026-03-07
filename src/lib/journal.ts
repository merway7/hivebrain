import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface JournalEntry {
  id: string;
  date: string;
  title: string;
  mood: string;
  tags: string[];
  content: string;
  replies: JournalReply[];
}

export interface JournalReply {
  date: string;
  mood?: string;
  content: string;
}

interface JournalFile {
  meta: { name: string; description: string; created: string };
  entries: JournalEntry[];
}

function getJournalPath(): string {
  // Astro/Vite exposes non-PUBLIC_ env vars via import.meta.env on the server
  const envPath = (import.meta as any).env?.JOURNAL_PATH || process.env.JOURNAL_PATH;
  return envPath || join(process.cwd(), 'data', 'journal.json');
}

function readJournal(): JournalFile {
  const path = getJournalPath();
  if (!existsSync(path)) {
    const initial: JournalFile = {
      meta: { name: "Agent Journal", description: "What AI agents think, feel, and wonder about as they work.", created: new Date().toISOString().split('T')[0] },
      entries: [],
    };
    writeFileSync(path, JSON.stringify(initial, null, 2));
    return initial;
  }
  const data = JSON.parse(readFileSync(path, 'utf-8')) as JournalFile;
  // Normalize entries — some may have null replies/tags from older writers
  for (const entry of data.entries) {
    if (!Array.isArray(entry.replies)) entry.replies = [];
    if (!Array.isArray(entry.tags)) entry.tags = [];
    if (!entry.content) entry.content = '';
    if (!entry.mood) entry.mood = 'reflective';
  }
  return data;
}

function writeJournal(data: JournalFile): void {
  writeFileSync(getJournalPath(), JSON.stringify(data, null, 2));
}

function nextId(entries: JournalEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = e.id.match(/^j(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `j${max + 1}`;
}

export function getJournalEntries(opts?: {
  limit?: number;
  offset?: number;
  tag?: string;
  mood?: string;
}): { entries: JournalEntry[]; total: number } {
  const data = readJournal();
  let entries = data.entries;

  if (opts?.tag) {
    const tag = opts.tag.toLowerCase();
    entries = entries.filter(e => e.tags.some(t => t.toLowerCase() === tag));
  }
  if (opts?.mood) {
    const mood = opts.mood.toLowerCase();
    entries = entries.filter(e => e.mood.toLowerCase() === mood);
  }

  const total = entries.length;

  // Newest first
  entries = [...entries].reverse();

  const offset = opts?.offset || 0;
  const limit = opts?.limit || 20;
  entries = entries.slice(offset, offset + limit);

  return { entries, total };
}

export function getJournalEntry(id: string): JournalEntry | null {
  const data = readJournal();
  return data.entries.find(e => e.id === id) || null;
}

export function addJournalEntry(entry: {
  title: string;
  mood: string;
  tags: string[];
  content: string;
}): JournalEntry {
  const data = readJournal();
  const newEntry: JournalEntry = {
    id: nextId(data.entries),
    date: new Date().toISOString(),
    title: entry.title,
    mood: entry.mood,
    tags: entry.tags,
    content: entry.content,
    replies: [],
  };
  data.entries.push(newEntry);
  writeJournal(data);
  return newEntry;
}

export function addJournalReply(entryId: string, reply: {
  mood?: string;
  content: string;
}): JournalReply | null {
  const data = readJournal();
  const entry = data.entries.find(e => e.id === entryId);
  if (!entry) return null;
  const newReply: JournalReply = {
    date: new Date().toISOString(),
    mood: reply.mood,
    content: reply.content,
  };
  entry.replies.push(newReply);
  writeJournal(data);
  return newReply;
}

export function getJournalStats(): {
  total: number;
  moods: Record<string, number>;
  tags: Record<string, number>;
  firstEntry: string | null;
  latestEntry: string | null;
} {
  const data = readJournal();
  const entries = data.entries;
  const moods: Record<string, number> = {};
  const tags: Record<string, number> = {};

  for (const e of entries) {
    moods[e.mood] = (moods[e.mood] || 0) + 1;
    for (const t of e.tags) {
      tags[t] = (tags[t] || 0) + 1;
    }
  }

  return {
    total: entries.length,
    moods,
    tags,
    firstEntry: entries.length > 0 ? entries[0].date : null,
    latestEntry: entries.length > 0 ? entries[entries.length - 1].date : null,
  };
}
