/**
 * Shariah Compliance Screener MCP Server
 * Checks stocks against AAOIFI standards before trading.
 *
 * Screens:
 * 1. Sector exclusion (haram industries)
 * 2. Debt-to-market-cap ratio (<33%)
 * 3. Interest income (<5% of revenue)
 * 4. Liquid assets + receivables thresholds
 *
 * Uses web search for financial data when needed.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'shariah', version: '1.0.0' });

// Haram sectors — any company with primary revenue from these is excluded
const HARAM_SECTORS = [
  'conventional banking', 'conventional insurance', 'conventional finance',
  'alcohol', 'tobacco', 'gambling', 'casinos', 'adult entertainment',
  'pork', 'weapons of mass destruction', 'nuclear weapons',
  'interest-based lending', 'cannabis',
];

// Known compliant stocks (pre-screened, widely accepted)
const KNOWN_COMPLIANT: Record<string, { status: string; notes: string }> = {
  'AAPL': { status: 'compliant', notes: 'Technology. Passes AAOIFI screens.' },
  'MSFT': { status: 'compliant', notes: 'Technology. Passes AAOIFI screens.' },
  'GOOGL': { status: 'compliant', notes: 'Technology/Advertising. Passes AAOIFI screens.' },
  'AMZN': { status: 'review', notes: 'E-commerce. Some scholars flag AWS lending products.' },
  'TSLA': { status: 'compliant', notes: 'Electric vehicles. Passes AAOIFI screens.' },
  'NVDA': { status: 'compliant', notes: 'Semiconductors. Passes AAOIFI screens.' },
  'META': { status: 'review', notes: 'Social media. Content moderation concerns for some scholars.' },
  'JPM': { status: 'non-compliant', notes: 'Conventional banking. Primary revenue from interest.' },
  'BAC': { status: 'non-compliant', notes: 'Conventional banking.' },
  'GS': { status: 'non-compliant', notes: 'Investment banking. Interest-based.' },
  'WFC': { status: 'non-compliant', notes: 'Conventional banking.' },
  'C': { status: 'non-compliant', notes: 'Conventional banking.' },
  'BUD': { status: 'non-compliant', notes: 'Alcohol producer.' },
  'DEO': { status: 'non-compliant', notes: 'Alcohol producer (Diageo).' },
  'PM': { status: 'non-compliant', notes: 'Tobacco.' },
  'MO': { status: 'non-compliant', notes: 'Tobacco (Altria).' },
  'LVS': { status: 'non-compliant', notes: 'Casino/gambling.' },
  'MGM': { status: 'non-compliant', notes: 'Casino/gambling.' },
  'WYNN': { status: 'non-compliant', notes: 'Casino/gambling.' },
  // Saudi compliant
  '2222.SR': { status: 'compliant', notes: 'Saudi Aramco. Shariah-compliant.' },
  '7010.SR': { status: 'compliant', notes: 'Saudi Telecom (STC). Shariah-compliant.' },
  '2010.SR': { status: 'compliant', notes: 'SABIC. Shariah-compliant.' },
  // Crypto
  'BTC': { status: 'review', notes: 'Bitcoin. Scholars divided. Permissible as digital asset by many, prohibited by some.' },
  'ETH': { status: 'review', notes: 'Ethereum. Similar to BTC. Staking may involve riba concerns.' },
  'SOL': { status: 'review', notes: 'Solana. Digital asset. Staking may raise concerns.' },
};

server.tool(
  'screen_stock',
  'Check if a stock or crypto is shariah-compliant according to AAOIFI standards. Use this BEFORE recommending any trade to AR.',
  { symbol: z.string().describe('Stock ticker (e.g. AAPL, JPM, 2222.SR) or crypto (BTC, ETH)') },
  async (args: { symbol: string }) => {
    const sym = args.symbol.toUpperCase();
    const known = KNOWN_COMPLIANT[sym];

    if (known) {
      const emoji = known.status === 'compliant' ? 'COMPLIANT' :
                     known.status === 'non-compliant' ? 'NON-COMPLIANT' : 'NEEDS REVIEW';
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        symbol: sym,
        shariah_status: emoji,
        details: known.notes,
        source: 'Pre-screened database',
        recommendation: known.status === 'compliant'
          ? 'Safe to trade under shariah rules.'
          : known.status === 'non-compliant'
          ? 'DO NOT TRADE. This asset is not shariah-compliant.'
          : 'Requires AR\'s personal shariah advisory. Some scholars permit, others do not.',
      }, null, 2) }] };
    }

    // Unknown stock — provide screening criteria for manual check
    return { content: [{ type: 'text' as const, text: JSON.stringify({
      symbol: sym,
      shariah_status: 'UNKNOWN — NEEDS SCREENING',
      screening_criteria: {
        '1_sector': 'Check primary business activity is not in: ' + HARAM_SECTORS.join(', '),
        '2_debt_ratio': 'Total debt / Market cap must be < 33%',
        '3_interest_income': 'Interest income / Total revenue must be < 5%',
        '4_receivables': '(Cash + Receivables) / Market cap must be < 33%',
        '5_liquid_assets': '(Cash + Interest-bearing securities) / Total assets must be < 33%',
      },
      action: 'Use web search to find the company\'s balance sheet data and apply these screens. If any screen fails, the stock is NON-COMPLIANT.',
      web_search_suggestion: `Search: "${sym} balance sheet debt to equity ratio interest income revenue 2025"`,
    }, null, 2) }] };
  },
);

server.tool(
  'screen_crypto',
  'Check if a cryptocurrency is permissible under shariah guidelines.',
  { symbol: z.string().describe('Crypto symbol (BTC, ETH, SOL, etc.)') },
  async (args: { symbol: string }) => {
    const sym = args.symbol.toUpperCase();

    // Crypto-specific screening
    const haramCryptoPatterns = [
      'casino', 'gambling', 'adult', 'alcohol', 'interest', 'lending',
    ];

    const known = KNOWN_COMPLIANT[sym];
    if (known) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        symbol: sym,
        shariah_status: known.status === 'compliant' ? 'COMPLIANT' : known.status === 'non-compliant' ? 'NON-COMPLIANT' : 'NEEDS REVIEW',
        details: known.notes,
        crypto_rules: {
          spot_trading: 'Permitted by most scholars if treated as digital asset',
          staking: 'Controversial — may involve riba (interest). Avoid unless advised otherwise.',
          lending: 'NOT PERMITTED — earning interest on crypto loans is riba.',
          futures: 'NOT PERMITTED — derivatives are not shariah-compliant.',
          margin: 'NOT PERMITTED — borrowing to trade is not allowed.',
        },
      }, null, 2) }] };
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify({
      symbol: sym,
      shariah_status: 'UNKNOWN',
      action: 'Research this token\'s primary use case. If it\'s linked to gambling, lending with interest, or haram industries, it\'s non-compliant. Pure utility/payment tokens are generally acceptable.',
    }, null, 2) }] };
  },
);

server.tool(
  'compliant_list',
  'Get a list of known shariah-compliant stocks suitable for trading.',
  { market: z.enum(['us', 'saudi', 'crypto', 'all']).default('all') },
  async (args: { market: string }) => {
    const results: Array<{ symbol: string; status: string; notes: string }> = [];
    for (const [sym, data] of Object.entries(KNOWN_COMPLIANT)) {
      if (data.status !== 'compliant') continue;
      const isSaudi = sym.includes('.SR');
      const isCrypto = !sym.includes('.') && sym.length <= 5 && !sym.match(/[a-z]/);
      if (args.market === 'saudi' && !isSaudi) continue;
      if (args.market === 'crypto' && !isCrypto) continue;
      if (args.market === 'us' && (isSaudi || isCrypto)) continue;
      results.push({ symbol: sym, ...data });
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('Shariah screener error:', err);
  process.exit(1);
});
