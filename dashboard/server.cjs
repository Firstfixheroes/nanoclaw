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

async function apiData() {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
    const tasks = db.prepare("SELECT id, substr(prompt, 1, 500) as prompt, schedule_value, status, next_run, last_result FROM scheduled_tasks WHERE status = 'active' ORDER BY next_run").all();
    const messages = db.prepare("SELECT content, sender_name, timestamp, is_from_me FROM messages ORDER BY timestamp DESC LIMIT 50").all();
    db.close();
    // Fetch live banking data
    let wiseBalance = null, alpacaAccount = null, hsbcBalance = null;
    try {
      const https = require('https');
      const fetch = (u, h) => new Promise((res,rej) => {
        const r = https.get(u, {headers:h, timeout:5000}, resp => {
          let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>{try{res(JSON.parse(d))}catch{res(null)}});
        }); r.on('error',()=>res(null)); r.on('timeout',()=>{r.destroy();res(null)});
      });

      // Wise
      const wiseToken = '4649361d-4178-4571-ba88-6092af46a31a';
      const wb = await fetch('https://api.transferwise.com/v4/profiles/28735690/balances?types=STANDARD', {'Authorization':'Bearer '+wiseToken});
      if (Array.isArray(wb)) {
        wiseBalance = wb.map(b => ({currency: b.amount?.currency, balance: b.amount?.value, name: b.name||''})).filter(b => b.balance > 0 || b.currency === 'GBP');
      }

      // Alpaca
      const aa = await fetch('https://paper-api.alpaca.markets/v2/account', {'APCA-API-KEY-ID':'PKZNTPG4OJ7J2A2AVYWFJ6PBL5','APCA-API-SECRET-KEY':'BDZDpwt14WY4Tx6hKBHBHGZNb9iVRgawHSJJH1hPukxf'});
      if (aa && aa.portfolio_value) {
        alpacaAccount = {portfolio_value: aa.portfolio_value, cash: aa.cash, buying_power: aa.buying_power, equity: aa.equity, status: aa.status};
      }

      // Banks via TrueLayer — try all stored tokens, auto-refresh expired ones
      hsbcBalance = [];
      const allTokensFile = path.join(PROJECT_ROOT, 'data', 'truelayer-all-tokens.json');
      const singleTokenFile = path.join(PROJECT_ROOT, 'data', 'truelayer-tokens.json');
      let tokens = [];
      try { tokens = JSON.parse(fs.readFileSync(allTokensFile,'utf-8')); } catch {}
      if (!tokens.length) {
        try { tokens = [JSON.parse(fs.readFileSync(singleTokenFile,'utf-8'))]; } catch {}
      }

      const refreshToken = async (t, idx) => {
        if (!t.refresh_token) return null;
        try {
          const postData = 'grant_type=refresh_token&client_id=ffhaicfo-dbaf22&client_secret=dcf76322-cf15-454b-9aa4-c2a8bde50fb8&refresh_token=' + t.refresh_token;
          const resp = await new Promise((res, rej) => {
            const r = require('https').request({hostname:'auth.truelayer.com',path:'/connect/token',method:'POST',
              headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(postData)}},
              resp => {let d='';resp.on('data',c=>d+=c);resp.on('end',()=>{try{res(JSON.parse(d))}catch{rej(d)}})});
            r.on('error',rej);r.write(postData);r.end();
          });
          if (resp.access_token) {
            tokens[idx] = {...t, access_token: resp.access_token, refresh_token: resp.refresh_token || t.refresh_token};
            fs.writeFileSync(allTokensFile, JSON.stringify(tokens, null, 2));
            console.log('TrueLayer token refreshed for connection', idx);
            return resp.access_token;
          }
        } catch(e) { console.error('Refresh failed:', e); }
        return null;
      };

      for (let i = 0; i < tokens.length; i++) {
        let tlToken = tokens[i].access_token;
        if (!tlToken) continue;
        try {
          let ha = await fetch('https://api.truelayer.com/data/v1/accounts', {'Authorization':'Bearer '+tlToken});
          // If token expired, try refresh
          if (!ha || ha.error === 'invalid_token') {
            const newToken = await refreshToken(tokens[i], i);
            if (newToken) {
              tlToken = newToken;
              ha = await fetch('https://api.truelayer.com/data/v1/accounts', {'Authorization':'Bearer '+tlToken});
            } else continue;
          }
          if (ha && ha.results) {
            for (const acc of ha.results) {
              if (hsbcBalance.find(b => b.account === acc.display_name)) continue;
              const bal = await fetch('https://api.truelayer.com/data/v1/accounts/'+acc.account_id+'/balance', {'Authorization':'Bearer '+tlToken});
              if (bal && bal.results) {
                for (const b of bal.results) hsbcBalance.push({account: acc.display_name, current: b.current, available: b.available, currency: b.currency});
              }
            }
          }
        } catch {}
      }
    } catch(e) { console.error('Live data fetch error:', e.message); }

    // Crypto.com - get BTC ticker via public API
    let cryptoComData = null;
    try {
      const btcResp = await new Promise((res, rej) => {
        require('https').get('https://api.crypto.com/v2/public/get-ticker?instrument_name=BTC_USDT', r => {
          let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch{rej(d)}});
        }).on('error', rej);
      });
      if (btcResp && btcResp.result && btcResp.result.data) {
        const t = Array.isArray(btcResp.result.data) ? btcResp.result.data[0] : btcResp.result.data;
        cryptoComData = { btc_price: t.a, btc_24h_change: t.c, connected: true };
      } else {
        cryptoComData = { connected: false };
      }
    } catch(e) { cryptoComData = { connected: false, error: e.message || String(e) }; }

    // FFH live data from Supabase
    let ffh = {};
    try {
      const FFH_URL = 'https://svhxaljwlzankgyxvzqn.supabase.co';
      const FFH_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2aHhhbGp3bHphbmtneXh2enFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjUwOTc3NiwiZXhwIjoyMDgyMDg1Nzc2fQ.YiDKgAInonM_CJjzRun3Y7GW6zdkCN83LdAqsCBGEmY';
      const https = require('https');
      const sbFetch = (table, params) => new Promise((res) => {
        const u = `${FFH_URL}/rest/v1/${table}?${params||'select=*'}`;
        const r = require('https').get(u, {headers:{'apikey':FFH_SERVICE_KEY,'Authorization':'Bearer '+FFH_SERVICE_KEY},timeout:5000}, resp => {
          let d='';resp.on('data',c=>d+=c);resp.on('end',()=>{try{res(JSON.parse(d))}catch{res([])}});
        });r.on('error',()=>res([]));r.on('timeout',()=>{r.destroy();res([])});
      });
      const [fjobs,finv,fops,fsnags,fquotes,fleads] = await Promise.all([
        sbFetch('jobs','select=id,job_number,title,status,priority,created_at&order=created_at.desc&limit=50'),
        sbFetch('invoices','select=id,invoice_number,total_amount,status,created_at,client_id&status=in.(pending,sent,overdue)&limit=20'),
        sbFetch('operatives','select=id,name,status,phone&limit=30'),
        sbFetch('job_snags','select=id,description,severity,status&status=neq.resolved&limit=20'),
        sbFetch('quotes','select=id,reference,grand_total,status,created_at&status=in.(draft,sent,pending)&limit=10'),
        sbFetch('contact_submissions','select=id,name,email,message,created_at&order=created_at.desc&limit=10'),
      ]);
      ffh = {jobs:fjobs,invoices:finv,operatives:fops,snags:fsnags,quotes:fquotes,leads:fleads};
    } catch(e) { console.error('FFH data error:', e.message); }

    return { tasks, messages, actionItems: readScratchpad('action-items.md'), followUps: readScratchpad('follow-ups.md'), financialSummary: readScratchpad('financial-summary.md'), cashflowForecast: readScratchpad('cashflow-forecast.md'), financialRisks: readScratchpad('financial-risks.md'), tradesPending: readScratchpad('trades-pending.md'), positionsCurrent: readScratchpad('positions-current.md'), sorAnalysis: readScratchpad('sor-competitive-analysis.md'), ffhTasks: readScratchpad('ffh-tasks.md'), emailCleanup: readScratchpad('email-cleanup.json'), wiseBalance, alpacaAccount, hsbcBalance, cryptoComData, ffh };
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

const PUBLIC_DIR = path.join(__dirname, 'public');
function serveStatic(p, res) {
  // Serve from public directory
  let fp = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return true; }
  if (!fs.existsSync(fp)) return false;
  const ext = path.extname(fp);
  const types = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
  res.writeHead(200, {'Content-Type': (types[ext]||'text/plain')+'; charset=utf-8', 'Cache-Control':'no-cache'});
  res.end(fs.readFileSync(fp));
  return true;
}

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
    apiData().then(data => {
    data.container = getContainerStatus();
    data.vncPort = getVncPort();
    if (data.vncPort) startVncProxy(data.vncPort);
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify(data));
    }).catch(e => { res.writeHead(500); res.end(JSON.stringify({error:e.message})); });
    return;
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
      const postData = `grant_type=authorization_code&client_id=ffhaicfo-dbaf22&client_secret=dcf76322-cf15-454b-9aa4-c2a8bde50fb8&redirect_uri=http://187.77.182.68:8080/api/truelayer/callback&code=${code}&scope=accounts%20balance%20transactions%20info%20offline_access`;
      const tokenReq = https.request({
        hostname: 'auth.truelayer.com', path: '/connect/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
      }, tokenRes => {
        let data = '';
        tokenRes.on('data', c => data += c);
        tokenRes.on('end', () => {
          try {
            const tokens = JSON.parse(data);
            // Save tokens — append to array so multiple banks work
            const tokenFile = path.join(PROJECT_ROOT, 'data', 'truelayer-tokens.json');
            const allTokensFile = path.join(PROJECT_ROOT, 'data', 'truelayer-all-tokens.json');
            // Save latest as primary
            fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
            // Also append to all-tokens array
            let allTokens = [];
            try { allTokens = JSON.parse(fs.readFileSync(allTokensFile, 'utf-8')); } catch {}
            allTokens.push({ ...tokens, connected_at: new Date().toISOString() });
            fs.writeFileSync(allTokensFile, JSON.stringify(allTokens, null, 2));
            console.log('TrueLayer tokens saved (total connections:', allTokens.length, ')');
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

  // Serve static files from public/
  if (serveStatic(p, res)) return;
  // Fallback to index.html for SPA routing
  serveStatic('/', res);
});
server.listen(PORT, '0.0.0.0', () => console.log(`Dashboard on http://0.0.0.0:${PORT}`));
