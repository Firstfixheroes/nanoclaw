const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const url = require('url');
const { execSync } = require('child_process');

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
    const tasks = db.prepare("SELECT id, substr(prompt, 1, 500) as prompt, schedule_value, status, next_run, last_result FROM scheduled_tasks WHERE status = 'active' ORDER BY next_run").all();
    const messages = db.prepare("SELECT content, sender_name, timestamp, is_from_me FROM messages ORDER BY timestamp DESC LIMIT 50").all();
    db.close();
    return { tasks, messages, actionItems: readScratchpad('action-items.md'), followUps: readScratchpad('follow-ups.md'), financialSummary: readScratchpad('financial-summary.md'), cashflowForecast: readScratchpad('cashflow-forecast.md'), financialRisks: readScratchpad('financial-risks.md'), tradesPending: readScratchpad('trades-pending.md'), positionsCurrent: readScratchpad('positions-current.md'), sorAnalysis: readScratchpad('sor-competitive-analysis.md'), ffhTasks: readScratchpad('ffh-tasks.md'), emailCleanup: readScratchpad('email-cleanup.json') };
  } catch(e) { if (db) db.close(); return { error: e.message }; }
}

function getVncPort() {
  // Find the running nanoclaw container's mapped VNC port
  try {
    const out = execSync("docker ps --filter name=nanoclaw-whatsapp --format '{{.Ports}}' 2>/dev/null", { timeout: 3000 }).toString().trim();
    // Parse "0.0.0.0:32768->5900/tcp" format
    const match = out.match(/0\.0\.0\.0:(\d+)->5900/);
    return match ? parseInt(match[1]) : null;
  } catch { return null; }
}

function getContainerStatus() {
  try {
    const out = execSync("docker ps --filter name=nanoclaw-whatsapp --format '{{.Names}}|{{.Status}}' 2>/dev/null", { timeout: 3000 }).toString().trim();
    if (!out) return { running: false, name: null, status: null };
    const [name, status] = out.split('|');
    return { running: true, name, status };
  } catch { return { running: false, name: null, status: null }; }
}

function sendMessage(text) {
  const inputDir = path.join(IPC_DIR, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, `dash-${Date.now()}.json`), JSON.stringify({ type: 'message', text: text }));
  try {
    const db = new Database(DB_PATH);
    db.prepare("INSERT OR IGNORE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      'dash-' + Date.now(), '447868983354@s.whatsapp.net', '447868983354@s.whatsapp.net', 'AR (Dashboard)', text, new Date().toISOString(), 1
    );
    db.close();
  } catch(e) { console.error('DB write failed:', e.message); }
  return { ok: true };
}

function getHtml() { try { return fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8'); } catch { return '<h1>Dashboard loading...</h1>'; } }

// Start websockify for VNC proxying
let wsProxy = null;
function startVncProxy(vncPort) {
  if (wsProxy) return;
  try {
    const { spawn } = require('child_process');
    wsProxy = spawn('websockify', ['--web=/usr/share/novnc/', '6080', `localhost:${vncPort}`], { stdio: 'ignore', detached: true });
    wsProxy.unref();
    console.log(`VNC proxy started on 6080 -> ${vncPort}`);
  } catch(e) { console.error('VNC proxy failed:', e.message); }
}

const server = http.createServer((req, res) => {
  const p = url.parse(req.url, true).pathname;
  if (p === '/health') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"status":"ok"}'); }

  if (p === '/api/data') {
    const data = apiData();
    data.container = getContainerStatus();
    data.vncPort = getVncPort();
    if (data.vncPort) startVncProxy(data.vncPort);
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    return res.end(JSON.stringify(data));
  }

  if (p.startsWith('/files/')) {
    const fp = path.join(PROJECT_ROOT, 'groups', 'whatsapp_main', decodeURIComponent(p.slice(7)));
    if (fs.existsSync(fp) && !fp.includes('..')) {
      const ext = path.extname(fp);
      const ct = ext === '.md' ? 'text/markdown' : ext === '.csv' ? 'text/csv' : ext === '.html' ? 'text/html' : 'text/plain';
      res.writeHead(200, {'Content-Type': ct + '; charset=utf-8', 'Access-Control-Allow-Origin': '*'});
      return res.end(fs.readFileSync(fp, 'utf-8'));
    }
    res.writeHead(404); return res.end('File not found');
  }

  if (p === '/api/files') {
    const groupDir = path.join(PROJECT_ROOT, 'groups', 'whatsapp_main');
    const files = [];
    function walk(dir, prefix) {
      try {
        for (const f of fs.readdirSync(dir)) {
          const fp = path.join(dir, f);
          const rel = prefix ? prefix + '/' + f : f;
          if (fs.statSync(fp).isDirectory()) { if (!f.startsWith('.') && f !== 'logs') walk(fp, rel); }
          else if (f.endsWith('.md') || f.endsWith('.csv') || f.endsWith('.html') || f.endsWith('.xlsx') || f.endsWith('.pdf')) files.push(rel);
        }
      } catch {}
    }
    walk(groupDir, '');
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(files));
  }

  // TrueLayer OAuth callback
  if (p === '/api/truelayer/callback') {
    const query = url.parse(req.url, true).query;
    const code = query.code;
    if (code) {
      // Exchange code for tokens
      const https = require('https');
      const postData = `grant_type=authorization_code&client_id=ffhaicfo-dbaf22&client_secret=dcf76322-cf15-454b-9aa4-c2a8bde50fb8&redirect_uri=http://187.77.182.68:8080/api/truelayer/callback&code=${code}`;
      const tokenReq = https.request({
        hostname: 'auth.truelayer.com', path: '/connect/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
      }, tokenRes => {
        let data = '';
        tokenRes.on('data', c => data += c);
        tokenRes.on('end', () => {
          try {
            const tokens = JSON.parse(data);
            // Save tokens
            const tokenFile = path.join(PROJECT_ROOT, 'data', 'truelayer-tokens.json');
            fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
            console.log('TrueLayer tokens saved');
            res.writeHead(200, {'Content-Type':'text/html'});
            res.end('<h1>Bank Connected!</h1><p>You can close this tab. Claw now has read-only access to your bank.</p>');
          } catch(e) {
            res.writeHead(500); res.end('Token exchange failed: ' + data);
          }
        });
      });
      tokenReq.write(postData);
      tokenReq.end();
      return;
    }
    res.writeHead(400); res.end('No code received');
    return;
  }

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
