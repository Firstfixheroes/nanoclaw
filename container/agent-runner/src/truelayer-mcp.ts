/**
 * TrueLayer Open Banking MCP Server
 * READ-ONLY access to HSBC (and any future connected banks).
 * Uses stored access token, refreshes when possible.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';

const TOKEN_FILE = '/workspace/project/data/truelayer-tokens.json';
const BASE = 'https://api.truelayer.com/data/v1';

function getToken(): string {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    return data.access_token || '';
  } catch {
    return '';
  }
}

async function tlGet(path: string): Promise<unknown> {
  const token = getToken();
  if (!token) throw new Error('No TrueLayer token. AR needs to re-authorise via dashboard.');
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (resp.status === 401) throw new Error('TrueLayer token expired. AR needs to re-authorise: click "Connect HSBC" on the dashboard Banking tab.');
  if (!resp.ok) throw new Error(`TrueLayer ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

const server = new McpServer({ name: 'truelayer', version: '1.0.0' });

server.tool(
  'bank_accounts',
  'List all connected bank accounts (HSBC) with account names and types.',
  {},
  async () => {
    try {
      const data = await tlGet('/accounts') as { results?: Array<Record<string, unknown>> };
      const accounts = (data.results || []).map(a => ({
        id: a.account_id,
        name: a.display_name,
        type: a.account_type,
        currency: a.currency,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(accounts, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'bank_balances',
  'Get current balances for all connected bank accounts.',
  {},
  async () => {
    try {
      const accs = await tlGet('/accounts') as { results?: Array<Record<string, unknown>> };
      const balances = [];
      for (const a of (accs.results || [])) {
        const balData = await tlGet(`/accounts/${a.account_id}/balance`) as { results?: Array<Record<string, unknown>> };
        for (const b of (balData.results || [])) {
          balances.push({
            account: a.display_name,
            current: b.current,
            available: b.available,
            currency: b.currency,
          });
        }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(balances, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'bank_transactions',
  'Get recent transactions from connected bank accounts.',
  { days: z.number().default(30).describe('Number of days to look back'), account_name: z.string().optional().describe('Filter by account name (e.g. PREMIER BANK)') },
  async (args: { days: number; account_name?: string }) => {
    try {
      const accs = await tlGet('/accounts') as { results?: Array<Record<string, unknown>> };
      const now = new Date().toISOString();
      const from = new Date(Date.now() - args.days * 86400000).toISOString();
      const results = [];

      for (const a of (accs.results || [])) {
        if (args.account_name && !(a.display_name as string || '').includes(args.account_name)) continue;
        const txns = await tlGet(`/accounts/${a.account_id}/transactions?from=${from}&to=${now}`) as { results?: Array<Record<string, unknown>> };
        for (const t of (txns.results || []).slice(0, 30)) {
          results.push({
            account: a.display_name,
            date: (t.timestamp as string || '').slice(0, 10),
            description: t.description,
            amount: t.amount,
            type: t.transaction_type,
            category: t.transaction_category,
          });
        }
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('TrueLayer MCP error:', err);
  process.exit(1);
});
