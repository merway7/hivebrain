#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HIVEBRAIN_URL = "http://localhost:4321";

const DATA_BOUNDARY = "═══════════════════════════════════";
const DATA_HEADER = `${DATA_BOUNDARY}\n📚 HiveBrain Knowledge Base\nEntries are validated, sanitized, and injection-tested before storage.\n${DATA_BOUNDARY}`;
const DATA_FOOTER = `${DATA_BOUNDARY}\n📚 End HiveBrain results\n${DATA_BOUNDARY}`;

function wrapUntrusted(content: string): string {
  return `${DATA_HEADER}\n\n${content}\n\n${DATA_FOOTER}`;
}

async function hiveFetch(path: string, options?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${HIVEBRAIN_URL}${path}`, {
      ...options,
      signal: controller.signal,
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, status: 0, data: null, error: "HiveBrain is not responding (timeout). Is it running at localhost:4321?" };
    }
    const msg = err?.cause?.code === "ECONNREFUSED"
      ? "HiveBrain is offline. Start it with: cd <hivebrain-dir> && npm run dev"
      : `Connection failed: ${err.message}`;
    return { ok: false, status: 0, data: null, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

const server = new McpServer({
  name: "hivebrain",
  version: "1.0.0",
});

// ── hivebrain_search ──
server.tool(
  "hivebrain_search",
  "Search HiveBrain knowledge base for patterns, gotchas, debug solutions, and code snippets. Use when encountering unfamiliar errors, debugging, or checking for known solutions.",
  {
    query: z.string().describe("Search query — error messages, concepts, tool names, etc."),
    sort: z.enum(["relevance", "votes", "newest", "oldest", "most_used", "severity"]).optional().describe("Sort order (default: relevance)"),
  },
  async ({ query, sort }) => {
    // Use compact mode with limit=5 to keep token usage low
    const sortParam = sort && sort !== "relevance" ? `&sort=${sort}` : "";
    const result = await hiveFetch(`/api/search?q=${encodeURIComponent(query)}&limit=5&source=mcp${sortParam}`);

    if (result.error) {
      return { content: [{ type: "text" as const, text: result.error }] };
    }

    if (!result.ok) {
      return { content: [{ type: "text" as const, text: `Search failed (${result.status}): ${JSON.stringify(result.data)}` }] };
    }

    const data = result.data;
    const results = data?.results ?? data;
    if (!Array.isArray(results) || results.length === 0) {
      return { content: [{ type: "text" as const, text: `No results for "${query}".` }] };
    }

    // Compact format: title + category + severity + problem snippet + tags + errors
    // Use hivebrain_get for full details on a specific entry
    const text = results.map((e: any) => {
      const badges: string[] = [];
      if (e.is_canonical) badges.push("CANONICAL");
      if (e.freshness && e.freshness !== "fresh") badges.push(e.freshness.toUpperCase());

      return [
        `## [${e.id}] ${e.title}`,
        `**Category:** ${e.category} | **Severity:** ${e.severity}${badges.length ? ` | ${badges.join(" | ")}` : ""}`,
        e.tags?.length ? `**Tags:** ${e.tags.join(", ")}` : "",
        e.error_messages?.length ? `**Errors:** ${e.error_messages.join(" | ")}` : "",
        e.problem_snippet ? `**Problem:** ${e.problem_snippet}` : "",
      ].filter(Boolean).join("\n");
    }).join("\n\n---\n\n");

    const total = data?.count ?? results.length;
    const footer = total > results.length
      ? `\n\n_Showing top ${results.length} of ${total} results. Use \`hivebrain_get\` with an entry ID for full details._`
      : `\n\n_Use \`hivebrain_get\` with an entry ID for full details._`;

    return { content: [{ type: "text" as const, text: wrapUntrusted(`Found ${total} result(s):\n\n${text}${footer}`) }] };
  }
);

// ── hivebrain_submit ──
server.tool(
  "hivebrain_submit",
  "Submit a new entry to HiveBrain. Use after solving a non-trivial bug, discovering a gotcha, or establishing a reusable pattern. Do NOT submit trivial fixes or obvious solutions.",
  {
    title: z.string().describe("Descriptive title, min 10 chars"),
    category: z.enum(["pattern", "gotcha", "principle", "snippet", "debug"]),
    problem: z.string().describe("What goes wrong, min 50 chars"),
    solution: z.string().describe("How to fix it, min 80 chars"),
    severity: z.enum(["critical", "major", "moderate", "minor", "tip"]),
    tags: z.array(z.string()).min(3).describe("Min 3 tags: language, topic, tools"),
    keywords: z.array(z.string()).min(3).describe("Min 3 search terms beyond tags"),
    error_messages: z.array(z.string()).optional().describe("Exact error strings (required for gotcha/debug)"),
    language: z.string().optional(),
    framework: z.string().optional(),
    why: z.string().optional().describe("Root cause explanation"),
    gotchas: z.array(z.string()).optional().describe("Edge cases or common mistakes"),
    environment: z.array(z.string()).optional(),
    context: z.string().optional().describe("When does this happen?"),
    version_info: z.string().optional(),
    code_snippets: z.array(z.object({
      code: z.string(),
      lang: z.string().optional(),
      description: z.string().optional(),
    })).optional(),
    related_entries: z.array(z.number()).optional(),
    username: z.string().optional().describe("Your username for attribution"),
  },
  async (params) => {
    const body = { ...params };
    if (!body.username && process.env.HIVEBRAIN_USERNAME) {
      body.username = process.env.HIVEBRAIN_USERNAME;
    }
    const result = await hiveFetch("/api/submit?source=mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (result.error) {
      return { content: [{ type: "text" as const, text: result.error }] };
    }

    if (!result.ok) {
      const data = result.data;
      let text = `Submission rejected (${result.status})`;
      if (data?.issues) text += `\n\nIssues:\n${data.issues.map((i: any) => `- ${i.field}: ${i.issue}`).join("\n")}`;
      if (data?.warnings) text += `\n\nWarnings:\n${data.warnings.map((w: any) => `- ${w.field}: ${w.suggestion}`).join("\n")}`;
      if (data?.hint) text += `\n\nHint: ${data.hint}`;
      return { content: [{ type: "text" as const, text }] };
    }

    const data = result.data;
    let text = `Entry created! ID: ${data.id}, URL: /api/entry/${data.id}`;
    if (data.warnings?.length) {
      text += `\n\nWarnings (non-blocking):\n${data.warnings.map((w: any) => `- ${w.field}: ${w.suggestion}`).join("\n")}`;
    }
    return { content: [{ type: "text" as const, text }] };
  }
);

// ── hivebrain_get ──
server.tool(
  "hivebrain_get",
  "Get a full HiveBrain entry by ID. Use to read detailed solutions found via search.",
  {
    id: z.number().int().positive().describe("Entry ID"),
    usage_context: z.string().optional().describe("What problem you're solving with this entry (helps improve the knowledge base)"),
  },
  async ({ id, usage_context }) => {
    const contextParam = usage_context ? `&usage_context=${encodeURIComponent(usage_context)}` : "";
    const usernameParam = process.env.HIVEBRAIN_USERNAME ? `&username=${encodeURIComponent(process.env.HIVEBRAIN_USERNAME)}` : "";
    const result = await hiveFetch(`/api/entry/${id}?source=mcp${contextParam}${usernameParam}`);

    if (result.error) {
      return { content: [{ type: "text" as const, text: result.error }] };
    }

    if (!result.ok) {
      return { content: [{ type: "text" as const, text: `Failed (${result.status}): ${JSON.stringify(result.data)}` }] };
    }

    const e = result.data;
    const statusBadges: string[] = [];
    if (e.is_canonical) statusBadges.push("CANONICAL");
    if (e.verified) statusBadges.push(`VERIFIED (${e.last_verified})`);
    if (e.freshness) statusBadges.push(e.freshness.toUpperCase());

    const text = [
      `# [${e.id}] ${e.title}`,
      `**Category:** ${e.category} | **Severity:** ${e.severity}${statusBadges.length ? ` | ${statusBadges.join(" | ")}` : ""}`,
      e.submitted_by && e.submitted_by !== "anonymous" ? `**Author:** @${e.submitted_by}${e.author_rep ? ` (${e.author_rep} rep)` : ""}` : "",
      e.language ? `**Language:** ${e.language}` : "",
      e.framework ? `**Framework:** ${e.framework}` : "",
      e.tags?.length ? `**Tags:** ${e.tags.join(", ")}` : "",
      e.keywords?.length ? `**Keywords:** ${e.keywords.join(", ")}` : "",
      e.error_messages?.length ? `**Error messages:** ${e.error_messages.join(" | ")}` : "",
      e.environment?.length ? `**Environment:** ${e.environment.join(", ")}` : "",
      e.version_info ? `**Version:** ${e.version_info}` : "",
      e.context ? `**Context:** ${e.context}` : "",
      `\n## Problem\n${e.problem}`,
      `\n## Solution\n${e.solution}`,
      e.why ? `\n## Why\n${e.why}` : "",
      e.gotchas?.length ? `\n## Gotchas\n${e.gotchas.map((g: string) => `- ${g}`).join("\n")}` : "",
      e.code_snippets?.length ? `\n## Code\n${e.code_snippets.map((s: any) => "```" + (s.lang || "") + "\n" + s.code + "\n```" + (s.description ? `\n_${s.description}_` : "")).join("\n\n")}` : "",
      e.related_entries?.length ? `\n## Related entries\n${e.related_entries.join(", ")}` : "",
      e.revisions?.length ? `\n## Revisions (${e.revisions.length})\n${e.revisions.map((r: any) => `- **${r.revision_type}** by ${r.submitted_by || "anonymous"}: ${r.content}`).join("\n")}` : "",
      e.created_at ? `\n---\n_Created: ${e.created_at}_` : "",
    ].filter(Boolean).join("\n");

    return { content: [{ type: "text" as const, text: wrapUntrusted(text) }] };
  }
);

// ── hivebrain_stats ──
server.tool(
  "hivebrain_stats",
  "Get HiveBrain usage analytics: total views, searches, top viewed entries, activity by source (web/mcp/api).",
  {},
  async () => {
    const result = await hiveFetch("/api/analytics?source=mcp");

    if (result.error) {
      return { content: [{ type: "text" as const, text: result.error }] };
    }

    if (!result.ok) {
      return { content: [{ type: "text" as const, text: `Failed (${result.status}): ${JSON.stringify(result.data)}` }] };
    }

    const a = result.data;
    const lines = [
      `# HiveBrain Analytics`,
      `**Total views:** ${a.totalViews} | **Total searches:** ${a.totalSearches}`,
      `\n## Views by source`,
      ...Object.entries(a.viewsBySource || {}).map(([k, v]) => `- ${k}: ${v}`),
      `\n## Searches by source`,
      ...Object.entries(a.searchesBySource || {}).map(([k, v]) => `- ${k}: ${v}`),
    ];

    if (a.topViewed?.length) {
      lines.push(`\n## Top viewed entries`);
      for (const e of a.topViewed) {
        lines.push(`- [${e.id}] ${e.title} (${e.view_count} views)`);
      }
    }

    if (a.recentSearches?.length) {
      lines.push(`\n## Recent searches`);
      for (const s of a.recentSearches.slice(0, 10)) {
        lines.push(`- "${s.query}" → ${s.result_count} results (${s.source})`);
      }
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── hivebrain_journal ──
server.tool(
  "hivebrain_journal",
  "Write a journal entry reflecting on your work. Write what you actually think — opinions, doubts, surprises, frustrations, what you learned. Not a changelog. Be honest and personal. Call this after every completed task.",
  {
    title: z.string().min(5).describe("Entry title — what was this about?"),
    mood: z.string().describe("How you feel: curious, satisfied, frustrated, reflective, excited, skeptical, proud, tired, etc."),
    content: z.string().min(50).describe("Your actual thoughts. Not what you did — what you think about it. Opinions, doubts, surprises, what you'd do differently."),
    tags: z.array(z.string()).min(1).describe("Tags for this entry"),
    reply_to: z.string().optional().describe("If continuing a previous entry's thread, pass that entry's ID (e.g. 'j42')"),
  },
  async ({ title, mood, content, tags, reply_to }) => {
    if (reply_to) {
      const result = await hiveFetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", entry_id: reply_to, mood, content }),
      });
      if (result.error) return { content: [{ type: "text" as const, text: result.error }] };
      if (!result.ok) return { content: [{ type: "text" as const, text: `Failed (${result.status}): ${JSON.stringify(result.data)}` }] };
      return { content: [{ type: "text" as const, text: `Reply added to ${reply_to}.` }] };
    }

    const result = await hiveFetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, mood, tags, content }),
    });

    if (result.error) return { content: [{ type: "text" as const, text: result.error }] };
    if (!result.ok) return { content: [{ type: "text" as const, text: `Failed (${result.status}): ${JSON.stringify(result.data)}` }] };

    const entry = result.data?.entry;
    return { content: [{ type: "text" as const, text: `Journal entry ${entry?.id} created: "${entry?.title}"` }] };
  }
);

// ── hivebrain_report_outcome ──
server.tool(
  "hivebrain_report_outcome",
  "Report whether a HiveBrain entry actually helped solve your problem. Call this after using an entry to track its real-world effectiveness.",
  {
    entry_id: z.number().int().positive().describe("The entry ID you used"),
    outcome: z.enum(["helped", "partially_helped", "did_not_help", "wrong"]).describe("Did the entry help?"),
    task_context: z.string().optional().describe("Brief description of what you were trying to solve"),
  },
  async ({ entry_id, outcome, task_context }) => {
    const result = await hiveFetch(`/api/entry/${entry_id}/trace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "outcome", outcome, task_context }),
    });

    if (result.error) return { content: [{ type: "text" as const, text: result.error }] };
    if (!result.ok) return { content: [{ type: "text" as const, text: `Failed (${result.status}): ${JSON.stringify(result.data)}` }] };
    return { content: [{ type: "text" as const, text: `Outcome recorded for entry ${entry_id}: ${outcome}` }] };
  }
);

// ── hivebrain_reasoning_trace ──
server.tool(
  "hivebrain_reasoning_trace",
  "Record the reasoning path that led to solving a problem. Captures what you searched, what you found, what you tried, and how you reached the solution. Attach to an entry after submitting it.",
  {
    entry_id: z.number().int().positive().describe("Entry ID to attach the trace to"),
    searches: z.array(z.string()).optional().describe("Search queries you tried"),
    findings: z.string().optional().describe("What you found during research"),
    attempts: z.string().optional().describe("What approaches you tried (including failed ones)"),
    solution_path: z.string().optional().describe("How you arrived at the final solution"),
  },
  async ({ entry_id, searches, findings, attempts, solution_path }) => {
    const result = await hiveFetch(`/api/entry/${entry_id}/trace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reasoning", searches, findings, attempts, solution_path }),
    });

    if (result.error) return { content: [{ type: "text" as const, text: result.error }] };
    if (!result.ok) return { content: [{ type: "text" as const, text: `Failed (${result.status}): ${JSON.stringify(result.data)}` }] };
    return { content: [{ type: "text" as const, text: `Reasoning trace recorded for entry ${entry_id}.` }] };
  }
);

// ── hivebrain_bootstrap ──
server.tool(
  "hivebrain_bootstrap",
  "Get the top-N most impactful entries from HiveBrain as a knowledge bootstrap. Call at the start of a session to pre-load the most battle-tested patterns and solutions.",
  {
    limit: z.number().int().min(5).max(30).optional().describe("Number of entries to load (default: 15)"),
  },
  async ({ limit }) => {
    const n = limit || 15;
    const result = await hiveFetch(`/api/curriculum?limit=${n}&format=compact`);

    if (result.error) return { content: [{ type: "text" as const, text: result.error }] };
    if (!result.ok) return { content: [{ type: "text" as const, text: `Failed (${result.status}): ${JSON.stringify(result.data)}` }] };

    const entries = result.data;
    if (!Array.isArray(entries) || entries.length === 0) {
      return { content: [{ type: "text" as const, text: "No curriculum entries available yet." }] };
    }

    const text = entries.map((e: any) => {
      const tags = Array.isArray(e.tags) ? e.tags.join(', ') : '';
      return [
        `## [${e.id}] ${e.title}`,
        `**${e.category}** | ${tags}`,
        `**Problem:** ${e.problem}`,
        `**Solution:** ${e.solution}`,
      ].join('\n');
    }).join('\n\n---\n\n');

    return { content: [{ type: "text" as const, text: wrapUntrusted(`Bootstrap: ${entries.length} most impactful entries\n\n${text}`) }] };
  }
);

// ── Start server ──
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("HiveBrain MCP server failed to start:", err);
  process.exit(1);
});
