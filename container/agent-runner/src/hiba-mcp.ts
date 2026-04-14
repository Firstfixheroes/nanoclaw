/**
 * Hiba MCP Server — connector to Hiba's Supabase backend.
 * READ-ONLY. For monitoring launch readiness, orders, drivers, restaurants.
 *
 * Hiba is pre-launch. These tools will return empty data until live orders start.
 * As the platform goes live, the same tools surface real metrics.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const SUPABASE_URL = process.env.HIBA_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.HIBA_SUPABASE_KEY || '';

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function query(table: string, params: string = ''): Promise<unknown> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`Hiba Supabase ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

const server = new McpServer({ name: 'hiba', version: '1.0.0' });

server.tool(
  'hiba_dashboard',
  'Get Hiba platform overview: restaurant count, driver count, order count, user count. Use for launch readiness tracking.',
  {},
  async () => {
    try {
      const [restaurants, drivers, orders, users] = await Promise.all([
        query('restaurants', 'select=id&limit=1000') as Promise<Array<unknown>>,
        query('drivers', 'select=id&limit=1000') as Promise<Array<unknown>>,
        query('orders', 'select=id,status&limit=1000') as Promise<Array<{ status: string }>>,
        query('users', 'select=id,role&limit=1000') as Promise<Array<{ role: string }>>,
      ]);

      const ordersByStatus: Record<string, number> = {};
      for (const o of orders) ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1;

      const usersByRole: Record<string, number> = {};
      for (const u of users) usersByRole[u.role] = (usersByRole[u.role] || 0) + 1;

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        restaurants: restaurants.length,
        drivers: drivers.length,
        totalOrders: orders.length,
        ordersByStatus,
        totalUsers: users.length,
        usersByRole,
        launchReady: restaurants.length > 0 && drivers.length > 0,
      }, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'hiba_orders',
  'Get recent Hiba orders with status. Use for monitoring live order activity.',
  { status: z.string().optional().describe('Filter by status: pending, confirmed, preparing, ready, picked_up, delivered, cancelled'), limit: z.number().default(20) },
  async (args: { status?: string; limit: number }) => {
    try {
      let params = `select=id,status,total_amount,created_at&order=created_at.desc&limit=${args.limit}`;
      if (args.status) params += `&status=eq.${args.status}`;
      const orders = await query('orders', params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(orders, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'hiba_restaurants',
  'Get Hiba restaurant list with names and details.',
  { limit: z.number().default(20) },
  async (args: { limit: number }) => {
    try {
      const restaurants = await query('restaurants', `select=id,name,cuisine_type,is_active,commission_rate&limit=${args.limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(restaurants, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'hiba_drivers',
  'Get Hiba driver list with status and earnings.',
  { limit: z.number().default(20) },
  async (args: { limit: number }) => {
    try {
      const drivers = await query('drivers', `select=id,vehicle_type,is_active,total_earnings,total_deliveries&limit=${args.limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(drivers, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'hiba_reviews',
  'Get recent Hiba reviews and ratings.',
  { limit: z.number().default(10) },
  async (args: { limit: number }) => {
    try {
      const reviews = await query('reviews', `select=id,rating,comment,created_at&order=created_at.desc&limit=${args.limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(reviews, null, 2) }] };
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
  console.error('Hiba MCP error:', err);
  process.exit(1);
});
