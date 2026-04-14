/**
 * Crypto.com Exchange MCP Server
 * Read-only market data + trading via Crypto.com Exchange API.
 *
 * RULES:
 * - Shariah compliance: no margin, no shorts, no futures, no lending/staking with interest
 * - Only spot trading (buy/sell actual crypto, no derivatives)
 * - Risk Monitor must approve before Executioner places orders
 * - All crypto must pass shariah screening (no casino tokens, no interest-bearing DeFi)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import crypto from 'crypto';

const API_KEY = process.env.CRYPTOCOM_API_KEY || '';
const API_SECRET = process.env.CRYPTOCOM_API_SECRET || '';
const BASE_URL = 'https://api.crypto.com/exchange/v1';

function sign(method: string, id: number, params: Record<string, unknown> = {}): string {
  const paramString = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  const sigPayload = `${method}${id}${API_KEY}${paramString}${id}`;
  return crypto.createHmac('sha256', API_SECRET).update(sigPayload).digest('hex');
}

async function publicGet(path: string): Promise<unknown> {
  const resp = await fetch(`${BASE_URL}/public/${path}`, { headers: { 'Content-Type': 'application/json' } });
  if (!resp.ok) throw new Error(`Crypto.com ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function privatePost(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const id = Date.now();
  const sig = sign(method, id, params);
  const body = { id, method, api_key: API_KEY, params, sig, nonce: id };
  const resp = await fetch(BASE_URL + '/private/' + method.replace('private/', ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Crypto.com ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { result?: unknown; code?: number; message?: string };
  if (data.code && data.code !== 0) throw new Error(`Crypto.com error ${data.code}: ${data.message}`);
  return data.result;
}

const server = new McpServer({ name: 'crypto_com', version: '1.0.0' });

// ===== PUBLIC MARKET DATA =====

server.tool(
  'crypto_ticker',
  'Get current price and 24h stats for a crypto pair (e.g. BTC_USDT, ETH_USDT).',
  { pair: z.string().describe('Trading pair (e.g. BTC_USDT, ETH_USDT, SOL_USDT)') },
  async (args: { pair: string }) => {
    try {
      const data = await publicGet(`get-ticker?instrument_name=${args.pair}`) as { result?: { data?: Array<Record<string, unknown>> } };
      const ticker = data.result?.data?.[0];
      if (!ticker) return { content: [{ type: 'text' as const, text: `No data for ${args.pair}` }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        pair: ticker.i,
        last_price: ticker.a,
        bid: ticker.b,
        ask: ticker.k,
        high_24h: ticker.h,
        low_24h: ticker.l,
        volume_24h: ticker.v,
        change_24h: ticker.c,
      }, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'crypto_instruments',
  'List available trading pairs on Crypto.com Exchange.',
  {},
  async () => {
    try {
      const data = await publicGet('get-instruments') as { result?: { data?: Array<Record<string, unknown>> } };
      const instruments = (data.result?.data || [])
        .filter((i: Record<string, unknown>) => i.inst_type === 'SPOT')
        .slice(0, 50)
        .map((i: Record<string, unknown>) => ({ pair: i.symbol, base: i.base_ccy, quote: i.quote_ccy }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(instruments, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'crypto_candles',
  'Get price candles (OHLCV) for a trading pair.',
  {
    pair: z.string().describe('Trading pair (e.g. BTC_USDT)'),
    timeframe: z.string().default('1D').describe('Candle period: 1m, 5m, 15m, 1h, 4h, 1D, 1W, 1M'),
    count: z.number().default(10).describe('Number of candles'),
  },
  async (args: { pair: string; timeframe: string; count: number }) => {
    try {
      const data = await publicGet(`get-candlestick?instrument_name=${args.pair}&timeframe=${args.timeframe}&count=${args.count}`) as { result?: { data?: Array<Record<string, unknown>> } };
      const candles = (data.result?.data || []).map((c: Record<string, unknown>) => ({
        time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(candles, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== PRIVATE (AUTHENTICATED) =====

server.tool(
  'crypto_balance',
  'Get your Crypto.com Exchange wallet balances.',
  {},
  async () => {
    try {
      const result = await privatePost('private/get-account-summary') as { data?: Array<Record<string, unknown>> };
      const balances = (result.data || [])
        .filter((b: Record<string, unknown>) => parseFloat(b.available as string || '0') > 0)
        .map((b: Record<string, unknown>) => ({
          currency: b.currency,
          available: b.available,
          order: b.order,
          total: b.balance,
        }));
      return { content: [{ type: 'text' as const, text: balances.length ? JSON.stringify(balances, null, 2) : 'No balances found' }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'crypto_open_orders',
  'Get your open orders on Crypto.com Exchange.',
  { pair: z.string().optional().describe('Filter by pair (optional)') },
  async (args: { pair?: string }) => {
    try {
      const params: Record<string, unknown> = {};
      if (args.pair) params.instrument_name = args.pair;
      const result = await privatePost('private/get-open-orders', params) as { data?: Array<Record<string, unknown>> };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data || [], null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'crypto_order_history',
  'Get recent filled/cancelled orders.',
  { pair: z.string().optional(), limit: z.number().default(10) },
  async (args: { pair?: string; limit: number }) => {
    try {
      const params: Record<string, unknown> = { page_size: args.limit };
      if (args.pair) params.instrument_name = args.pair;
      const result = await privatePost('private/get-order-history', params) as { data?: Array<Record<string, unknown>> };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data || [], null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'crypto_place_order',
  'Place a SPOT buy or sell order on Crypto.com. No margin, no shorts, no derivatives. Must be approved by Risk Monitor first.',
  {
    pair: z.string().describe('Trading pair (e.g. BTC_USDT)'),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
    quantity: z.number().describe('Amount of base currency'),
    price: z.number().optional().describe('Limit price (required for LIMIT orders)'),
  },
  async (args: { pair: string; side: string; type: string; quantity: number; price?: number }) => {
    try {
      const params: Record<string, unknown> = {
        instrument_name: args.pair,
        side: args.side,
        type: args.type,
        quantity: args.quantity.toString(),
      };
      if (args.type === 'LIMIT' && args.price) {
        params.price = args.price.toString();
      }
      const result = await privatePost('private/create-order', params) as Record<string, unknown>;
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        order_id: result.order_id,
        pair: args.pair,
        side: args.side,
        type: args.type,
        quantity: args.quantity,
        price: args.price,
        message: `Order placed: ${args.side} ${args.quantity} ${args.pair.split('_')[0]} @ ${args.price || 'market'}`,
      }, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Order failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'crypto_cancel_order',
  'Cancel an open order.',
  { pair: z.string(), order_id: z.string() },
  async (args: { pair: string; order_id: string }) => {
    try {
      await privatePost('private/cancel-order', { instrument_name: args.pair, order_id: args.order_id });
      return { content: [{ type: 'text' as const, text: `Order ${args.order_id} cancelled.` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Cancel failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('Crypto.com MCP error:', err);
  process.exit(1);
});
