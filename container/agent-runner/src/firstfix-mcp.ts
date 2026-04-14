/**
 * FirstFix MCP Server — READ-ONLY connector to FFH's Supabase backend.
 *
 * STRICT RULES:
 * - READ ONLY by default. No writes without explicit tool design.
 * - Never duplicate existing automations (daily briefing emails, SMS triggers, AI quote gen)
 * - Never modify job status, operative assignments, or financial records
 * - Only surface data for AR's awareness and decision-making
 *
 * What already exists in FirstFix (DO NOT DUPLICATE):
 * - send-daily-briefing: Sends email briefings to staff (SendGrid)
 * - message_automations: Auto-SMS on job status changes (Twilio)
 * - generate-quote-from-sor: AI quote generation from SOR price lists
 * - process-receipt: Receipt OCR
 * - scan-spec-sheet: Spec document scanning
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const SUPABASE_URL = process.env.FIRSTFIX_SUPABASE_URL || 'https://svhxaljwlzankgyxvzqn.supabase.co';
const SUPABASE_KEY = process.env.FIRSTFIX_SUPABASE_KEY || '';

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function query(table: string, params: string = ''): Promise<unknown> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

const server = new McpServer({ name: 'firstfix', version: '1.0.0' });

// ===== JOB QUERIES (READ ONLY) =====

server.tool(
  'ffh_jobs_today',
  "Get today's active FFH jobs with client, site, operative assignments, and status. Use this for the morning briefing and dashboard.",
  {},
  async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const jobs = await query('jobs', `select=id,job_number,title,status,priority,scheduled_date,client_id,site_id,description&scheduled_date=eq.${today}&order=priority.asc&limit=50`) as Array<Record<string, unknown>>;
      return { content: [{ type: 'text' as const, text: JSON.stringify(jobs, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'ffh_jobs_by_status',
  'Get FFH jobs filtered by status. Statuses: scheduled, in_progress, completed, invoiced, on_hold, cancelled.',
  { status: z.string().describe('Job status to filter by'), limit: z.number().default(20) },
  async (args: { status: string; limit: number }) => {
    try {
      const jobs = await query('jobs', `select=id,job_number,title,status,priority,scheduled_date,description&status=eq.${args.status}&order=scheduled_date.desc&limit=${args.limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(jobs, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== INVOICE QUERIES (READ ONLY) =====

server.tool(
  'ffh_invoices_outstanding',
  'Get outstanding (unpaid) FFH invoices with amounts, client, and age. Use for cash flow monitoring and chase lists.',
  { limit: z.number().default(20) },
  async (args: { limit: number }) => {
    try {
      const invoices = await query('invoices', `select=id,invoice_number,client_id,total_amount,status,created_at,due_date&status=in.(pending,sent,overdue)&order=created_at.asc&limit=${args.limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(invoices, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== OPERATIVE QUERIES (READ ONLY) =====

server.tool(
  'ffh_operatives_status',
  'Get current operative status — who is clocked in, their location, current job. Use for workforce visibility.',
  {},
  async () => {
    try {
      const operatives = await query('operatives', 'select=id,name,trade,status,phone&is_active=eq.true&order=name');
      return { content: [{ type: 'text' as const, text: JSON.stringify(operatives, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== SNAG QUERIES (READ ONLY) =====

server.tool(
  'ffh_open_snags',
  'Get open snags/defects that need resolution. Use for quality monitoring.',
  { limit: z.number().default(20) },
  async (args: { limit: number }) => {
    try {
      const snags = await query('job_snags', `select=id,job_id,description,status,severity,created_at&status=neq.resolved&order=created_at.desc&limit=${args.limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(snags, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== CLIENT QUERIES (READ ONLY) =====

server.tool(
  'ffh_clients',
  'Get FFH client list with contact details. Use for relationship management.',
  { limit: z.number().default(50) },
  async (args: { limit: number }) => {
    try {
      const clients = await query('clients', `select=id,name,email,phone,status&order=name&limit=${args.limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(clients, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== CONTACT SUBMISSIONS (READ ONLY — new leads) =====

server.tool(
  'ffh_new_leads',
  'Get recent contact form submissions and chatbot leads. Use for lead routing and follow-up.',
  { limit: z.number().default(10) },
  async (args: { limit: number }) => {
    try {
      const leads = await query('contact_submissions', `select=id,name,email,phone,message,created_at,status&order=created_at.desc&limit=${args.limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(leads, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== SOR PRICE LIST (READ ONLY) =====

server.tool(
  'ffh_sor_items',
  'Search FFH SOR price list items by description keyword. Use for pricing queries.',
  { keyword: z.string().describe('Search term for SOR item description'), limit: z.number().default(20) },
  async (args: { keyword: string; limit: number }) => {
    try {
      const items = await query('sor_items', `select=id,code,description,unit,rate&description=ilike.*${encodeURIComponent(args.keyword)}*&limit=${args.limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(items, null, 2) }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ===== DASHBOARD SUMMARY (READ ONLY) =====

server.tool(
  'ffh_dashboard_summary',
  'Get a high-level summary of FFH operations: job counts by status, total outstanding invoices, active operatives, open snags. Perfect for briefings.',
  {},
  async () => {
    try {
      const [jobs, invoices, operatives, snags] = await Promise.all([
        query('jobs', 'select=status&limit=1000') as Promise<Array<{ status: string }>>,
        query('invoices', 'select=status,total_amount&status=in.(pending,sent,overdue)') as Promise<Array<{ status: string; total_amount: number }>>,
        query('operatives', 'select=status&is_active=eq.true') as Promise<Array<{ status: string }>>,
        query('job_snags', 'select=status&status=neq.resolved') as Promise<Array<{ status: string }>>,
      ]);

      const jobCounts: Record<string, number> = {};
      for (const j of jobs) jobCounts[j.status] = (jobCounts[j.status] || 0) + 1;

      const totalOutstanding = invoices.reduce((s, i) => s + (i.total_amount || 0), 0);

      const summary = {
        jobs: jobCounts,
        totalJobs: jobs.length,
        outstandingInvoices: invoices.length,
        outstandingAmount: `£${totalOutstanding.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
        activeOperatives: operatives.length,
        openSnags: snags.length,
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
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
  console.error('FirstFix MCP error:', err);
  process.exit(1);
});
