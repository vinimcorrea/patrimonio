import { deriveKey, openWithKey } from './vault.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const prefs = JSON.parse(localStorage.getItem('prefs') || '{}');
const save = () => localStorage.setItem('prefs', JSON.stringify(prefs));
prefs.cur ||= 'EUR';
prefs.view ||= 'home';
prefs.range ||= '1M';
prefs.profile ||= 'neutro';

const COLORS = { BTC: '#f7931a', ETH: '#8c8cf7', AAVE: '#b6509e', AERO: '#2f6bff', SOL: '#14f195', OURO: '#e5c45a', CAIXA: '#2fd08a', OUTROS: '#6b7489', ETF: '#38bdf8', TRCRYPTO: '#f5b04a', TRCASH: '#cbd5e1', BOND: '#c08cff' };
const LABEL = { CAIXA: 'Caixa (stables)', OUTROS: 'Outros', ETF: 'Ações/ETFs', TRCRYPTO: 'Cripto (TR)', TRCASH: 'Fundo de emergência', BOND: 'Títulos' };
const color = (k) => COLORS[k] || `hsl(${[...k].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 55% 60%)`;
let D = null;
const shortName = (n) => String(n || '').replace(/\s*UCITS.*$/i, '').trim();

let toastT;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.className = ''), 2600);
}

/* ---------- key storage (non-extractable CryptoKey in IndexedDB) ---------- */
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('patrimonio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', mode);
      const q = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(q?.result);
      tx.onerror = () => rej(tx.error);
    };
  });
}
const getKey = () => idb('readonly', (s) => s.get('key')).catch(() => null);
const putKey = (v) => idb('readwrite', (s) => s.put(v, 'key'));
const dropKey = () => idb('readwrite', (s) => s.delete('key'));

async function fetchBox() {
  const res = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' }).catch(() => fetch('data.json'));
  if (!res.ok) throw new Error('Sem dados publicados ainda');
  return res.json();
}

async function boot() {
  registerSW();
  const stored = await getKey();
  if (stored) {
    try {
      const box = await fetchBox();
      if (box.salt === stored.salt) {
        D = await openWithKey(box, stored.key);
        return show();
      }
    } catch {}
  }
  $('#boot').remove();
  $('#lock').style.display = 'flex';
  $('#pw').focus();
}

$('#lockform').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#unlock');
  btn.disabled = true;
  btn.textContent = 'Abrindo…';
  $('#err').textContent = '';
  try {
    const box = await fetchBox();
    const key = await deriveKey($('#pw').value, box.salt, box.iterations);
    D = await openWithKey(box, key).catch(() => {
      throw new Error('Senha incorreta');
    });
    if ($('#remember').checked) await putKey({ key, salt: box.salt });
    $('#pw').value = '';
    show();
  } catch (err) {
    $('#err').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Abrir';
  }
});

async function reload(manual) {
  const btn = $('#refresh');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.querySelector('svg')?.classList.add('spin');
  try {
    const stored = await getKey();
    const box = await fetchBox();
    if (stored?.salt === box.salt) D = await openWithKey(box, stored.key);
    render();
    if (manual) toast(`Atualizado ${ago(D.updatedAt)}`);
  } catch {
    if (manual) toast('Sem conexão. Mostrando os últimos dados.', true);
  }
  btn.disabled = false;
  $('#refresh svg')?.classList.remove('spin');
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}


/* ---------- icons (Lucide-style, 24px stroke) ---------- */
const PATH = {
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  tUp: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  tDown: '<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  tFlat: '<path d="M5 12h14M15 8l4 4-4 4"/>',
  dot: '<circle cx="12" cy="12" r="2.5" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
};
const ic = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATH[n]}</svg>`;

/* ---------- formatting ---------- */
const rate = () => D.fx[prefs.cur] || 1;
const SYM = { EUR: '€', USD: 'US$', BRL: 'R$' };
function money(eur, { dec, sign } = {}) {
  if (eur == null || Number.isNaN(eur)) return '—';
  const v = eur * rate();
  const d = dec ?? (Math.abs(v) >= 1000 ? 0 : 2);
  const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pre = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return `<span class="num v">${pre}${SYM[prefs.cur]} ${s}</span>`;
}
const pct = (p, d = 1, sign = true) =>
  p == null || !isFinite(p) ? '—' : `${sign && p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'dn' : 'mut');
const qty = (n) => (n == null ? '' : n.toLocaleString('pt-BR', { maximumFractionDigits: n < 1 ? 6 : n < 100 ? 4 : 2 }));
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : '—');

function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  if (m < 48 * 60) return `há ${Math.round(m / 60)} h`;
  return `há ${Math.round(m / 1440)} dias`;
}
const chainName = (c) => ({ base: 'Base', ethereum: 'Ethereum', arbitrum: 'Arbitrum', optimism: 'Optimism', polygon: 'Polygon', 'binance-smart-chain': 'BNB' })[c] || c;

/* ---------- derived numbers ---------- */
function totals() {
  const c = D.crypto || {};
  const t = D.tr || {};
  return { crypto: c.net || 0, cryptoAssets: c.assets || 0, debt: c.debt || 0, tr: t.total || 0, net: (c.net || 0) + (t.total || 0) };
}

function allocation() {
  const parts = {};
  const add = (k, v) => v > 0 && (parts[k] = (parts[k] || 0) + v);
  const w = D.strategy?.analysis?.weights;
  if (w && D.crypto) for (const [k, p] of Object.entries(w)) add(k, (p / 100) * D.crypto.assets);
  else if (D.crypto) add('OUTROS', D.crypto.assets);
  for (const p of D.tr?.positions || []) add(p.kind === 'crypto' ? 'TRCRYPTO' : p.kind === 'bond' ? 'BOND' : 'ETF', p.value || 0);
  add('TRCASH', D.tr?.cash || 0);
  const sum = Object.values(parts).reduce((a, b) => a + b, 0);
  return Object.entries(parts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ k, v, p: (v / sum) * 100 }));
}

function changeSince(ms) {
  const h = D.history || [];
  if (h.length < 2) return null;
  const cut = Date.now() - ms;
  const base = [...h].reverse().find((p) => Date.parse(p.t) <= cut) || h[0];
  const now = h.at(-1);
  if (base === now || !base.net) return null;
  return { abs: now.net - base.net, p: ((now.net - base.net) / base.net) * 100 };
}

/* ---------- components ---------- */
function stackBar(items) {
  return `<div class="bar">${items.map((i) => `<i style="width:${i.p}%;background:${color(i.k)}"></i>`).join('')}</div>
  <div class="legend">${items.map((i) => `<span><span class="dot" style="background:${color(i.k)}"></span>${esc(LABEL[i.k] || i.k)} <span class="mut num">${pct(i.p, 0, false)}</span></span>`).join('')}</div>`;
}

function hfColor(hf) {
  return hf == null ? 'var(--up)' : hf < 1.6 ? 'var(--dn)' : hf < 2 ? 'var(--warn)' : 'var(--up)';
}

function gauge(hf) {
  const max = 4;
  const v = hf == null ? max : Math.min(hf, max);
  const a = Math.PI * (1 - v / max);
  const x = 60 + 48 * Math.cos(a);
  const y = 60 - 48 * Math.sin(a);
  const arc = (from, to, c) => {
    const p = (t) => [60 + 48 * Math.cos(Math.PI * (1 - t / max)), 60 - 48 * Math.sin(Math.PI * (1 - t / max))];
    const [x1, y1] = p(from);
    const [x2, y2] = p(to);
    return `<path d="M${x1} ${y1}A48 48 0 0 1 ${x2} ${y2}" stroke="${c}" stroke-width="10" fill="none" opacity=".35"/>`;
  };
  return `<svg viewBox="0 0 120 84">${arc(1, 1.6, '#ff6b6b')}${arc(1.6, 2, '#ffb547')}${arc(2, 4, '#2fd08a')}${arc(0, 1, '#ff6b6b')}
    <line x1="60" y1="60" x2="${x}" y2="${y}" stroke="${hfColor(hf)}" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="60" r="4" fill="${hfColor(hf)}"/>
    <text x="60" y="82" text-anchor="middle" font-size="16" font-weight="700" fill="${hfColor(hf)}">${hf == null ? '∞' : hf.toFixed(2)}</text></svg>`;
}

function aaveCard(full) {
  const list = (D.crypto?.aave || []).filter((a) => a.debt > 0 || a.collateral > 0);
  if (!list.length) return '';
  const limit = D.strategy?.analysis?.profiles?.find((p) => p.name === prefs.profile)?.emprestimoMaxPct;
  return list
    .map((a) => {
      const ltv = a.collateral ? (a.debt / a.collateral) * 100 : 0;
      const bad = a.hf != null && a.hf < 1.6;
      const low = a.hf != null && a.hf < 2;
      return `<div class="card ${bad ? 'alert bad' : low ? 'alert' : ''}">
      <h3>Aave · ${esc(chainName(a.chain))}<span class="small mut">liquida em HF 1.0</span></h3>
      <div class="gauge">${gauge(a.hf)}<div style="flex:1">
        <div class="small mut">Saúde (health factor)</div>
        <div style="font-weight:600;color:${hfColor(a.hf)}">${a.hf == null ? 'Sem dívida' : a.hf < 1.6 ? 'Crítica' : a.hf < 2 ? 'Atenção' : 'Saudável'}</div>
        <div class="small mut" style="margin-top:6px">Empréstimo: <b class="num" style="color:var(--tx)">${pct(ltv, 1, false)}</b> da garantia${limit != null ? ` · limite ${esc(prefs.profile)} ${limit}%` : ''}</div>
        <div class="ltv"><i style="width:${Math.min(ltv, 100)}%;background:${limit != null && ltv > limit ? 'var(--warn)' : 'var(--acc)'}"></i>${limit != null ? `<u style="left:${limit}%"></u>` : ''}</div>
      </div></div>
      ${full ? `<div class="grid2" style="margin-top:12px">
        <div class="kv"><span class="small mut">Garantia</span><b>${money(a.collateral)}</b></div>
        <div class="kv"><span class="small mut">Dívida</span><b>${money(a.debt)}</b></div>
        <div class="kv"><span class="small mut">Pode pegar</span><b>${money(a.available)}</b></div>
        <div class="kv"><span class="small mut">Queda até liquidar</span><b class="num">${a.hf ? pct((1 - 1 / a.hf) * 100, 0, false) : '—'}</b></div>
      </div>` : ''}
    </div>`;
    })
    .join('');
}

/* ---------- chart ---------- */
const RANGES = { '1S': 7, '1M': 30, '3M': 90, '1A': 365, Tudo: 1e5 };
function chart() {
  const h = (D.history || []).filter((p) => Date.parse(p.t) >= Date.now() - RANGES[prefs.range] * 864e5);
  const tabs = `<div class="seg" id="ranges">${Object.keys(RANGES).map((r) => `<button data-r="${r}" class="${r === prefs.range ? 'on' : ''}">${r}</button>`).join('')}</div>`;
  if (h.length < 2)
    return `<div class="card"><h3>Evolução ${tabs}</h3><div class="empty">O gráfico aparece depois de algumas atualizações (o app salva um ponto a cada sincronização).</div></div>`;
  const W = 600, H = 190, P = 6;
  const t0 = Date.parse(h[0].t), t1 = Date.parse(h.at(-1).t);
  const ys = h.map((p) => p.net);
  const btc = prefs.btc && h[0].btc ? h.map((p) => (p.btc ? (p.btc / h[0].btc) * h[0].net : null)) : [];
  const all = [...ys, ...btc.filter(Boolean)];
  const lo = Math.min(...all), hi = Math.max(...all);
  const X = (t) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const Y = (v) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P - 10);
  const line = (vals) => vals.map((v, i) => (v == null ? '' : `${i && vals[i - 1] != null ? 'L' : 'M'}${X(Date.parse(h[i].t)).toFixed(1)} ${Y(v).toFixed(1)}`)).join('');
  const up = ys.at(-1) >= ys[0];
  const c = up ? '#2fd08a' : '#ff6b6b';
  const d = line(ys);
  const delta = ys.at(-1) - ys[0];
  return `<div class="card"><h3>Evolução ${tabs}</h3>
    <div class="chart-tip" id="tip"><span class="${cls(delta)}">${money(delta, { sign: true })} (${pct((delta / ys[0]) * 100)})</span> <span class="mut small">no período</span></div>
    <svg class="chart" id="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d}L${X(t1)} ${H}L${X(t0)} ${H}Z" fill="url(#g)"/>
      ${btc.length ? `<path d="${line(btc)}" stroke="#f7931a" stroke-width="1.5" fill="none" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>` : ''}
      <path d="${d}" stroke="${c}" stroke-width="2.2" fill="none" vector-effect="non-scaling-stroke"/>
      <line id="cur-x" y1="0" y2="${H}" stroke="#fff3" vector-effect="non-scaling-stroke" style="display:none"/>
    </svg>
    <label class="chk" style="justify-content:flex-start;margin-top:8px"><input type="checkbox" id="btc" ${prefs.btc ? 'checked' : ''}> Comparar com BTC <span class="dot" style="background:#f7931a;margin-left:4px"></span></label>
  </div>`;
}

function bindChart() {
  $('#ranges')?.addEventListener('click', (e) => {
    const r = e.target.closest('button')?.dataset.r;
    if (r) (prefs.range = r), save(), render();
  });
  $('#btc')?.addEventListener('change', (e) => ((prefs.btc = e.target.checked), save(), render()));
  const svg = $('#chart');
  if (!svg) return;
  const h = (D.history || []).filter((p) => Date.parse(p.t) >= Date.now() - RANGES[prefs.range] * 864e5);
  const tip = $('#tip');
  const orig = tip.innerHTML;
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.touches?.[0] || ev).clientX - r.left) / r.width;
    const p = h[Math.max(0, Math.min(h.length - 1, Math.round(x * (h.length - 1))))];
    const line = $('#cur-x');
    const t0 = Date.parse(h[0].t), t1 = Date.parse(h.at(-1).t);
    const px = 6 + ((Date.parse(p.t) - t0) / (t1 - t0 || 1)) * 588;
    line.setAttribute('x1', px);
    line.setAttribute('x2', px);
    line.style.display = '';
    tip.innerHTML = `<b>${money(p.net)}</b> <span class="mut small">${new Date(p.t).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>`;
  };
  const end = () => {
    tip.innerHTML = orig;
    $('#cur-x').style.display = 'none';
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('pointerleave', end);
  svg.addEventListener('touchend', end);
}

/* ---------- views ---------- */
function statusLine() {
  const bits = [`Atualizado ${ago(D.updatedAt)}`];
  if (D.crypto?.stale) bits.push('<span class="warn">cripto desatualizado</span>');
  const tr = D.tr?.status;
  if (tr === 'error') bits.push(`<span class="warn">Trade Republic: não consegui ler o extrato${D.tr.statementTo ? `, mostrando o de ${dmy(D.tr.statementTo)}` : ''}</span>`);
  else if (tr === 'ok') bits.push(`Trade Republic: extrato até ${dmy(D.tr.statementTo)}${D.tr.priceAt ? `, cotações ${ago(D.tr.priceAt)}` : ''}`);
  else bits.push('Trade Republic sem extrato');
  return `<p class="note" style="text-align:center">${bits.join(' · ')}<br><button class="forget small mut" style="margin-top:4px;min-height:44px;padding:0 12px;text-decoration:underline">Bloquear e esquecer a senha neste aparelho</button></p>`;
}

function home() {
  const t = totals();
  const d1 = changeSince(864e5);
  const d30 = changeSince(30 * 864e5);
  const inc = D.tr?.income;
  const a = allocation();
  return `<div class="card hero">
      <div class="small mut">Patrimônio líquido</div>
      <div class="big">${money(t.net, { dec: 0 })}</div>
      <div class="chips">
        ${d1 ? `<span class="chip ${cls(d1.abs)}">24h ${pct(d1.p)}</span>` : ''}
        ${d30 ? `<span class="chip ${cls(d30.abs)}">30d ${pct(d30.p)}</span>` : ''}
      </div>
      ${stackBar(a)}
      <div class="grid2" style="margin-top:14px">
        <div class="kv"><span class="small mut">Cripto (líquido)</span><b>${money(t.crypto, { dec: 0 })}</b></div>
        <div class="kv"><span class="small mut">Trade Republic</span><b>${D.tr?.total != null ? money(t.tr, { dec: 0 }) : '<span class="mut">—</span>'}</b></div>
      </div>
    </div>
    ${chart()}
    ${aaveCard(false)}
    ${planTeaser()}
    ${inc || D.cryptoYield ? `<div class="card"><h3>Rendimentos</h3><div class="grid2">
      ${inc ? `<div class="kv"><span class="small mut">Juros TR · 12 meses</span><b class="up">${money(inc.interest)}</b></div>
      <div class="kv"><span class="small mut">Dividendos · 12 meses</span><b class="up">${money(inc.dividends)}</b></div>` : ''}
      ${D.cryptoYield ? `<div class="kv"><span class="small mut">Juros cripto · por ano</span><b class="${cls(D.cryptoYield.year)}">${money(D.cryptoYield.year, { sign: true })}</b></div>` : ''}
      ${D.tr?.pnl != null ? `<div class="kv"><span class="small mut">Valorização TR</span><b class="${cls(D.tr.pnl)}">${money(D.tr.pnl, { sign: true })}</b></div>` : ''}
    </div>${D.cryptoYield ? '<p class="note">Juros cripto = o que os depósitos na Aave rendem menos o custo da dívida, pelas taxas de hoje.</p>' : ''}</div>` : ''}
    ${statusLine()}`;
}

function planTeaser() {
  const P = monthlyPlan();
  const score = D.strategy?.analysis?.profiles?.find((p) => p.name === prefs.profile)?.score;
  const month = new Date().toLocaleString('pt-BR', { month: 'long' });
  const split = [P.etf > 0 && `${money(P.etf, { dec: 0 })} em ETF`, P.crypto > 0 && `${money(P.crypto, { dec: 0 })} em cripto`].filter(Boolean).join(' + ');
  return `<button class="card teaser" data-go="strategy">
    <span class="l"><span class="small mut">Plano de ${esc(month)}</span><b>${split || 'Sem aporte definido'}</b>
    ${score != null ? `<span class="small mut">Aderência ao perfil ${esc(prefs.profile)}: <span class="${score >= 85 ? 'up' : score >= 65 ? 'warn' : 'dn'}">${score}%</span></span>` : ''}</span>
    <svg class="i mut" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
  </button>`;
}

function tokenIcon(t) {
  return `<div class="tok">${t.icon ? `<img src="${esc(t.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${t.icon ? '' : esc(String(t.symbol).slice(0, 4))}</div>`;
}

function yieldCard() {
  const y = D.cryptoYield;
  if (!y?.items?.length) return '';
  const rows = y.items
    .slice()
    .sort((a, b) => b.year - a.year)
    .map(
      (i) => `<div class="row"><div class="l"><div>${esc(i.symbol)}<span class="badge">${i.type === 'loan' ? 'dívida' : 'depósito'}</span></div>
      <div class="small mut">Aave · ${esc(chainName(i.chain))} · ${money(Math.abs(i.value), { dec: 0 })} a <span class="${cls(i.apy)}">${pct(i.apy, 2)}</span> a.a.</div></div>
      <div class="r"><div class="${cls(i.year)}">${money(i.year / 12, { sign: true })}<span class="small mut">/mês</span></div></div></div>`,
    )
    .join('');
  return `<div class="card"><h3>Rendimentos cripto <span class="small mut">taxas de ${ago(y.at)}</span></h3>
    <div class="grid2">
      <div class="kv"><span class="small mut">Líquido por mês</span><b class="${cls(y.year)}">${money(y.year / 12, { sign: true })}</b></div>
      <div class="kv"><span class="small mut">Líquido por ano</span><b class="${cls(y.year)}">${money(y.year, { sign: true })}</b></div>
      <div class="kv"><span class="small mut">Ganha (depósitos)</span><b class="up">${money(y.earn, { sign: true })}<span class="small mut">/ano</span></b></div>
      <div class="kv"><span class="small mut">Paga (dívida)</span><b class="dn">${money(-y.cost)}<span class="small mut">/ano</span></b></div>
    </div>
    <p class="note">Rende ${pct(y.apyOnNet, 2)} a.a. sobre o patrimônio cripto líquido. Já rendeu ~${money(y.acc, { sign: true })} desde ${dmy(y.since)} (estimado pelas taxas). Fora isso, o resultado vem da variação de preço dos tokens.</p>
    ${rows}</div>`;
}

function cryptoView() {
  const c = D.crypto;
  if (!c) return `<div class="card empty">Carteira cripto não configurada.</div>`;
  const TYPE = { wallet: 'carteira', deposit: 'depósito', loan: 'dívida', staked: 'stake', reward: 'recompensa', locked: 'travado' };
  const rows = c.tokens
    .map(
      (t) => `<div class="row">${tokenIcon(t)}
      <div class="l"><div>${esc(t.symbol)}<span class="badge">${esc(TYPE[t.type] || t.type)}</span></div>
        <div class="small mut">${esc(chainName(t.chain))}${t.protocol ? ' · ' + esc(t.protocol) : ''} · <span class="num v">${qty(t.qty)}</span>${t.apy != null ? ` · <span class="${cls(t.apy)}">${pct(t.apy, 2, false)} a.a.</span>` : ''}</div></div>
      <div class="r"><div class="${t.value < 0 ? 'dn' : ''}">${money(t.value)}</div>
        <div class="small ${cls(t.change1d)}">${t.change1d != null && t.type !== 'loan' ? pct(t.change1d) : ''}</div></div></div>`,
    )
    .join('');
  return `<div class="card hero"><div class="small mut">Cripto · líquido</div><div class="big">${money(c.net, { dec: 0 })}</div>
      <div class="grid2" style="margin-top:12px"><div class="kv"><span class="small mut">Ativos</span><b>${money(c.assets, { dec: 0 })}</b></div>
      <div class="kv"><span class="small mut">Dívidas</span><b class="dn">${money(-c.debt, { dec: 0 })}</b></div></div></div>
    ${yieldCard()}
    ${aaveCard(true)}
    <div class="card"><h3>Posições <span class="small mut">${c.tokens.length}</span></h3>${rows || '<div class="empty">Sem posições</div>'}</div>
    ${statusLine()}`;
}

function monthly(flows) {
  const by = {};
  for (const f of flows) if (f.kind === 'interest' || f.kind === 'dividend') by[f.t.slice(0, 7)] = (by[f.t.slice(0, 7)] || 0) + f.value;
  const months = Object.keys(by).sort().slice(-12);
  if (!months.length) return '';
  const max = Math.max(...months.map((m) => by[m]));
  return `<div style="display:flex;align-items:flex-end;gap:4px;height:96px;margin-top:14px" aria-label="Juros e dividendos por mês">${months
    .map(
      (m) => `<div style="flex:1;max-width:44px;text-align:center"><div class="small up num" style="font-size:10px;margin-bottom:2px">${money(by[m], { dec: 0 })}</div><div style="height:${Math.max(3, (by[m] / max) * 56)}px;background:var(--up);opacity:.75;border-radius:4px 4px 0 0"></div>
      <div class="small mut" style="font-size:10px">${new Date(m + '-15').toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}</div></div>`,
    )
    .join('')}</div>`;
}

function trView() {
  const t = D.tr;
  if (!t || t.status === 'disabled' || !t.positions)
    return `<div class="card"><h3>Trade Republic</h3><div class="empty" style="text-align:left">Envie o extrato em PDF:<br>
      1. App do Trade Republic → Perfil → Extratos → Extrato de conta (período completo).<br>
      2. No GitHub, abra a pasta <b>tr/</b> do repositório → Add file → Upload files.<br>
      Em poucos minutos ele aparece aqui. Os preços são atualizados sozinhos todo dia.</div></div>${statusLine()}`;
  const rows = t.positions
    .map((p) => {
      const pp = p.cost ? (p.pnl / p.cost) * 100 : null;
      return `<div class="row"><div class="tok" style="background:${color(p.kind === 'crypto' ? 'TRCRYPTO' : p.kind === 'bond' ? 'BOND' : 'ETF')}33">${esc(p.name.slice(0, 2).toUpperCase())}</div>
      <div class="l"><div title="${esc(p.name)}">${esc(shortName(p.name))}</div><div class="small mut"><span class="num v">${qty(p.qty)}</span> × ${money(p.price)} · PM ${money(p.avg)}</div></div>
      <div class="r"><div>${money(p.value)}</div><div class="small ${cls(p.pnl)}">${p.pnl != null ? `${money(p.pnl, { sign: true })} · ${pct(pp)}` : ''}</div></div></div>`;
    })
    .join('');
  const pnlPct = t.cost ? (t.pnl / t.cost) * 100 : null;
  const dep = t.flows?.filter((f) => f.kind === 'deposit').reduce((s, f) => s + f.value, 0) || 0;
  const wd = t.flows?.filter((f) => f.kind === 'withdrawal').reduce((s, f) => s + Math.abs(f.value), 0) || 0;
  return `<div class="card hero ${t.status !== 'ok' ? 'alert' : ''}"><div class="small mut">Trade Republic · extrato até ${dmy(t.statementTo)}</div><div class="big">${money(t.total, { dec: 0 })}</div>
      <div class="chips"><span class="chip ${cls(t.pnl)}">${money(t.pnl, { sign: true })} · ${pct(pnlPct)}</span></div>
      <div class="grid2" style="margin-top:12px">
        <div class="kv"><span class="small mut">Investido (mercado)</span><b>${money(t.invested, { dec: 0 })}</b></div>
        <div class="kv"><span class="small mut">Fundo de emergência</span><b>${money(t.cash, { dec: 0 })}</b></div>
      </div></div>
    <div class="card"><h3>Rendimentos · 12 meses</h3><div class="grid2">
      <div class="kv"><span class="small mut">Juros</span><b class="up">${money(t.income?.interest)}</b></div>
      <div class="kv"><span class="small mut">Dividendos</span><b class="up">${money(t.income?.dividends)}</b></div>
      <div class="kv"><span class="small mut">Aportes</span><b>${money(dep)}</b></div>
      <div class="kv"><span class="small mut">Retiradas</span><b>${money(wd)}</b></div></div>${monthly(t.flows || [])}</div>
    <div class="card"><h3>Posições <span class="small mut">${t.positions.length}</span></h3>${rows || '<div class="empty">Sem posições</div>'}</div>
    ${statusLine()}`;
}

function ring(score, on) {
  const c = score >= 85 ? '#2fd08a' : score >= 65 ? '#ffb547' : '#ff6b6b';
  const L = 2 * Math.PI * 26;
  return `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" stroke="#ffffff14" stroke-width="6" fill="none"/>
    <circle cx="32" cy="32" r="26" stroke="${c}" stroke-width="6" fill="none" stroke-linecap="round" stroke-dasharray="${(score / 100) * L} ${L}" transform="rotate(-90 32 32)"/>
    <text x="32" y="37" text-anchor="middle" font-size="15" font-weight="700" fill="${on ? '#fff' : '#cfd5e3'}">${score}%</text></svg>`;
}

function strategyView() {
  const s = D.strategy;
  const a = s?.analysis;
  if (!a) return `${planCard()}<div class="card empty">A aderência aparece quando houver carteira cripto e uma edição do report.</div>`;
  const p = a.profiles.find((x) => x.name === prefs.profile) || a.profiles[1];
  const buckets = [...new Set([...Object.keys(p.alocacao), ...Object.keys(a.weights)])].sort((x, y) => (p.alocacao[y] || 0) - (p.alocacao[x] || 0));
  const bars = buckets
    .map((b) => {
      const act = a.weights[b] || 0;
      const tgt = p.alocacao[b] || 0;
      const off = Math.abs(act - tgt) >= 2;
      return `<div class="alloc"><span>${esc(LABEL[b] || b)}</span>
      <div class="track"><i style="width:${Math.min(act, 100)}%;background:${color(b)}"></i><u style="left:${Math.min(tgt, 100)}%"></u></div>
      <span class="num small" style="text-align:right">${pct(act, 0, false)} <span class="${off ? 'warn' : 'mut'}">/ ${tgt}%</span></span></div>`;
    })
    .join('');
  const changes = p.changes.length
    ? p.changes
        .map(
          (c) => `<li>${c.value > 0 ? ic('up', 'up') : ic('down', 'dn')}<span>${c.value > 0 ? 'Aumentar' : 'Reduzir'} <b>${esc(LABEL[c.bucket] || c.bucket)}</b> em ${money(Math.abs(c.value), { dec: 0 })}
        <span class="mut small">(${pct(c.actual, 0, false)} → ${c.target}%)</span></span></li>`,
        )
        .join('')
    : `<li>${ic('check', 'up')}<span>Alocação dentro do alvo (diferenças menores que 2 p.p.)</span></li>`;
  const checks = p.checks.map((c) => `<li>${c.ok ? ic('check', 'up') : ic('alert', 'warn')}<span>${esc(c.text)}${c.fix ? `<div class="small mut">${esc(c.fix)}</div>` : ''}</span></li>`).join('');
  const rules = [...(p.regras || []), ...(s.rules?.regrasGerais || [])];
  return `${planCard()}<div class="card"><h3>Aderência à estratégia <span class="small mut">${esc(s.title || s.slug || '')}</span></h3>
      <div class="rings">${a.profiles.map((x) => `<button class="ring ${x.name === p.name ? 'on' : ''}" data-p="${esc(x.name)}" aria-pressed="${x.name === p.name}">${ring(x.score, x.name === p.name)}<div>${esc(x.name)}</div></button>`).join('')}</div>
      <p class="note">${esc(p.descricao || '')}</p></div>
    <div class="card"><h3>Atual × alvo <span class="small mut">barra = atual · traço = alvo</span></h3>${bars}
      <p class="note">Considera só a carteira cripto. Empréstimo máximo do perfil: ${p.emprestimoMaxPct}% da garantia.</p></div>
    <div class="card"><h3>O que ajustar</h3><ul class="checks">${changes}</ul></div>
    <div class="card"><h3>Regras</h3><ul class="checks">${checks}${rules.map((r) => `<li>${ic('dot', 'mut')}<span>${esc(r)}</span></li>`).join('')}</ul></div>
    ${statusLine()}`;
}


/* ---------- monthly contribution plan ---------- */
const TREND = { alta: ['tUp', 'Em alta', 1, 'up'], lateral: ['tFlat', 'Lateral', 0, 'warn'], baixa: ['tDown', 'Em baixa', -1, 'dn'] };

function defaultAmount() {
  const dep = {};
  for (const f of D.tr?.flows || []) if (f.kind === 'deposit') dep[f.t.slice(0, 7)] = (dep[f.t.slice(0, 7)] || 0) + f.value;
  const last = Object.keys(dep).sort().slice(-3).map((k) => dep[k]).sort((a, b) => a - b);
  return last.length ? Math.round(last[Math.floor(last.length / 2)] / 25) * 25 : 500;
}

// Rule-based: rebalance toward the chosen crypto share, tilted by trend and sentiment, then fill the
// crypto buckets that are furthest below the report's profile.
function monthlyPlan() {
  const m = D.market || {};
  const amount = prefs.planAmt ?? defaultAmount();
  const base = prefs.planCrypto ?? 40;
  const C = D.crypto?.net || 0;
  const E = D.tr?.invested || 0;
  const why = [];
  const tb = TREND[m.btc?.trend]?.[2] ?? 0;
  const te = TREND[m.etf?.trend]?.[2] ?? 0;
  let tilt = 5 * (tb - te);
  if (tilt > 0) why.push('Bitcoin com tendência melhor que o ETF: mais peso para cripto.');
  if (tilt < 0) why.push('ETF com tendência melhor que o Bitcoin: mais peso para o ETF.');
  const fg = m.fearGreed?.value;
  if (fg != null && fg <= 25) (tilt += 5), why.push(`Medo extremo no mercado cripto (${fg}): historicamente bom momento para acumular aos poucos.`);
  if (fg != null && fg >= 75) (tilt -= 5), why.push(`Ganância extrema no mercado cripto (${fg}): evitar comprar no topo.`);
  tilt = Math.max(-10, Math.min(10, tilt));
  const target = base + tilt;
  const wantC = ((C + E + amount) * target) / 100 - C;
  const crypto = Math.round(Math.max(0, Math.min(amount, wantC)) / 5) * 5;
  const etf = amount - crypto;
  const nowPct = C + E ? (C / (C + E)) * 100 : 0;
  why.unshift(`Hoje cripto é ${pct(nowPct, 0, false)} dos investimentos; a meta deste mês é ${pct(target, 0, false)}${tilt ? ` (${base}% ${tilt > 0 ? '+' : '−'} ${Math.abs(tilt)} p.p. pelo mercado)` : ''}.`);
  if (crypto === 0 && wantC < 0) why.push('Cripto já está acima da meta: o aporte todo vai para o ETF.');
  if (etf === 0 && wantC >= amount) why.push('Cripto está bem abaixo da meta: o aporte todo vai para cripto.');

  const a = D.strategy?.analysis;
  const p = a?.profiles.find((x) => x.name === prefs.profile) || a?.profiles?.[1];
  let buys = [];
  if (crypto > 0 && p) {
    const assets = D.crypto.assets;
    const gap = {};
    for (const [k, t] of Object.entries(p.alocacao)) {
      if (k === 'OUTROS' || !t) continue;
      gap[k] = Math.max(0, (t / 100) * (assets + crypto) - ((a.weights[k] || 0) / 100) * assets);
    }
    const sum = Object.values(gap).reduce((x, y) => x + y, 0);
    const share = sum > 0 ? gap : Object.fromEntries(Object.entries(p.alocacao).filter(([k]) => k !== 'OUTROS'));
    const tot = Object.values(share).reduce((x, y) => x + y, 0);
    buys = Object.entries(share)
      .map(([k, v]) => [k, Math.round(((crypto * v) / tot) / 5) * 5])
      .filter(([, v]) => v >= 10)
      .sort((x, y) => y[1] - x[1]);
  }
  return { amount, base, target, crypto, etf, why, buys, profile: p?.name };
}

function trendChip(label, s) {
  if (!s) return '';
  const [i, txt, , c] = TREND[s.trend] || ['tFlat', s.trend, 0, 'mut'];
  return `<div class="kv"><span class="small mut">${esc(label)}</span><b class="${c} flex">${ic(i)} ${txt}</b>
    <span class="small mut">${pct(s.vsMa200, 0)} vs média 200d · 30d ${pct(s.chg30, 0)}</span></div>`;
}

function planCard() {
  const m = D.market || {};
  const P = monthlyPlan();
  const etfName = D.tr?.positions?.find((x) => x.kind !== 'crypto')?.name ? shortName(D.tr.positions.find((x) => x.kind !== 'crypto').name) : 'ETF';
  const buys = P.buys.map(([k, v]) => `<li>${ic('up', 'up')}<span>Comprar <b>${esc(LABEL[k] || k)}</b>: ${money(v, { dec: 0 })}</span></li>`).join('');
  const month = new Date().toLocaleString('pt-BR', { month: 'long' });
  const cp = P.amount ? (P.crypto / P.amount) * 100 : 0;
  return `<div class="card plan"><h3>Plano do mês <span class="pill">${esc(month)}</span></h3>
    <div class="grid2">
      <label class="kv"><span class="small mut">Valor do aporte (€)</span><input id="planAmt" class="field" type="number" inputmode="decimal" min="0" step="25" value="${P.amount}"></label>
      <label class="kv"><span class="small mut">Meta cripto: <b id="planCv">${P.base}%</b></span><input id="planCrypto" type="range" min="0" max="80" step="5" value="${P.base}"></label>
    </div>
    <div class="split" style="background:${color('ETF')}" role="img" aria-label="Cripto ${Math.round(cp)}%, ETF ${Math.round(100 - cp)}%"><i style="width:${cp}%"></i></div>
    <div class="grid2">
      <div class="kv"><span class="small mut"><i class="dot" style="background:#f7931a"></i>Cripto · ${Math.round(cp)}%</span><b>${money(P.crypto, { dec: 0 })}</b></div>
      <div class="kv"><span class="small mut"><i class="dot" style="background:${color('ETF')}"></i>ETF · ${Math.round(100 - cp)}%</span><b>${money(P.etf, { dec: 0 })}</b></div>
    </div>
    <ul class="checks" style="margin-top:8px">
      ${P.etf > 0 ? `<li>${ic('up', 'up')}<span>Comprar <b>${esc(etfName)}</b>: ${money(P.etf, { dec: 0 })} <span class="small mut">(plano de poupança do TR)</span></span></li>` : ''}
      ${buys}
    </ul>
    ${P.crypto > 0 && P.buys.length ? `<p class="note">Cripto dividido para aproximar a carteira do perfil <b>${esc(P.profile)}</b> do report.</p>` : ''}
    <h3 style="margin-top:18px">Mercado agora</h3>
    <div class="grid2">${trendChip('Bitcoin', m.btc)}${trendChip(m.etf?.name ? shortName(m.etf.name) : 'ETF', m.etf)}
      ${m.fearGreed ? `<div class="kv"><span class="small mut">Medo & ganância (cripto)</span><b>${m.fearGreed.value}</b><span class="small mut">${esc(m.fearGreed.label)}</span></div>` : ''}</div>
    <ul class="checks" style="margin-top:8px">${P.why.map((w) => `<li>${ic('info', 'mut')}<span>${esc(w)}</span></li>`).join('')}</ul>
    ${D.strategy?.rules?.resumoEstrategia ? `<p class="note"><b>O que o report diz:</b> ${esc(D.strategy.rules.resumoEstrategia)}</p>` : ''}
    <p class="note">O fundo de emergência fica de fora. Regras automáticas (tendência = preço e média de 50 dias vs média de 200 dias), não é recomendação financeira.</p>
  </div>`;
}

/* ---------- shell ---------- */
const VIEWS = { home: ['Visão geral', home], crypto: ['Cripto', cryptoView], tr: ['Trade Rep.', trView], strategy: ['Estratégia', strategyView] };
const ICON = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.3-.5 4.6-1.2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/></svg>',
};

function render() {
  document.body.classList.toggle('hide', !!prefs.hide);
  $('#eye').innerHTML = prefs.hide ? ICON.eyeOff : ICON.eye;
  $('#refresh').innerHTML = ICON.refresh;
  for (const b of $('#cur').children) b.classList.toggle('on', b.dataset.c === prefs.cur), b.setAttribute('aria-pressed', b.dataset.c === prefs.cur);
  for (const b of $('#nav').children) b.classList.toggle('on', b.dataset.v === prefs.view), b.toggleAttribute('aria-current', b.dataset.v === prefs.view);
  $('#eye').setAttribute('aria-label', prefs.hide ? 'Mostrar valores' : 'Ocultar valores');
  const [title, fn] = VIEWS[prefs.view] || VIEWS.home;
  $('#title').textContent = title;
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === 'v-' + prefs.view);
  $('#v-' + prefs.view).innerHTML = fn();
  if (prefs.view === 'home') bindChart();
  for (const b of document.querySelectorAll('.forget')) b.addEventListener('click', async () => (await dropKey(), location.reload()));
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => ((prefs.view = b.dataset.go), save(), render(), scrollTo({ top: 0 })));
  for (const r of document.querySelectorAll('.ring')) r.addEventListener('click', () => ((prefs.profile = r.dataset.p), save(), render()));
  $('#planAmt')?.addEventListener('change', (e) => ((prefs.planAmt = Math.max(0, +e.target.value || 0)), save(), render()));
  $('#planCrypto')?.addEventListener('input', (e) => ($('#planCv').textContent = e.target.value + '%'));
  $('#planCrypto')?.addEventListener('change', (e) => ((prefs.planCrypto = +e.target.value), save(), render()));
}

function show() {
  $('#boot')?.remove();
  $('#lock').style.display = 'none';
  $('#app').style.display = 'block';
  render();
}

$('#nav').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (v) (prefs.view = v), save(), render(), scrollTo({ top: 0 });
});
$('#cur').addEventListener('click', (e) => {
  const c = e.target.closest('button')?.dataset.c;
  if (c) (prefs.cur = c), save(), render();
});
$('#eye').addEventListener('click', () => ((prefs.hide = !prefs.hide), save(), render()));
$('#refresh').addEventListener('click', () => reload(true));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && D && reload());

boot();
