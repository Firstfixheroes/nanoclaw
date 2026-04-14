/**
 * NanoClaw Dashboard — lightweight web UI for AR
 * Shows: action items, emails, follow-ups, agent activity, financial summaries
 * Reads from NanoClaw's SQLite DB and scratchpad files
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.DASHBOARD_PORT || 8080;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'store', 'messages.db');
const SCRATCHPAD = path.join(PROJECT_ROOT, 'groups', 'whatsapp_main', 'scratchpad');

function readScratchpad(filename) {
  const fp = path.join(SCRATCHPAD, filename);
  try { return fs.readFileSync(fp, 'utf-8'); } catch { return ''; }
}

function getRecentMessages(db, limit = 50) {
  try {
    return db.prepare(`
      SELECT content, sender_name, timestamp, is_from_me
      FROM messages
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit);
  } catch { return []; }
}

function getScheduledTasks(db) {
  try {
    return db.prepare(`
      SELECT id, substr(prompt, 1, 100) as prompt_preview, schedule_value, status, next_run, last_result
      FROM scheduled_tasks
      WHERE status = 'active'
      ORDER BY next_run
    `).all();
  } catch { return []; }
}

function getActionItems() {
  const content = readScratchpad('action-items.md');
  if (!content) return [];
  return content.split('\n').filter(l => l.trim().startsWith('- [')).map(l => {
    const done = l.includes('[x]') || l.includes('[X]');
    const text = l.replace(/^-\s*\[.\]\s*/, '').trim();
    return { text, done };
  });
}

function getFollowUps() {
  const content = readScratchpad('follow-ups.md');
  if (!content) return [];
  return content.split('\n').filter(l => l.trim().startsWith('- ')).map(l => {
    return { text: l.replace(/^-\s*/, '').trim() };
  });
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderDashboard(db) {
  const tasks = getScheduledTasks(db);
  const actions = getActionItems();
  const followUps = getFollowUps();
  const messages = getRecentMessages(db, 20);

  const tradesPending = readScratchpad('trades-pending.md');
  const positionsCurrent = readScratchpad('positions-current.md');
  const sorAnalysis = readScratchpad('sor-competitive-analysis.md');
  const learnerLog = readScratchpad('learner-log.md');
  const improvementLog = readScratchpad('improvement-log.md');
  const financialSummary = readScratchpad('financial-summary.md');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NanoClaw — AR's Command Centre</title>
<style>
  :root { --navy: #1A1A2E; --gold: #B8926A; --orange: #D4722A; --cream: #FDF6F0; --green: #2d7d46; --red: #c0392b; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--cream); color: var(--navy); }
  .header { background: var(--navy); color: white; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 20px; font-weight: 600; }
  .header .status { font-size: 12px; color: var(--gold); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 24px; max-width: 1400px; margin: 0 auto; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
  .card { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .card h2 { font-size: 14px; font-weight: 600; color: var(--gold); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
  .card.full { grid-column: 1 / -1; }
  .action-item { padding: 6px 0; border-bottom: 1px solid #f5f5f5; display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .action-item.done { text-decoration: line-through; opacity: 0.5; }
  .checkbox { width: 16px; height: 16px; border: 2px solid var(--navy); border-radius: 3px; cursor: pointer; flex-shrink: 0; }
  .checkbox.checked { background: var(--green); border-color: var(--green); }
  .followup { padding: 6px 0; border-bottom: 1px solid #f5f5f5; font-size: 14px; }
  .followup .date { color: var(--orange); font-weight: 600; font-size: 12px; }
  .task-row { padding: 6px 0; border-bottom: 1px solid #f5f5f5; font-size: 13px; display: flex; justify-content: space-between; }
  .task-row .schedule { color: #888; font-size: 12px; }
  .msg { padding: 6px 0; border-bottom: 1px solid #f5f5f5; font-size: 13px; }
  .msg .sender { font-weight: 600; color: var(--navy); }
  .msg .time { color: #aaa; font-size: 11px; }
  .msg .content { margin-top: 2px; color: #444; }
  .msg.from-me .sender { color: var(--gold); }
  .empty { color: #aaa; font-size: 13px; font-style: italic; }
  pre { font-size: 12px; background: #f8f8f8; padding: 12px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
  .refresh { background: var(--gold); color: white; border: none; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; }
</style>
</head>
<body>
<div class="header">
  <h1>NanoClaw — AR's Command Centre</h1>
  <div>
    <span class="status">Last refresh: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}</span>
    <button class="refresh" onclick="location.reload()">Refresh</button>
  </div>
</div>
<div class="grid">

<div class="card">
  <h2>Action Items</h2>
  ${actions.length ? actions.map(a => `<div class="action-item${a.done ? ' done' : ''}"><div class="checkbox${a.done ? ' checked' : ''}"></div>${escapeHtml(a.text)}</div>`).join('') : '<div class="empty">No action items. Tell Claw to add some.</div>'}
</div>

<div class="card">
  <h2>Follow-Ups</h2>
  ${followUps.length ? followUps.map(f => `<div class="followup">${escapeHtml(f.text)}</div>`).join('') : '<div class="empty">No scheduled follow-ups.</div>'}
</div>

<div class="card">
  <h2>Scheduled Tasks</h2>
  ${tasks.map(t => `<div class="task-row"><span>${escapeHtml(t.prompt_preview)}</span><span class="schedule">${escapeHtml(t.schedule_value)}</span></div>`).join('')}
</div>

<div class="card">
  <h2>Recent Conversations</h2>
  ${messages.slice(0, 10).map(m => `<div class="msg${m.is_from_me ? ' from-me' : ''}"><span class="sender">${escapeHtml(m.sender_name || 'Unknown')}</span> <span class="time">${new Date(m.timestamp).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span><div class="content">${escapeHtml((m.content || '').slice(0, 200))}</div></div>`).join('') || '<div class="empty">No recent messages.</div>'}
</div>

<div class="card">
  <h2>Financial Summary</h2>
  ${financialSummary ? `<pre>${escapeHtml(financialSummary)}</pre>` : '<div class="empty">Upload bank CSVs to get started. See instructions below.</div>'}
</div>

<div class="card">
  <h2>Trading Positions</h2>
  ${positionsCurrent ? `<pre>${escapeHtml(positionsCurrent)}</pre>` : '<div class="empty">No open positions.</div>'}
</div>

<div class="card full">
  <h2>SOR Competitive Analysis</h2>
  ${sorAnalysis ? `<pre>${escapeHtml(sorAnalysis.slice(0, 2000))}</pre>` : '<div class="empty">No SOR analysis yet.</div>'}
</div>

</div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
    const html = renderDashboard(db);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Dashboard error: ' + err.message);
  } finally {
    if (db) db.close();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NanoClaw Dashboard running on http://0.0.0.0:${PORT}`);
});
