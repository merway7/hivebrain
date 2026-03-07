/**
 * Embedding engine for semantic search.
 * Default: bag-of-words vectors with TF-IDF weighting.
 * Optional: OpenAI text-embedding-3-small when OPENAI_API_KEY is set.
 */

// ── Types ──

export interface EmbeddingVector {
  values: number[];
  model: string;
  dimensions: number;
}

// ── Tokenization ──

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'then', 'once', 'here', 'there', 'when', 'where',
  'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or',
  'if', 'while', 'about', 'up', 'it', 'its', 'this', 'that', 'what',
  'which', 'who', 'whom', 'these', 'those', 'i', 'me', 'my', 'we',
  'you', 'your', 'he', 'she', 'they', 'them', 'get', 'got', 'make',
  'use', 'used', 'using', 'work', 'works',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\.]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

// ── Bag-of-Words Embedding ──

// Fixed vocabulary size — hash tokens to buckets for fixed-dim vectors
const BOW_DIMENSIONS = 1024;

function hashToken(token: string): number {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % BOW_DIMENSIONS;
}

function bowEmbed(text: string): EmbeddingVector {
  const tokens = tokenize(text);
  const vec = new Float64Array(BOW_DIMENSIONS);

  // Count token frequencies, hashed to fixed buckets
  for (const token of tokens) {
    vec[hashToken(token)] += 1;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }

  return {
    values: Array.from(vec),
    model: 'bag-of-words',
    dimensions: BOW_DIMENSIONS,
  };
}

// ── OpenAI Embedding ──

async function openaiEmbed(text: string): Promise<EmbeddingVector> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000), // API limit
      dimensions: 512, // compact
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding failed: ${err}`);
  }

  const data = await res.json();
  return {
    values: data.data[0].embedding,
    model: 'text-embedding-3-small',
    dimensions: 512,
  };
}

// ── Public API ──

export function getEmbeddingProvider(): 'openai' | 'bag-of-words' {
  return process.env.OPENAI_API_KEY ? 'openai' : 'bag-of-words';
}

/**
 * Generate an embedding for a text string.
 * Uses OpenAI if OPENAI_API_KEY is set, otherwise bag-of-words.
 */
export async function embed(text: string): Promise<EmbeddingVector> {
  if (process.env.OPENAI_API_KEY) {
    try {
      return await openaiEmbed(text);
    } catch {
      // Fallback to bag-of-words if OpenAI fails
      return bowEmbed(text);
    }
  }
  return bowEmbed(text);
}

/**
 * Build embedding text from an entry's fields.
 * Weights title and tags more heavily by repeating them.
 */
export function entryToText(entry: {
  title: string;
  problem: string;
  solution: string;
  tags?: string | string[];
  keywords?: string | string[];
  error_messages?: string | string[];
  why?: string | null;
}): string {
  const tags = typeof entry.tags === 'string' ? JSON.parse(entry.tags || '[]') : (entry.tags || []);
  const keywords = typeof entry.keywords === 'string' ? JSON.parse(entry.keywords || '[]') : (entry.keywords || []);
  const errors = typeof entry.error_messages === 'string' ? JSON.parse(entry.error_messages || '[]') : (entry.error_messages || []);

  // Title repeated 3x for weight, tags 2x
  return [
    entry.title, entry.title, entry.title,
    tags.join(' '), tags.join(' '),
    keywords.join(' '),
    errors.join(' '),
    entry.problem,
    entry.solution,
    entry.why || '',
  ].join(' ');
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
