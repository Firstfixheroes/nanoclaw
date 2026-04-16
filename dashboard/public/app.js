// NanoClaw Dashboard App
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; };

let DATA = {};
let currentPage = 'home';

function toast(msg) { const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }

function go(page) {
  currentPage = page;
  $$('.nav-link').forEach(n => n.classList.remove('active'));
  const link = document.querySelector(`[data-page="${page}"]`);
  if (link) link.classList.add('active');
  render();
}

async function askClaw(text) {
  go('chat');
  const cm = $('#chat-messages');
  if (cm) cm.innerHTML += `<div class="chat-bubble me"><div class="bubble">${esc(text)}</div><div class="bubble-meta">You · now</div></div>`;
  if (cm) cm.scrollTop = cm.scrollHeight;
  await fetch('/api/send', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text}) });
  toast('Sent to Claw');
  setTimeout(loadData, 5000);
}

// ===== PAGE RENDERERS =====

function renderHome(d) {
  const actions = (d.actionItems||'').split('\n').filter(l=>l.trim().startsWith('- [')).length;
  const tasks = (d.tasks||[]).length;
  const ffhCount = (d.ffhTasks||'').split('\n').filter(l=>l.trim().startsWith('- [')&&!l.includes('[x]')).length;
  const wiseTotal = (d.wiseBalance||[]).reduce((s,b)=>s+(b.currency==='GBP'?b.balance:0),0);

  return `
    <div class="grid grid-4">
      <div class="card stat"><div class="stat-value">${ffhCount}</div><div class="stat-label">Open Tasks</div></div>
      <div class="card stat"><div class="stat-value money">£${wiseTotal.toFixed(0)}</div><div class="stat-label">Wise Balance</div></div>
      <div class="card stat"><div class="stat-value">${tasks}</div><div class="stat-label">Scheduled Jobs</div></div>
      <div class="card stat"><div class="stat-value"><span class="badge green">Healthy</span></div><div class="stat-label">System</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">FFH Tasks</span><span class="badge gold">${ffhCount} open</span></div>
        ${renderTaskList((d.ffhTasks||'').split('\n').filter(l=>l.trim().startsWith('- [')).slice(0,8))}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Recent Activity</span></div>
        ${(d.messages||[]).slice(0,6).map(m => `<div class="list-item"><span><b>${esc(m.sender_name||'')}</b> <span class="meta">${new Date(m.timestamp).toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'})}</span><br>${esc((m.content||'').slice(0,100))}</span></div>`).join('')||'<div class="empty">No recent messages</div>'}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Today's Schedule</span></div>
      ${renderSchedule(d.tasks||[])}
    </div>`;
}

function renderFFH(d) {
  const tasks = (d.ffhTasks||'').split('\n').filter(l=>l.trim().startsWith('- ['));
  const open = tasks.filter(l=>!l.includes('[x]')&&!l.includes('[X]'));
  return `
    <div class="grid grid-3">
      <div class="card stat"><div class="stat-value"><span class="badge green">Active</span></div><div class="stat-label">FFH Status</div></div>
      <div class="card stat"><div class="stat-value">${open.length}</div><div class="stat-label">Open Tasks</div></div>
      <div class="card stat"><div class="stat-value"><span class="badge amber">17 Apr</span></div><div class="stat-label">Hexagon Deadline</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card grid-full">
        <div class="card-header"><span class="card-title">Task Board</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-gold btn-sm" onclick="askClaw('Add a new FFH task')">+ Add Task</button>
            <button class="btn btn-outline btn-sm" onclick="askClaw('Check FFH emails and update task board')">Refresh</button>
          </div>
        </div>
        ${renderTaskList(tasks)}
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Quick Actions</span></div>
        <button class="btn btn-gold btn-full" style="margin-bottom:8px" onclick="askClaw('Check FFH emails now')">Check Emails</button>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Generate Hexagon BOQ')">Generate BOQ</button>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Find new housing association tenders in London')">Find Tenders</button>
        <button class="btn btn-outline btn-full" onclick="askClaw('Show margin opportunities from NatFed SOR analysis')">Margin Analysis</button>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Active Contracts</span></div>
        <div class="list-item"><span>Hexagon DCF-P2526-013</span><span class="badge amber">17 Apr</span></div>
        <div class="list-item"><span>Barnet Homes</span><span class="badge green">Live</span></div>
      </div>
    </div>`;
}

function renderFFHMgmt(d) {
  const ffh = d.ffh || {};
  const jobs = ffh.jobs || [];
  const invoices = ffh.invoices || [];
  const operatives = ffh.operatives || [];
  const snags = ffh.snags || [];
  const quotes = ffh.quotes || [];
  const leads = ffh.leads || [];
  const totalJobs = jobs.length;
  const activeJobs = jobs.filter(j => j.status === 'in_progress' || j.status === 'scheduled').length;
  const outstandingTotal = invoices.reduce((s,i) => s + parseFloat(i.total_amount || 0), 0);
  const openSnags = snags.filter(s => s.status !== 'resolved').length;
  const quotePipeline = quotes.reduce((s,q) => s + parseFloat(q.grand_total || 0), 0);

  const statusCounts = {};
  jobs.forEach(j => { statusCounts[j.status] = (statusCounts[j.status]||0) + 1; });

  return `
    <div class="grid grid-4">
      <div class="card stat"><div class="stat-value">${totalJobs}</div><div class="stat-label">Total Jobs</div><div class="meta">${activeJobs} active</div></div>
      <div class="card stat"><div class="stat-value money">£${outstandingTotal.toFixed(2)}</div><div class="stat-label">Outstanding Invoices</div></div>
      <div class="card stat"><div class="stat-value">${openSnags}</div><div class="stat-label">Open Snags</div></div>
      <div class="card stat"><div class="stat-value money">£${quotePipeline.toFixed(0)}</div><div class="stat-label">Quote Pipeline</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Jobs by Status</span><span class="badge green">LIVE</span></div>
        ${Object.keys(statusCounts).length ? Object.entries(statusCounts).map(([s,c]) => `<div class="list-item"><span>${esc(s)}</span><span class="badge ${s==='completed'?'green':s==='on_hold'?'amber':'blue'}">${c}</span></div>`).join('') : '<div class="empty">No jobs in system yet</div>'}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Outstanding Invoices</span><span class="badge red">OVERDUE</span></div>
        ${invoices.length ? invoices.map(i => `<div class="list-item"><span>${esc(i.invoice_number||'#?')} - ${esc(i.client_name||'')}</span><span class="badge red">£${parseFloat(i.total_amount||0).toFixed(2)}</span></div>`).join('') : '<div class="empty">No outstanding invoices</div>'}
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Operatives</span><span class="badge green">LIVE</span></div>
        <table class="data-table">
          <thead><tr><th>Operative</th><th>Status</th><th>Current Job</th></tr></thead>
          <tbody>${operatives.length ? operatives.map(o => `<tr><td>${esc(o.name||'')}</td><td><span class="badge ${o.status==='available'?'green':o.status==='on_job'?'blue':'amber'}">${esc(o.status||'?')}</span></td><td>${esc(o.current_job||'-')}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">No operatives loaded</td></tr>'}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Quotes Pipeline</span><span class="badge gold">£${quotePipeline.toFixed(0)} PIPELINE</span></div>
        ${quotes.length ? quotes.map(q => `<div class="list-item"><span>${esc(q.reference||'Quote')} - ${esc(q.client_name||'')}</span><span class="badge gold">£${parseFloat(q.grand_total||0).toFixed(2)}</span></div>`).join('') : '<div class="empty">No active quotes</div>'}
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Recent Leads</span></div>
        ${leads.length ? leads.map(l => `<div class="list-item"><span><b>${esc(l.name||'Unknown')}</b><br><span class="meta">${esc((l.message||'').slice(0,80))}</span></span></div>`).join('') : '<div class="empty">No new leads</div>'}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Quick Actions</span></div>
        <button class="btn btn-gold btn-full" style="margin-bottom:8px" onclick="askClaw('Create a new job in FFH system')">+ New Job</button>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Chase all overdue FFH invoices')">Chase Invoices</button>
        <button class="btn btn-outline btn-full" onclick="askClaw('Check for new FFH leads and process them')">Process Leads</button>
      </div>
    </div>`;
}

function renderTide(d) {
  const tideAccounts = (d.hsbcBalance||[]).filter(b => b.account && b.account.toUpperCase().includes('TIDE'));
  const total = tideAccounts.reduce((s,a) => s + (a.current||0), 0);
  return `
    <div class="grid grid-3">
      <div class="card stat bank-card ${tideAccounts.length?'':'disconnected'}">
        <div class="stat-value money">£${total.toFixed(2)}</div>
        <div class="stat-label">Tide (FFH Business)</div>
      </div>
      <div class="card stat">
        <div class="stat-value"><span class="badge ${tideAccounts.length?'green':'amber'}">${tideAccounts.length?'Connected':'Setup Needed'}</span></div>
        <div class="stat-label">Status</div>
      </div>
      <div class="card stat">
        <div class="stat-value"><span class="badge blue">Read Only</span></div>
        <div class="stat-label">Access Level</div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Accounts</span></div>
        ${tideAccounts.length ? tideAccounts.map(a => `<div class="list-item"><span>${esc(a.account)}</span><span class="badge green">£${a.current.toFixed(2)}</span></div>`).join('') : '<div class="empty">Tide not connected via Open Banking yet. Ask Claw to set it up.</div>'}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Quick Actions</span></div>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Show my Tide transactions from the last 7 days')">Recent Transactions</button>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Analyse FFH Tide spending this month')">Monthly Analysis</button>
        <button class="btn btn-outline btn-full" onclick="askClaw('Connect Tide via TrueLayer Open Banking')">Connect Tide</button>
      </div>
    </div>`;
}

function renderComputer(d) {
  const vnc = d.vncPort;
  const container = d.container || {};
  return `
    <div class="grid grid-3">
      <div class="card stat"><div class="stat-value"><span class="badge ${container.running?'green':'red'}">${container.running?'Running':'Stopped'}</span></div><div class="stat-label">Container</div></div>
      <div class="card stat"><div class="stat-value">${vnc||'N/A'}</div><div class="stat-label">VNC Port</div></div>
      <div class="card stat"><div class="stat-value"><span class="badge blue">Virtual</span></div><div class="stat-label">Desktop</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Claw's Computer</span><span class="badge ${vnc?'green':'amber'}">${vnc?'LIVE':'OFFLINE'}</span></div>
      ${vnc ? `<iframe src="/vnc/?autoconnect=true&resize=scale&port=${vnc}" style="width:100%;height:500px;border:none;border-radius:8px"></iframe>` : '<div class="empty">No active container with VNC. Start an agent task that needs a browser to activate.</div>'}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Quick Actions</span></div>
      <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Take a screenshot of the current screen')">Screenshot</button>
      <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Open LinkedIn in the browser')">Open LinkedIn</button>
      <button class="btn btn-outline btn-full" onclick="askClaw('Browse to Google and search for new housing tenders')">Web Search</button>
    </div>`;
}

function renderBank(name, data, d) {
  const accounts = (d.hsbcBalance||[]).filter(b => {
    if (name==='lloyds') return b.account&&(b.account.toUpperCase().includes('BUSINESS')||b.account.toUpperCase().includes('FIRST FIX'));
    return false;
  });
  const wiseAccounts = name==='wise' ? (d.wiseBalance||[]) : [];
  const isConnected = accounts.length > 0 || wiseAccounts.length > 0;
  const displayName = name==='wise'?'Wise (FFH Business)':name==='lloyds'?'Lloyds Business':'Bank';

  let total = 0;
  if (wiseAccounts.length) total = wiseAccounts.reduce((s,b)=>s+(b.currency==='GBP'?b.balance:0),0);
  else accounts.forEach(a => total += a.current||0);

  return `
    <div class="grid grid-3">
      <div class="card stat bank-card ${isConnected?'':'disconnected'}">
        <div class="stat-value money">£${total.toFixed(2)}</div>
        <div class="stat-label">${displayName}</div>
      </div>
      <div class="card stat">
        <div class="stat-value"><span class="badge ${isConnected?'green':'red'}">${isConnected?'Connected':'Setup Needed'}</span></div>
        <div class="stat-label">Status</div>
      </div>
      <div class="card stat">
        <div class="stat-value"><span class="badge blue">Read Only</span></div>
        <div class="stat-label">Access Level</div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Accounts</span></div>
        ${wiseAccounts.length ? wiseAccounts.map(a=>`<div class="list-item"><span>${esc(a.name||'Main Account')} (${a.currency})</span><span class="badge green">£${a.balance.toFixed(2)}</span></div>`).join('') : ''}
        ${accounts.map(a=>`<div class="list-item"><span>${esc(a.account)}</span><span class="badge green">£${a.current.toFixed(2)}</span></div>`).join('')}
        ${!isConnected ? '<div class="empty">Not connected yet</div>' : ''}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Quick Actions</span></div>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Show my ${displayName} transactions from the last 7 days')">Recent Transactions</button>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Analyse my ${displayName} spending this month')">Monthly Analysis</button>
        <button class="btn btn-outline btn-full" onclick="askClaw('Any unusual transactions on ${displayName}?')">Flag Anomalies</button>
      </div>
    </div>
    ${d.financialSummary ? `<div class="card" style="margin-top:16px"><div class="card-header"><span class="card-title">Financial Summary</span></div><div style="font-size:12px;line-height:1.8;white-space:pre-wrap">${esc(d.financialSummary).slice(0,2000)}</div></div>` : ''}`;
}

function renderTrading(d) {
  const a = d.alpacaAccount;
  const pv = a ? parseFloat(a.portfolio_value||0) : 0;
  const cash = a ? parseFloat(a.cash||0) : 0;
  return `
    <div class="grid grid-4">
      <div class="card stat"><div class="stat-value money">$${pv.toFixed(2)}</div><div class="stat-label">Portfolio Value</div></div>
      <div class="card stat"><div class="stat-value">$${cash.toFixed(2)}</div><div class="stat-label">Cash Available</div></div>
      <div class="card stat"><div class="stat-value"><span class="badge green">18/18</span></div><div class="stat-label">Rule Tests</div></div>
      <div class="card stat"><div class="stat-value"><span class="badge green">Shariah</span></div><div class="stat-label">Compliant</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Alpaca (Paper Trading)</span><span class="badge ${a?'green':'red'}">${a?'Connected':'Offline'}</span></div>
        ${a ? `<div class="list-item"><span>Buying Power</span><span>$${parseFloat(a.buying_power||0).toFixed(2)}</span></div><div class="list-item"><span>Equity</span><span>$${parseFloat(a.equity||0).toFixed(2)}</span></div><div class="list-item"><span>Status</span><span class="badge green">${a.status||'?'}</span></div>` : '<div class="empty">Not connected</div>'}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Quick Actions</span></div>
        <button class="btn btn-gold btn-full" style="margin-bottom:8px" onclick="askClaw('Get a shariah-compliant trade idea for today')">Get Trade Idea</button>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Show my Alpaca positions and P&L')">View Positions</button>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('What is the price of BTC right now on Crypto.com?')">Check Crypto Prices</button>
        <button class="btn btn-outline btn-full" onclick="askClaw('Run portfolio review with risk monitor')">Risk Review</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Open Positions</span></div>
      ${d.positionsCurrent && d.positionsCurrent.trim() ? `<div style="font-size:12px;white-space:pre-wrap">${esc(d.positionsCurrent)}</div>` : '<div class="empty">No open positions. Ask Claw for a trade idea to get started.</div>'}
    </div>`;
}

function renderEmails(d) {
  return `
    <div class="grid grid-3">
      <div class="card stat"><div class="stat-value"><span class="badge green">Live</span></div><div class="stat-label">support@</div></div>
      <div class="card stat"><div class="stat-value"><span class="badge green">Live</span></div><div class="stat-label">steffan.smart@</div></div>
      <div class="card stat"><div class="stat-value">0</div><div class="stat-label">Follow-Ups Due</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Actions</span></div>
        <button class="btn btn-gold btn-full" style="margin-bottom:8px" onclick="askClaw('Check both email inboxes for anything new')">Check Emails Now</button>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Find newsletters and junk I should unsubscribe from')">Find Unsubscribes</button>
        <button class="btn btn-outline btn-full" onclick="askClaw('Draft a follow-up for my most recent unanswered email')">Draft Follow-Up</button>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Email Cleanup</span></div>
        <div class="empty">Click "Find Unsubscribes" to scan for junk mail. Results appear here with keep/delete options.</div>
      </div>
    </div>`;
}

function renderConstruction(d) {
  return `
    <div class="grid grid-4">
      <div class="card stat"><div class="stat-value">7,184</div><div class="stat-label">CWICR UK Items</div></div>
      <div class="card stat"><div class="stat-value">3,083</div><div class="stat-label">v7.2 SOR Rates</div></div>
      <div class="card stat"><div class="stat-value">3,580</div><div class="stat-label">v8 SOR Rates</div></div>
      <div class="card stat"><div class="stat-value">81</div><div class="stat-label">DDC Skills</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Quick Actions</span></div>
        <button class="btn btn-gold btn-full" style="margin-bottom:8px" onclick="askClaw('Generate a sample BOQ for a 2-bed damp treatment')">Generate BOQ</button>
        <button class="btn btn-outline btn-full" style="margin-bottom:8px" onclick="askClaw('Compare v7.2+15% vs v8 rates for plumbing')">Compare Rates</button>
        <button class="btn btn-outline btn-full" onclick="askClaw('Search for new UK housing association tenders')">Find Tenders</button>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">SOR Analysis</span></div>
        ${d.sorAnalysis ? `<div style="font-size:12px;line-height:1.7;max-height:300px;overflow:auto;white-space:pre-wrap">${esc(d.sorAnalysis).slice(0,1500)}</div>` : '<div class="empty">Upload SOR documents for analysis</div>'}
      </div>
    </div>`;
}

function renderHiba(d) {
  return `
    <div class="grid grid-4">
      <div class="card stat"><div class="stat-value"><span class="badge amber">Pre-launch</span></div><div class="stat-label">Status</div></div>
      <div class="card stat"><div class="stat-value">3 Apps</div><div class="stat-label">Platform</div></div>
      <div class="card stat"><div class="stat-value">Marrakech</div><div class="stat-label">Market</div></div>
      <div class="card stat"><div class="stat-value">20.13 MAD</div><div class="stat-label">GP/Order Target</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Launch Readiness</span></div>
        <button class="btn btn-gold btn-full" style="margin-bottom:8px" onclick="askClaw('What is Hiba launch status? Check Supabase for restaurants and orders')">Check Status</button>
        <button class="btn btn-outline btn-full" onclick="askClaw('Search for Marrakech food delivery market updates')">Market Intel</button>
      </div>
      <div class="card"><div class="card-header"><span class="card-title">Metrics</span></div><div class="empty">Connect Supabase for live metrics</div></div>
    </div>`;
}

function renderChat(d) {
  const msgs = (d.messages||[]).slice(0,25).reverse();
  return `
    <div class="chat-wrap">
      <div class="chat-messages" id="chat-messages">
        ${msgs.map(m => {
          const cls = m.is_from_me ? 'me' : 'them';
          const t = new Date(m.timestamp).toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit'});
          return `<div class="chat-bubble ${cls}"><div class="bubble">${esc(m.content||'')}</div><div class="bubble-meta">${esc(m.sender_name||'')} · ${t}</div></div>`;
        }).join('')}
      </div>
      <div class="chat-input">
        <input id="chat-in" placeholder="Message Claw..." onkeydown="if(event.key==='Enter')sendChat()">
        <button class="btn btn-primary" onclick="sendChat()">Send</button>
      </div>
    </div>`;
}

function renderAgents() {
  const groups = [
    { name:'Trading', agents:['trading-strategist','risk-monitor','executioner','contrarian-suggester','proactive-reporter'] },
    { name:'Construction QS', agents:['qs-pricing-boq','qs-tender-compiler','qs-quantity-takeoff','qs-cost-validator','construction-estimator'] },
    { name:'Financial', agents:['fin-transaction-analyzer','fin-budget-advisor','fin-cashflow-forecaster','fin-risk-detector','fin-reporter'] },
    { name:'System', agents:['continuous-learner','system-doctor','email-manager'] },
  ];
  return `<div class="grid grid-2">${groups.map(g => `
    <div class="card">
      <div class="card-header"><span class="card-title">${g.name}</span><span class="badge green">${g.agents.length} active</span></div>
      ${g.agents.map(a => `<div class="list-item"><span>${a}</span><span class="badge green">On</span></div>`).join('')}
    </div>`).join('')}</div>`;
}

function renderSchedule(tasks) {
  const sm = {'0 6 * * 1':'Mon 6am','0 7,19 * * *':'7am + 7pm','0 8 * * *':'8:00am','0 * * * *':'Hourly','0 */4 * * *':'4-hourly','0 22 * * *':'10:00pm','0 23 * * *':'11:00pm','0 20 * * 0':'Sun 8pm'};
  if (!tasks.length) return '<div class="empty">No scheduled tasks</div>';
  return tasks.map(t => {
    const label = t.prompt.replace(/^\[.*?\]\s*/,'').slice(0,100);
    const time = sm[t.schedule_value] || t.schedule_value;
    return `<div class="sched-item"><span class="sched-time">${esc(time)}</span><span>${esc(label)}</span></div>`;
  }).join('');
}

function renderTaskList(lines) {
  if (!lines.length) return '<div class="empty">No tasks yet</div>';
  return lines.map((l,i) => {
    const done = l.includes('[x]') || l.includes('[X]');
    const txt = l.replace(/^-\s*\[.\]\s*/,'').trim();
    const pr = txt.match(/^\(([^)]+)\)/);
    const priority = pr ? pr[1].toUpperCase() : 'MED';
    const cls = priority==='HIGH'?'red':priority==='LOW'?'green':'amber';
    const clean = txt.replace(/^\([^)]+\)\s*/,'').replace(/['"]/g,'');
    return `<div class="list-item${done?' done':''}">
      <input type="checkbox" ${done?'checked':''} onchange="askClaw('${this.checked?'Mark done':'Reopen'}: ${esc(clean).slice(0,50)}')">
      <span class="badge ${cls}" style="flex-shrink:0">${priority}</span>
      <span style="flex:1">${esc(clean)}</span>
      <button class="btn btn-outline btn-sm" onclick="askClaw('Action on: ${esc(clean).slice(0,50)}')">Action</button>
    </div>`;
  }).join('');
}

// ===== MAIN RENDER =====

function render() {
  const d = DATA;
  const c = $('#content');
  const titles = { home:'Overview', ffh:'FFH London', 'ffh-mgmt':'FFH Management', hiba:'Hiba', wise:'Wise', lloyds:'Lloyds Business', tide:'Tide (FFH)', trading:'Trading', emails:'Emails', construction:'QS Swarm', chat:'Talk to Claw', agents:'Agent Swarm', schedule:'Schedule', computer:'Claw Computer' };
  $('#page-title').textContent = titles[currentPage] || currentPage;

  try {
    switch(currentPage) {
      case 'home': c.innerHTML = renderHome(d); break;
      case 'ffh': c.innerHTML = renderFFH(d); break;
      case 'ffh-mgmt': c.innerHTML = renderFFHMgmt(d); break;
      case 'hiba': c.innerHTML = renderHiba(d); break;
      case 'wise': c.innerHTML = renderBank('wise', null, d); break;
      case 'lloyds': c.innerHTML = renderBank('lloyds', null, d); break;
      case 'tide': c.innerHTML = renderTide(d); break;
      case 'trading': c.innerHTML = renderTrading(d); break;
      case 'emails': c.innerHTML = renderEmails(d); break;
      case 'construction': c.innerHTML = renderConstruction(d); break;
      case 'chat': c.innerHTML = renderChat(d); setTimeout(()=>{const cm=$('#chat-messages');if(cm)cm.scrollTop=cm.scrollHeight},100); break;
      case 'agents': c.innerHTML = renderAgents(); break;
      case 'schedule': c.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">Automated Schedule</span></div>${renderSchedule(d.tasks||[])}</div>`; break;
      case 'computer': c.innerHTML = renderComputer(d); break;
      default: c.innerHTML = '<div class="empty">Page not found</div>';
    }
  } catch(e) {
    c.innerHTML = `<div class="card"><div class="empty">Error rendering page: ${e.message}</div></div>`;
    console.error(e);
  }
}

async function sendChat() {
  const input = $('#chat-in');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const cm = $('#chat-messages');
  if (cm) { cm.innerHTML += `<div class="chat-bubble me"><div class="bubble">${esc(text)}</div><div class="bubble-meta">You · now</div></div>`; cm.scrollTop = cm.scrollHeight; }
  await fetch('/api/send', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text}) });
  toast('Sent to Claw');
  setTimeout(loadData, 5000);
}

async function loadData() {
  try {
    const r = await fetch('/api/data');
    DATA = await r.json();
    render();
    const el = document.getElementById('last-updated');
    if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  } catch(e) { console.error('Load failed:', e); }
}

// Init
loadData();
setInterval(loadData, 30000);
