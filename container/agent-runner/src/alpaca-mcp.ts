/**
 * Alpaca Trading MCP Server
 * Paper trading via Alpaca Markets API.
 * Supports: account info, positions, orders, market data, trade execution.
 *
 * RULES:
 * - This is PAPER TRADING (simulated). No real money moves.
 * - All trades must go through Risk Monitor approval first.
 * - Executioner agent is the only one that should place orders.
 * - Trading Strategist reads positions/market data but does NOT trade.
 * - All trades are shariah-compliant (no interest, no shorts, no leverage, no derivatives).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_KEY = process.env.ALPACA_API_KEY || '';
const API_SECRET = process.env.ALPACA_API_SECRET || '';
const BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets/v2';
const DATA_URL = 'https://data.alpaca.markets/v2';

const HEADERS = {
  'APCA-API-KEY-ID': API_KEY,
  'APCA-API-SECRET-KEY': API_SECRET,
  'Content-Type': 'application/json',
};

async function alpacaGet(path: string, dataApi = false): Promise<unknown> {
  const base = dataApi ? DATA_URL : BASE_URL;
  const resp = await fetch(`${base}${path}`, { headers: HEADERS });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Alpaca ${resp.status}: ${body}`);
  }
  return resp.json();
}

async function alpacaPost(path: string, body: unknown): Promise<unknown> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Alpaca ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function alpacaDelete(path: string): Promise<unknown> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Alpaca ${resp.status}: ${text}`);
  }
  if (resp.status === 204) return { status: 'deleted' };
  return resp.json();
}

const server = new McpServer({ name: 'alpaca', version: '1.0.0' });

// ===== ACCOUNT =====

server.tool(
  'account',
  'Get Alpaca paper trading account info: buying power, portfolio value, cash, equity. Use for portfolio overview.',
  {},
  async () => {
    try {
      const acc = await alpacaGet('/account') as Record<string, unknown>;
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        status: acc.status,
        buying_power: acc.buying_power,
        portfolio_value: acc.portfolio_value,
        cash: acc.cash,
        equity: acc.equity,
        long_market_value: acc.long_market_value,
        currency: acc.currency,
        pattern_day_trader: acc.pattern_day_trader,
      }, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== POSITIONS =====

server.tool(
  'positions',
  'Get all open positions with current P&L, market value, and quantity.',
  {},
  async () => {
    try {
      const positions = await alpacaGet('/positions') as Array<Record<string, unknown>>;
      const summary = positions.map(p => ({
        symbol: p.symbol,
        qty: p.qty,
        side: p.side,
        avg_entry: p.avg_entry_price,
        current_price: p.current_price,
        market_value: p.market_value,
        unrealized_pl: p.unrealized_pl,
        unrealized_plpc: p.unrealized_plpc,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== ORDERS =====

server.tool(
  'orders',
  'Get recent orders (open, filled, cancelled). Use to check order status.',
  { status: z.enum(['open', 'closed', 'all']).default('all').describe('Order status filter'), limit: z.number().default(10) },
  async (args: { status: string; limit: number }) => {
    try {
      const orders = await alpacaGet(`/orders?status=${args.status}&limit=${args.limit}&direction=desc`) as Array<Record<string, unknown>>;
      const summary = orders.map(o => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        qty: o.qty,
        filled_qty: o.filled_qty,
        filled_avg_price: o.filled_avg_price,
        status: o.status,
        submitted_at: o.submitted_at,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== MARKET DATA =====

server.tool(
  'quote',
  'Get the latest quote for a stock/crypto symbol. Use for current price checks before trading.',
  { symbol: z.string().describe('Stock or crypto symbol (e.g. AAPL, BTC/USD, MSFT)') },
  async (args: { symbol: string }) => {
    try {
      const isCrypto = args.symbol.includes('/');
      const path = isCrypto
        ? `/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(args.symbol)}`
        : `/stocks/${args.symbol}/quotes/latest`;
      const base = 'https://data.alpaca.markets';
      const resp = await fetch(`${base}${isCrypto ? path : `/v2${path}`}`, { headers: HEADERS });
      if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'bars',
  'Get price history (OHLCV bars) for a symbol. Use for chart data and trend analysis.',
  {
    symbol: z.string().describe('Symbol (e.g. AAPL, BTC/USD)'),
    timeframe: z.string().default('1Day').describe('Bar size: 1Min, 5Min, 15Min, 1Hour, 1Day, 1Week'),
    limit: z.number().default(10).describe('Number of bars'),
  },
  async (args: { symbol: string; timeframe: string; limit: number }) => {
    try {
      const isCrypto = args.symbol.includes('/');
      let url: string;
      if (isCrypto) {
        url = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(args.symbol)}&timeframe=${args.timeframe}&limit=${args.limit}`;
      } else {
        url = `https://data.alpaca.markets/v2/stocks/${args.symbol}/bars?timeframe=${args.timeframe}&limit=${args.limit}`;
      }
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(await resp.json(), null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== PLACE ORDER =====

server.tool(
  'place_order',
  'Place a buy or sell order. PAPER TRADING ONLY. Must be approved by Risk Monitor first. Only the Executioner agent should call this. Shariah compliance: no shorts, no margin, no leverage.',
  {
    symbol: z.string().describe('Symbol to trade (e.g. AAPL, MSFT)'),
    qty: z.number().describe('Number of shares'),
    side: z.enum(['buy', 'sell']).describe('Buy or sell'),
    type: z.enum(['market', 'limit', 'stop', 'stop_limit']).default('market'),
    limit_price: z.number().optional().describe('Limit price (required for limit/stop_limit orders)'),
    stop_price: z.number().optional().describe('Stop price (required for stop/stop_limit orders)'),
    time_in_force: z.enum(['day', 'gtc', 'ioc', 'fok']).default('day'),
  },
  async (args: { symbol: string; qty: number; side: string; type: string; limit_price?: number; stop_price?: number; time_in_force: string }) => {
    try {
      // Shariah compliance check
      if (args.side === 'sell') {
        // Check if we own the shares (no short selling)
        const positions = await alpacaGet('/positions') as Array<Record<string, unknown>>;
        const pos = positions.find(p => p.symbol === args.symbol);
        if (!pos) {
          return { content: [{ type: 'text' as const, text: `BLOCKED: Cannot sell ${args.symbol} — you don't own it. Short selling is not shariah-compliant.` }], isError: true };
        }
      }

      const order: Record<string, unknown> = {
        symbol: args.symbol,
        qty: args.qty.toString(),
        side: args.side,
        type: args.type,
        time_in_force: args.time_in_force,
      };
      if (args.limit_price) order.limit_price = args.limit_price.toString();
      if (args.stop_price) order.stop_price = args.stop_price.toString();

      const result = await alpacaPost('/orders', order) as Record<string, unknown>;
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        order_id: result.id,
        symbol: result.symbol,
        side: result.side,
        type: result.type,
        qty: result.qty,
        status: result.status,
        submitted_at: result.submitted_at,
        message: `Order placed: ${result.side} ${result.qty} ${result.symbol} (${result.type}). Status: ${result.status}`,
      }, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Order failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== CANCEL ORDER =====

server.tool(
  'cancel_order',
  'Cancel an open order by ID.',
  { order_id: z.string().describe('Order ID to cancel') },
  async (args: { order_id: string }) => {
    try {
      await alpacaDelete(`/orders/${args.order_id}`);
      return { content: [{ type: 'text' as const, text: `Order ${args.order_id} cancelled.` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Cancel failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== WATCHLIST =====

server.tool(
  'market_status',
  'Check if the US stock market is currently open or closed.',
  {},
  async () => {
    try {
      const clock = await alpacaGet('/clock') as Record<string, unknown>;
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        is_open: clock.is_open,
        next_open: clock.next_open,
        next_close: clock.next_close,
        timestamp: clock.timestamp,
      }, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== PORTFOLIO HISTORY =====

server.tool(
  'portfolio_history',
  'Get portfolio value history for charting. Shows equity over time.',
  { period: z.string().default('1W').describe('Period: 1D, 1W, 1M, 3M, 1A') },
  async (args: { period: string }) => {
    try {
      const history = await alpacaGet(`/account/portfolio/history?period=${args.period}&timeframe=1D`) as Record<string, unknown>;
      return { content: [{ type: 'text' as const, text: JSON.stringify(history, null, 2) }] };
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
  console.error('Alpaca MCP error:', err);
  process.exit(1);
});
