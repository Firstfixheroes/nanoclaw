/**
 * Wise MCP Server — READ-ONLY access to FFH's Wise business account.
 * Never moves money. Only reads balances, transactions, and statements.
 *
 * Profile: First Fix Heroes Ltd (ID: 28735690)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_TOKEN = process.env.WISE_API_TOKEN || '';
const PROFILE_ID = process.env.WISE_PROFILE_ID || '28735690';
const BASE_URL = 'https://api.transferwise.com';

const HEADERS = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type': 'application/json',
};

async function wiseGet(path: string): Promise<unknown> {
  const resp = await fetch(`${BASE_URL}${path}`, { headers: HEADERS });
  if (!resp.ok) throw new Error(`Wise ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

const server = new McpServer({ name: 'wise', version: '1.0.0' });

// ===== BALANCES =====

server.tool(
  'wise_balances',
  'Get current Wise account balances across all currencies. Shows how much cash FFH has in Wise right now.',
  {},
  async () => {
    try {
      const balances = await wiseGet(`/v4/profiles/${PROFILE_ID}/balances?types=STANDARD`) as Array<Record<string, unknown>>;
      const summary = balances.map(b => {
        const amt = b.amount as Record<string, unknown>;
        return {
          currency: amt.currency,
          balance: amt.value,
          id: b.id,
        };
      }).filter(b => (b.balance as number) > 0 || b.currency === 'GBP');
      const gbpTotal = summary.filter(b => b.currency === 'GBP').reduce((s, b) => s + (b.balance as number), 0);
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        accounts: summary,
        total_gbp: `£${gbpTotal.toFixed(2)}`,
        profile: 'First Fix Heroes Ltd',
      }, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== RECENT TRANSACTIONS =====

server.tool(
  'wise_transactions',
  'Get recent transactions from Wise. Shows money in and out with details.',
  {
    currency: z.string().default('GBP').describe('Currency to query (GBP, EUR, USD)'),
    limit: z.number().default(20).describe('Number of transactions'),
  },
  async (args: { currency: string; limit: number }) => {
    try {
      // Get balance ID for this currency
      const balances = await wiseGet(`/v4/profiles/${PROFILE_ID}/balances?types=STANDARD`) as Array<Record<string, unknown>>;
      const balance = balances.find(b => (b.amount as Record<string, unknown>).currency === args.currency);
      if (!balance) return { content: [{ type: 'text' as const, text: `No ${args.currency} account found` }] };

      const balanceId = balance.id;
      const now = new Date().toISOString();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const statement = await wiseGet(
        `/v1/profiles/${PROFILE_ID}/balance-statements/${balanceId}/statement?intervalStart=${thirtyDaysAgo}&intervalEnd=${now}&type=COMPACT`
      ) as Record<string, unknown>;

      const transactions = (statement.transactions as Array<Record<string, unknown>> || []).slice(0, args.limit);
      const summary = transactions.map(t => {
        const amt = t.amount as Record<string, unknown>;
        const runBal = t.runningBalance as Record<string, unknown>;
        return {
          date: t.date,
          type: t.type,
          description: (t.details as Record<string, unknown>)?.description || (t.details as Record<string, unknown>)?.senderName || '',
          amount: `${amt.currency} ${(amt.value as number) >= 0 ? '+' : ''}${(amt.value as number).toFixed(2)}`,
          running_balance: `${(runBal.value as number).toFixed(2)}`,
          reference: (t.referenceNumber as string) || '',
        };
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== STATEMENT SUMMARY =====

server.tool(
  'wise_statement',
  'Get a statement summary for a period — total in, total out, opening/closing balance.',
  {
    days: z.number().default(30).describe('Number of days to look back'),
    currency: z.string().default('GBP'),
  },
  async (args: { days: number; currency: string }) => {
    try {
      const balances = await wiseGet(`/v4/profiles/${PROFILE_ID}/balances?types=STANDARD`) as Array<Record<string, unknown>>;
      const balance = balances.find(b => (b.amount as Record<string, unknown>).currency === args.currency);
      if (!balance) return { content: [{ type: 'text' as const, text: `No ${args.currency} account found` }] };

      const balanceId = balance.id;
      const now = new Date().toISOString();
      const start = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();

      const statement = await wiseGet(
        `/v1/profiles/${PROFILE_ID}/balance-statements/${balanceId}/statement?intervalStart=${start}&intervalEnd=${now}&type=COMPACT`
      ) as Record<string, unknown>;

      const transactions = statement.transactions as Array<Record<string, unknown>> || [];
      let totalIn = 0, totalOut = 0;
      const byCategory: Record<string, number> = {};

      for (const t of transactions) {
        const amt = (t.amount as Record<string, unknown>).value as number;
        if (amt > 0) totalIn += amt;
        else totalOut += Math.abs(amt);

        const desc = ((t.details as Record<string, unknown>)?.description as string || 'Other').slice(0, 30);
        byCategory[desc] = (byCategory[desc] || 0) + amt;
      }

      // Sort categories by absolute value
      const topCategories = Object.entries(byCategory)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 10)
        .map(([desc, amt]) => ({ description: desc, amount: `£${amt.toFixed(2)}` }));

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        period: `Last ${args.days} days`,
        currency: args.currency,
        total_in: `£${totalIn.toFixed(2)}`,
        total_out: `£${totalOut.toFixed(2)}`,
        net: `£${(totalIn - totalOut).toFixed(2)}`,
        transaction_count: transactions.length,
        top_items: topCategories,
        opening_balance: statement.startOfStatementBalance,
        closing_balance: statement.endOfStatementBalance,
      }, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== RECIPIENTS =====

server.tool(
  'wise_recipients',
  'List saved recipients/payees in Wise. Read only — for reference.',
  { limit: z.number().default(10) },
  async (args: { limit: number }) => {
    try {
      const recipients = await wiseGet(`/v1/accounts?profile=${PROFILE_ID}`) as Array<Record<string, unknown>>;
      const summary = recipients.slice(0, args.limit).map(r => ({
        name: (r.accountHolderName as string) || (r.details as Record<string, unknown>)?.accountHolderName || 'Unknown',
        currency: r.currency,
        type: r.type,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== EXCHANGE RATES =====

server.tool(
  'wise_rates',
  'Get live Wise exchange rates. Useful for quoting international jobs or Hiba/Morocco payments.',
  { source: z.string().default('GBP'), target: z.string().default('MAD') },
  async (args: { source: string; target: string }) => {
    try {
      const rates = await wiseGet(`/v1/rates?source=${args.source}&target=${args.target}`) as Array<Record<string, unknown>>;
      if (rates.length > 0) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          from: args.source,
          to: args.target,
          rate: rates[0].rate,
          time: rates[0].time,
        }, null, 2) }] };
      }
      return { content: [{ type: 'text' as const, text: 'No rate found' }] };
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
  console.error('Wise MCP error:', err);
  process.exit(1);
});
