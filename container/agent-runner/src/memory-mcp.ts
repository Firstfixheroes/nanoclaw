/**
 * Memory MCP Server — connects to OpenViking + Mem0 for long-term memory.
 *
 * Tools:
 *   memory_recall  — semantic search across all stored memories and resources
 *   memory_store   — persist a fact/memory explicitly
 *   memory_forget  — delete a memory by URI
 *   memory_health  — check OpenViking server status
 *
 * The host (NanoClaw) runs OpenViking on port 1933 and Mem0 writes to a local SQLite.
 * Inside the container, the host is reachable at host.docker.internal.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const OV_BASE = process.env.OPENVIKING_URL || 'http://host.docker.internal:1933';
const ACCOUNT = process.env.OPENVIKING_ACCOUNT || 'ar';
const USER = process.env.OPENVIKING_USER || 'ar';
const AGENT = process.env.OPENVIKING_AGENT || 'claw';

const HEADERS = {
  'Content-Type': 'application/json',
  'X-OpenViking-Account': ACCOUNT,
  'X-OpenViking-User': USER,
  'X-OpenViking-Agent': AGENT,
};

async function ovFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const url = `${OV_BASE}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers as Record<string, string> || {}) },
  });
  return resp.json();
}

const server = new McpServer({
  name: 'memory',
  version: '1.0.0',
});

server.tool(
  'memory_recall',
  'Search long-term memory for information relevant to a query. Returns facts, preferences, past decisions, and context about AR and his businesses. Use this when you need to remember something from past conversations or check stored knowledge.',
  {
    query: z.string().describe('Natural language search query (e.g. "what are AR\'s core values", "Hexagon tender details", "Hiba launch timeline")'),
    limit: z.number().default(6).describe('Max results to return'),
  },
  async (args: { query: string; limit: number }) => {
    try {
      const result = await ovFetch('/api/v1/search/find', {
        method: 'POST',
        body: JSON.stringify({ query: args.query, limit: args.limit }),
      }) as { status: string; result?: { memories?: Array<{ uri: string; content?: string; abstract?: string }>; resources?: Array<{ uri: string; score: number }> } };

      if (result.status !== 'ok' || !result.result) {
        return { content: [{ type: 'text' as const, text: 'No memories found.' }] };
      }

      const items: string[] = [];

      // Read content for top resource matches
      for (const res of (result.result.resources || []).slice(0, args.limit)) {
        try {
          const content = await ovFetch(`/api/v1/content/read?uri=${encodeURIComponent(res.uri)}`) as { status: string; result?: string };
          if (content.status === 'ok' && content.result) {
            items.push(`[${res.uri}] (score: ${res.score.toFixed(2)})\n${content.result}`);
          }
        } catch {
          items.push(`[${res.uri}] (score: ${res.score.toFixed(2)}) — content unavailable`);
        }
      }

      // Include direct memories
      for (const mem of (result.result.memories || []).slice(0, args.limit)) {
        items.push(`[memory] ${mem.content || mem.abstract || mem.uri}`);
      }

      if (items.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No relevant memories found for this query.' }] };
      }

      return { content: [{ type: 'text' as const, text: items.join('\n\n---\n\n') }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Memory recall failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'memory_store',
  'Store a fact, preference, or important information in long-term memory so it persists across sessions. Use this when AR tells you something important about himself, his businesses, preferences, or decisions that should be remembered permanently.',
  {
    content: z.string().describe('The fact or memory to store (e.g. "AR prefers conservative position sizing under 5% per trade", "Hiba launch target is Q2 2026")'),
    category: z.enum(['user', 'business', 'preference', 'decision', 'feedback']).default('user').describe('Category of memory'),
  },
  async (args: { content: string; category: string }) => {
    try {
      // Create a session, add message, extract memories
      const sessionId = `mem-${Date.now()}`;
      await ovFetch('/api/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
      });

      await ovFetch(`/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          role: 'user',
          content: `[${args.category}] ${args.content}`,
        }),
      });

      await ovFetch(`/api/v1/sessions/${sessionId}/extract`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      return { content: [{ type: 'text' as const, text: `Stored in long-term memory: "${args.content.slice(0, 100)}..."` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Memory store failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'memory_forget',
  'Delete a specific memory by its URI. Use when AR asks you to forget something or when information is outdated.',
  {
    uri: z.string().describe('The viking:// URI of the memory to delete'),
  },
  async (args: { uri: string }) => {
    try {
      await ovFetch(`/api/v1/fs?uri=${encodeURIComponent(args.uri)}`, { method: 'DELETE' });
      return { content: [{ type: 'text' as const, text: `Deleted: ${args.uri}` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Memory forget failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'memory_health',
  'Check the status of the memory server.',
  {},
  async () => {
    try {
      const health = await ovFetch('/health') as { status: string; healthy: boolean; version: string };
      return { content: [{ type: 'text' as const, text: `Memory server: ${health.status} (v${health.version}, healthy: ${health.healthy})` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Memory server unreachable: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('Memory MCP server error:', err);
  process.exit(1);
});
