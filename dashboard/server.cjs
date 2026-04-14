const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const url = require('url');

const PORT = process.env.DASHBOARD_PORT || 8080;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'store', 'messages.db');
const SCRATCHPAD = path.join(PROJECT_ROOT, 'groups', 'whatsapp_main', 'scratchpad');
const IPC_DIR = path.join(PROJECT_ROOT, 'data', 'ipc', 'whatsapp_main');

function readFile(fp) { try { return fs.readFileSync(fp, 'utf-8'); } catch { return ''; } }
function readScratchpad(f) { return readFile(path.join(SCRATCHPAD, f)); }

function apiData() {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
    const tasks = db.prepare("SELECT id, substr(prompt, 1, 200) as prompt, schedule_value, status, next_run, last_result FROM scheduled_tasks WHERE status = 'active' ORDER BY next_run").all();
    const messages = db.prepare("SELECT content, sender_name, timestamp, is_from_me FROM messages ORDER BY timestamp DESC LIMIT 30").all();
    db.close();
    return { tasks, messages, actionItems: readScratchpad('action-items.md'), followUps: readScratchpad('follow-ups.md'), financialSummary: readScratchpad('financial-summary.md'), cashflowForecast: readScratchpad('cashflow-forecast.md'), financialRisks: readScratchpad('financial-risks.md'), tradesPending: readScratchpad('trades-pending.md'), positionsCurrent: readScratchpad('positions-current.md'), sorAnalysis: readScratchpad('sor-competitive-analysis.md'), ffhTasks: readScratchpad('ffh-tasks.md') };
  } catch(e) { if (db) db.close(); return { error: e.message }; }
}

function sendMessage(text) {
  // Write to IPC input directory so the running container picks it up as a user message
  const inputDir = path.join(IPC_DIR, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, `dash-${Date.now()}.json`), JSON.stringify({ type: 'message', text: text }));

  // Also store in the messages DB so the next container spawn includes it if no container is running
  const msgDir = path.join(IPC_DIR, 'messages');
  fs.mkdirSync(msgDir, { recursive: true });
  fs.writeFileSync(path.join(msgDir, `dash-${Date.now()}.json`), JSON.stringify({ type: 'message', chatJid: '447868983354@s.whatsapp.net', text: text, groupFolder: 'whatsapp_main', timestamp: new Date().toISOString() }));

  return { ok: true };
}

function getHtml() { try { return fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8'); } catch { return '<h1>Dashboard loading...</h1>'; } }

const server = http.createServer((req, res) => {
  const p = url.parse(req.url, true).pathname;
  if (p === '/health') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"status":"ok"}'); }
  if (p === '/api/data') { res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); return res.end(JSON.stringify(apiData())); }
  if (p === '/api/send' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { sendMessage(JSON.parse(body).text); res.writeHead(200,{'Content-Type':'application/json'}); res.end('{"ok":true}'); } catch(e) { res.writeHead(400); res.end(JSON.stringify({error:e.message})); } });
    return;
  }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end(getHtml());
});
server.listen(PORT, '0.0.0.0', () => console.log(`Dashboard on http://0.0.0.0:${PORT}`));
