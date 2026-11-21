// Token launch radar page: reads window.RADAR (../data.js, written by main.ts) and recomputes everything it shows.
(() => {
const R = window.RADAR, F = R.fit, $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const C = { g: '#4ade80', b: '#60a5fa', mu: '#8190a8', line: '#222c3d', dot: '#6b778c', tx: '#dbe2ee' };
const TIER = { W: 'Watchlist', E: 'Early', O: 'Off-list' };

// ---------- formatting
const big = (x) => (x >= 1e12 ? `$${(x / 1e12).toFixed(2)}T` : x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(0)}K` : `$${Math.round(x)}`);
const usd = (x) => { const a = Math.abs(x), s = x < 0 ? '-' : ''; return a >= 1e4 ? s + big(a) : a >= 100 ? `${s}$${Math.round(a).toLocaleString('en-US')}` : `${s}$${a.toFixed(2)}`; };
const pct = (x, d = 1) => (x === null ? 'n/a' : `${x > 0 ? '+' : ''}${x.toFixed(d)}%`);
const yrs = (a) => (a === null ? 'n/a' : `${a.toFixed(1)}y`);
const cls = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
const mult = (x) => `x${x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)}`;

// ---------- integrity: the checksum is FNV-1a over canonical row JSON, the same function main.ts runs
function fnv1a(s) { let h = 0x811c9dc5; for (const b of new TextEncoder().encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }

// ---------- sandbox economics (the same arithmetic as lib/farm.ts econ)
const S = { tier: 'all', vd: 'all', cat: '', chain: '', q: '', sort: 'k', desc: false, dep: R.meta.defaults.deposit, drop: R.meta.defaults.drop, wk: R.meta.defaults.weeks, sel: null, cmp: [] };
function econ(r) {
  let gas = 0, fee = 0, min = 0;
  for (const [, g, , f, m, w] of r.st) { const k = w ? S.wk : 1; gas += g * k; fee += f * S.dep; min += m * k; }
  const exp = r.v * S.drop * S.dep / r.tv, carry = S.dep * 0.04 * S.wk / 52, net = exp - gas - fee - carry, hrs = min / 60, ph = net / hrs;
  return { exp, gas, fee, carry, net, hrs, ph, vd: net >= 20 && ph >= 10 ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP' };
}
const E = new Map();
const recompute = () => { for (const r of R.rows) E.set(r.s, econ(r)); };
const bySlug = new Map(R.rows.map((r) => [r.s, r]));

// ---------- header, KPIs, ledger, integrity
$('#meta').innerHTML = [['Snapshot', R.meta.asOf], ['Protocols', R.meta.protocols], ['Board rows', R.rows.length], ['Model', R.meta.version]].map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('');

function kpis() {
  const wl = R.rows.filter((r) => r.t === 'W').length, tot = R.rows.reduce((a, r) => a + r.v, 0);
  const fm = R.rows.filter((r) => E.get(r.s).vd === 'FARM').length, th = R.rows.filter((r) => E.get(r.s).vd === 'THIN').length;
  const m = F.miss, c = F.calib;
  const k = [
    ['', 'Watchlist ranked', `${wl}<small>/${R.watch.length}</small>`, 'every house-list slug is on the board'],
    ['', 'Board rows', R.rows.length, `${R.rows.filter((r) => r.t === 'E').length} early, ${R.rows.filter((r) => r.t === 'O').length} off-list`],
    ['v', 'Total implied value', big(tot), 'launch value x token odds, summed'],
    ['g', 'Value miss, held out', `${m.loo.toFixed(2)}x<small> vs ${m.baseLoo.toFixed(2)}x</small>`, `median miss, leave-one-out; walk-forward ${m.wf.toFixed(2)}x vs flat ${m.baseWf.toFixed(2)}x`],
    ['a', 'Range honesty', `${Math.round(c.looIqr * 100)}%<small> / ${Math.round(c.looIdr * 100)}%</small>`, `real caps inside P25-P75 / P10-P90 (targets 50 / 80); walk-forward ${Math.round(c.wfIqr * 100)} / ${Math.round(c.wfIdr * 100)}`],
    ['g', 'Worth farming', `${fm}<small> FARM</small>`, `${th} THIN of ${R.rows.length} at ${usd(S.dep)}, ${Math.round(S.drop * 100)}% drop, ${S.wk} wk`],
  ];
  $('#kpis').innerHTML = k.map(([c2, h, n, p]) => `<div class="kpi ${c2}"><h3>${h}</h3><div class="n">${n}</div><p>${p}</p></div>`).join('');
}

const LCOL = { watch: '#60a5fa', early: '#2dd4bf', off: '#a78bfa', comp: '#cbd5e1', nocap: '#94a3b8', kin: '#64748b', bridge: '#fb923c', lst: '#f59e0b', cex: '#f87171', ver: '#be185d' };
function ledger() {
  const n = R.ledger.reduce((a, l) => a + l.n, 0);
  $('#ledger').innerHTML = `<div class="stack">${R.ledger.map((l) => `<i style="flex:${l.n};background:${LCOL[l.k]}" title="${esc(l.label)}: ${l.n}"></i>`).join('')}</div>
  <div class="leg">${R.ledger.map((l) => `<div title="${esc(l.note)}"><span class="sw" style="background:${LCOL[l.k]}"></span>${esc(l.label)}<b>${l.n}</b></div>`).join('')}</div>
  <div class="tot">${R.ledger.map((l) => l.n).join(' + ')} = ${n} of ${R.meta.protocols}</div>`;
  $('#ledger').closest('.card').querySelector('h2 small').textContent += ` (${n} of ${R.meta.protocols})`;
}

function checks() {
  const ids = R.rows.map((r) => r.k), vs = R.rows.map((r) => r.v);
  const canon = R.rows.map((r) => JSON.stringify([r.s, r.k, r.v])).join('\n'), sum = vs.reduce((a, b) => a + b, 0);
  const have = new Set(R.rows.map((r) => r.s)), lg = Object.fromEntries(R.ledger.map((l) => [l.k, l.n]));
  const cnt = (t) => R.rows.filter((r) => r.t === t).length;
  const lsum = R.ledger.reduce((a, l) => a + l.n, 0), wl = R.watch.filter((s) => have.has(s)).length;
  const sum2 = fnv1a(canon);
  const list = [
    ['row count equals board rows', R.rows.length === R.check.rows, `${R.rows.length} = ${R.check.rows}`],
    ['checksum (FNV-1a) matches', sum2 === R.check.checksum, sum2],
    ['ranks run 1..N in order', ids.every((k, i) => k === i + 1), `1..${ids.length}`],
    ['implied values never rise', vs.every((v, i) => i === 0 || v <= vs[i - 1]), `${big(vs[0])} to ${big(vs[vs.length - 1])}`],
    ['totals equal', sum === R.check.total, big(sum)],
    ['watchlist covered', wl === R.watch.length, `${wl}/${R.watch.length}`],
    ['ledger sums to protocols', lsum === R.meta.protocols, `${lsum}/${R.meta.protocols}`],
    ['tier counts match ledger', cnt('W') === lg.watch && cnt('E') === lg.early && cnt('O') === lg.off, `${cnt('W')}/${cnt('E')}/${cnt('O')}`],
  ];
  $('#checks').innerHTML = list.map(([t, ok, d]) => `<div class="chk ${ok ? '' : 'bad'}"><i>${ok ? 'PASS' : 'FAIL'}</i>${t}<span>${esc(d)}</span></div>`).join('');
}

// ---------- out-of-sample evidence
function evidence() {
  const vr = F.valueTable.map((r) => `<tr><td>${esc(r.term)}</td><td>${r.loo.toFixed(2)}x</td><td>${r.wf.toFixed(2)}x</td><td class="${r.verdict === 'kept' ? 'kept' : r.verdict === 'dropped' ? 'drop' : ''}">${r.verdict}</td></tr>`).join('');
  const o = F.oddsFinal, v = F.valueCoef;
  $('#evV').className = 'ev';
  $('#evV').innerHTML = `<h3>Value model: median miss multiple on held-out protocols</h3><table><thead><tr><th>term, added in order</th><th>leave-one-out</th><th>walk-forward</th><th>verdict</th></tr></thead><tbody>${vr}</tbody></table>
  <p class="foot">Fitted on ${v.nComps} traded tokens (one per ticker): log10 cap = ${v.c0} + ${v.tvl} x z(log10 TVL). Kept: ${esc(F.valueKept.join(', '))}. Spread (LOO P10 / P25 / P75 / P90): ${F.resid.p10} / ${F.resid.p25} / ${F.resid.p75} / ${F.resid.p90} dex. A term stays only if it lowers both misses.</p>`;
  const or = F.oddsTable.map((r) => `<tr><td>${esc(r.term)}</td><td>${r.brierLoo.toFixed(3)}</td><td>${r.brierWf.toFixed(3)}</td><td>${Math.round(r.rightLoo * 100)}% / ${Math.round(r.rightWf * 100)}%</td><td class="${r.verdict === 'kept' ? 'kept' : r.verdict === 'dropped' ? 'drop' : ''}">${r.verdict}</td></tr>`).join('');
  $('#evO').className = 'ev';
  $('#evO').innerHTML = `<h3>Odds model: Brier score (lower is better) vs the base rate</h3><table><thead><tr><th>term, added in order</th><th>LOO</th><th>walk-fwd</th><th>called right</th><th>verdict</th></tr></thead><tbody>${or}</tbody></table>
  <p class="foot">${o.n} peers, ${Math.round(o.rate * 100)}% record a token. Final model: Brier ${o.brierLoo.toFixed(3)} LOO / ${o.brierWf.toFixed(3)} walk-forward vs ${o.baseLoo.toFixed(3)} / ${o.baseWf.toFixed(3)} for the base rate. Called right = share on the right side of 50%, LOO / walk-forward. Odds lean on age (late listings have had little time to launch). Growth enters negatively: in this sealed week peers with a token lost TVL more often, since part of their TVL is priced in their own token. A fitted association, not a cause.</p>`;
}

function canvas(id, draw) {
  const cv = $(id), x = cv.getContext('2d');
  x.clearRect(0, 0, cv.width, cv.height);
  x.font = '11px ui-monospace,Menlo,Consolas,monospace';
  draw(x, cv.width, cv.height);
}
function scatter() {
  const ch = R.charts, xs = [...ch.comps, ...ch.board].map((p) => p[0]), ys = [...ch.comps, ...ch.board].map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  canvas('#cv1', (x, W, H) => {
    const L = 52, B = 26, T = 10, Rr = 12, px = (v) => L + (v - x0) / (x1 - x0) * (W - L - Rr), py = (v) => H - B - (v - y0) / (y1 - y0) * (H - B - T);
    x.strokeStyle = C.line; x.fillStyle = C.mu; x.lineWidth = 1;
    for (let v = y0; v <= y1; v++) { x.beginPath(); x.moveTo(L, py(v)); x.lineTo(W - Rr, py(v)); x.stroke(); x.fillText(big(10 ** v), 4, py(v) + 4); }
    for (let v = x0; v <= x1; v++) { const t = big(10 ** v); x.fillText(t, Math.min(px(v) - 14, W - Rr - x.measureText(t).width), H - 8); }
    x.save(); x.beginPath(); x.rect(L, T, W - L - Rr, H - B - T); x.clip();
    x.fillStyle = '#60a5fa1f'; x.beginPath();
    ch.line.forEach(([a, b], i) => x[i ? 'lineTo' : 'moveTo'](px(a), py(b + ch.band[1])));
    [...ch.line].reverse().forEach(([a, b]) => x.lineTo(px(a), py(b + ch.band[0])));
    x.fill();
    x.strokeStyle = C.b; x.lineWidth = 2; x.beginPath(); ch.line.forEach(([a, b], i) => x[i ? 'lineTo' : 'moveTo'](px(a), py(b))); x.stroke(); x.restore();
    x.fillStyle = C.dot; ch.comps.forEach(([a, b]) => { x.beginPath(); x.arc(px(a), py(b), 3, 0, 7); x.fill(); });
    x.fillStyle = C.g + 'cc'; ch.board.forEach(([a, b]) => { x.beginPath(); x.arc(px(a), py(b), 2.6, 0, 7); x.fill(); });
    x.fillStyle = C.tx; x.fillText('x: TVL   y: market cap / implied value', L + 8, T + 10);
  });
}
function bars() {
  const d = R.charts.ageBars;
  canvas('#cv2', (x, W, H) => {
    const L = 40, B = 36, T = 22, bw = (W - L - 12) / d.length, py = (v) => H - B - v * (H - B - T);
    x.strokeStyle = C.line; x.fillStyle = C.mu;
    for (let v = 0; v <= 1.001; v += 0.25) { x.beginPath(); x.moveTo(L, py(v)); x.lineTo(W - 8, py(v)); x.stroke(); x.fillText(`${Math.round(v * 100)}%`, 6, py(v) + 4); }
    d.forEach((b, i) => {
      const x0 = L + i * bw + bw * 0.14, w = bw * 0.34;
      x.fillStyle = C.dot; x.fillRect(x0, py(b.real), w, H - B - py(b.real));
      x.fillStyle = C.g; x.fillRect(x0 + w + 3, py(b.pred), w, H - B - py(b.pred));
      x.fillStyle = C.tx; x.fillText(`${Math.round(b.real * 100)}`, x0 + 2, py(b.real) - 4); x.fillText(`${Math.round(b.pred * 100)}`, x0 + w + 5, py(b.pred) - 4);
      x.fillStyle = C.mu; x.fillText(b.label, x0, H - 20); x.fillText(`n=${b.n}`, x0, H - 8);
    });
    x.fillStyle = C.dot; x.fillRect(L, 5, 9, 9); x.fillStyle = C.tx; x.fillText('real share', L + 13, 14);
    x.fillStyle = C.g; x.fillRect(L + 90, 5, 9, 9); x.fillStyle = C.tx; x.fillText('held-out prediction', L + 103, 14);
  });
}

// ---------- board
const COLS = [['k', '#'], ['tv', 'TVL'], ['g', '7D'], ['a', 'Age'], ['o', 'Odds'], ['lv', 'If launches'], ['v', 'Implied value'], ['net', 'Verdict / net'], ['ph', 'Net/hr']];
const val = (r, k) => (k === 'net' ? E.get(r.s).net : k === 'ph' ? E.get(r.s).ph : r[k]);
function view() {
  const q = S.q.trim().toLowerCase();
  const rows = R.rows.filter((r) => (S.tier === 'all' || r.t === S.tier) && (S.vd === 'all' || E.get(r.s).vd === S.vd) && (!S.cat || r.c === S.cat) && (!S.chain || r.h.includes(S.chain)) &&
    (!q || `${r.n} ${r.s} ${r.c}`.toLowerCase().includes(q)));
  const d = S.desc ? -1 : 1;
  return rows.sort((a, b) => { const x = val(a, S.sort), y = val(b, S.sort); if (x === y) return a.k - b.k; if (x === null) return 1; if (y === null) return -1; return (x < y ? -1 : 1) * d; });
}
function head() {
  $('#tbl thead').innerHTML = `<tr><th style="cursor:default" title="compare">cmp</th>${COLS.map(([k, t], i) => `<th data-k="${k}" class="${S.sort === k ? 'cur' + (S.desc ? ' desc' : '') : ''}">${t}</th>${i === 0 ? '<th style="cursor:default;text-align:left">Protocol</th>' : ''}`).join('')}</tr>`;
}
function board() {
  const rows = view();
  $('#count').textContent = `${rows.length} of ${R.rows.length} rows, ranked by implied value`;
  $('#tbl tbody').innerHTML = rows.map((r) => {
    const e = E.get(r.s);
    return `<tr data-s="${esc(r.s)}" class="${S.sel === r.s ? 'sel' : ''}"><td><input type="checkbox" data-c="${esc(r.s)}" ${S.cmp.includes(r.s) ? 'checked' : ''} aria-label="compare ${esc(r.n)}"></td><td>${r.k}</td>
    <td class="nm">${esc(r.n)}<span class="chip ${r.t}">${TIER[r.t]}</span><small>${esc(r.c || 'no category')} on ${esc(r.h.slice(0, 3).join(', '))}${r.h.length > 3 ? ` +${r.h.length - 3}` : ''}</small></td>
    <td>${big(r.tv)}</td><td class="${cls(r.g)}">${pct(r.g)}</td><td>${yrs(r.a)}</td><td>${(r.o * 100).toFixed(0)}%</td><td>${big(r.lv)}</td>
    <td><b>${big(r.v)}</b><small>${big(r.r[1])} - ${big(r.r[2])}</small></td>
    <td><span class="chip ${e.vd}">${e.vd}</span> <span class="${cls(e.net)}">${usd(e.net)}</span></td><td class="${cls(e.ph)}">${usd(e.ph)}</td></tr>`;
  }).join('') || '<tr><td colspan="11" class="empty" style="text-align:center;padding:24px">No protocol matches these filters.</td></tr>';
}
function tabs() {
  const tc = (t) => R.rows.filter((r) => r.t === t).length, vc = (v) => R.rows.filter((r) => E.get(r.s).vd === v).length;
  $('#tierTabs').innerHTML = [['all', 'All', R.rows.length], ['W', 'Watchlist', tc('W')], ['E', 'Early', tc('E')], ['O', 'Off-list', tc('O')]].map(([k, t, n]) => `<button data-t="${k}" class="${S.tier === k ? 'on' : ''}">${t} ${n}</button>`).join('');
  $('#vdTabs').innerHTML = [['all', 'All', ''], ['FARM', 'Farm', 'f'], ['THIN', 'Thin', 't'], ['SKIP', 'Skip', 's']].map(([k, t, c]) => `<button data-v="${k}" class="${S.vd === k ? 'on ' + c : ''}">${t}${k === 'all' ? '' : ' ' + vc(k)}</button>`).join('');
  $('#depSeg').innerHTML = [100, 1000, 10000].map((d) => `<button data-d="${d}" class="${S.dep === d ? 'on' : ''}">$${d.toLocaleString('en-US')}</button>`).join('');
  $('#wkSeg').innerHTML = [13, 26, 52].map((w) => `<button data-w="${w}" class="${S.wk === w ? 'on' : ''}">${w} wk</button>`).join('');
  $('#drop').value = Math.round(S.drop * 100); $('#dropOut').textContent = `${Math.round(S.drop * 100)}%`;
}
function refresh() { recompute(); tabs(); head(); board(); kpis(); compare(); if (S.sel) detail(S.sel); }

// ---------- detail view
function breakEven(r) {
  const f = r.st.reduce((a, t) => a + t[3], 0), gas = r.st.reduce((a, t) => a + t[1] * (t[5] ? S.wk : 1), 0), k = r.v * S.drop / r.tv - f - 0.04 * S.wk / 52;
  return k <= 0 ? 'none: fees and carry outrun the slice at this drop share' : usd(gas / k);
}
function detail(slug) {
  const r = bySlug.get(slug), e = E.get(slug), d = $('#detail');
  S.sel = slug; d.hidden = false;
  const drv = (t) => (t === 'tvl' ? big(r.tv) : t === 'age' ? yrs(r.a) : t === 'growth' ? pct(r.g) : t === 'chains' ? `${r.h.length} chains` : r.c || 'none');
  const vt = r.vt.map(([t, x]) => `<tr><td>${F.termLabel[t]}</td><td>${esc(drv(t))}</td><td>${mult(10 ** x)}</td></tr>`).join('');
  const p0 = 1 / (1 + Math.exp(-r.b0));
  const ot = r.ot.map(([t, x]) => `<tr><td>${F.termLabel[t].replace('years since listed', 'no-token age')}</td><td>${esc(drv(t))}</td><td>${mult(Math.exp(x))} odds</td></tr>`).join('');
  const lo = (k) => r.lv * 10 ** F.resid[k];
  const steps = r.st.map(([a, g, c, f, m, w], i) => `<div class="step"><b>${i + 1}</b><span>${esc(a)}</span><small>gas ${usd(g)}${w ? ` x ${S.wk} wk` : ''} | capital ${c ? usd(c * S.dep) : 'none'} | fees ${f ? usd(f * S.dep) : 'none'} | ${m} min${w ? ` x ${S.wk} wk` : ''}</small></div>`).join('');
  const cm = r.cm.map(([n, s, t, m]) => `<tr><td>${esc(n)} ${esc(s)}</td><td>${big(t)}</td><td>${big(m)}</td><td>${(m / t).toFixed(2)}x</td></tr>`).join('');
  d.innerHTML = `<button class="x" id="close" type="button">Close</button>
  <h2>${esc(r.n)} <span class="chip ${r.t}">${TIER[r.t]}</span></h2>
  <p class="mu">${esc(r.c || 'no category')} on ${esc(r.h.join(', '))}. Rank ${r.k} of ${R.rows.length}. Records no token in the snapshot.</p>
  <div class="kv"><div><span>Implied value</span><b>${big(r.v)}</b></div><div><span>If it launches</span><b>${big(r.lv)}</b></div><div><span>Token odds</span><b>${(r.o * 100).toFixed(1)}%</b></div>
  <div><span>TVL</span><b>${big(r.tv)}</b></div><div><span>7-day TVL</span><b class="${cls(r.g)}">${pct(r.g)}</b></div><div><span>Listed</span><b>${yrs(r.a)}</b></div></div>
  <h3>Farm economics (${usd(S.dep)}, ${Math.round(S.drop * 100)}% drop, ${S.wk} weeks)</h3>
  <div class="formula">slice = ${big(r.v)} x ${Math.round(S.drop * 100)}% x (${usd(S.dep)} / ${big(r.tv)}) = ${usd(e.exp)}<br>net = ${usd(e.exp)} - gas ${usd(e.gas)} - fees ${usd(e.fee)} - carry ${usd(e.carry)} = <b class="${cls(e.net)}">${usd(e.net)}</b><br>${e.hrs.toFixed(1)} h of work = ${usd(e.ph)}/h: <span class="chip ${e.vd}">${e.vd}</span> (FARM needs net >= $20 and >= $10/h)<br>break-even deposit: ${breakEven(r)}</div>
  <h3>How its value is built</h3>
  <div class="formula">implied = launch value x odds = ${big(r.lv)} x ${(r.o * 100).toFixed(1)}% = ${big(r.v)}<br>range of launch value: P25-P75 ${big(lo('p25'))} to ${big(lo('p75'))}, P10-P90 ${big(lo('p10'))} to ${big(lo('p90'))}</div>
  <table class="mini"><thead><tr><th>launch value term</th><th>this protocol</th><th>multiplier</th></tr></thead><tbody><tr><td>fitted starting cap (10^${r.c0})</td><td>fit mean</td><td>${big(10 ** r.c0)}</td></tr>${vt}<tr><td><b>launch value</b></td><td></td><td><b>${big(r.lv)}</b></td></tr></tbody></table>
  <table class="mini" style="margin-top:8px"><thead><tr><th>token odds term</th><th>this protocol</th><th>multiplier</th></tr></thead><tbody><tr><td>base odds of a peer</td><td>fit mean</td><td>${(p0 * 100).toFixed(1)}%</td></tr>${ot}<tr><td><b>token odds</b></td><td></td><td><b>${(r.o * 100).toFixed(1)}%</b></td></tr></tbody></table>
  <p class="mu" style="font-size:11px;margin-top:6px">Growth enters odds negatively: peers with a token lost more TVL in the sealed week (part of their TVL is priced in their own token). A fitted association, not a cause.</p>
  <h3>Farm plan on ${esc(r.ch)} (${usd(S.dep)}, ${S.wk} weeks)</h3>${steps}
  <h3>Nearest priced comps</h3>
  <table class="mini"><thead><tr><th>token</th><th>TVL</th><th>market cap</th><th>cap / TVL</th></tr></thead><tbody>${cm}</tbody></table>`;
  $('#close').onclick = () => { S.sel = null; d.hidden = true; board(); };
  board();
}

// ---------- compare
function compare() {
  const el = $('#cmp');
  $('#cmpBtn').textContent = `Compare ${S.cmp.length}`;
  if (!S.cmp.length) { el.innerHTML = '<p class="empty">Tick the box at the start of up to four board rows to set them side by side.</p>'; return; }
  el.innerHTML = `<div class="cmpg">${S.cmp.map((s) => {
    const r = bySlug.get(s), e = E.get(s);
    const rows = [['Tier', TIER[r.t]], ['Rank', `${r.k}`], ['TVL', big(r.tv)], ['7-day TVL', pct(r.g)], ['Listed', yrs(r.a)], ['Token odds', `${(r.o * 100).toFixed(1)}%`], ['If it launches', big(r.lv)], ['Implied value', big(r.v)],
      ['Range P25-P75', `${big(r.r[1])} - ${big(r.r[2])}`], ['Farm chain', r.ch], ['Break-even deposit', breakEven(r)], ['Plan gas', usd(e.gas)], ['Slice', usd(e.exp)], ['Net', usd(e.net)], ['Net/hour', usd(e.ph)], ['Verdict', e.vd]];
    return `<div class="cc"><h4>${esc(r.n)}</h4>${rows.map(([a, b]) => `<div class="r"><span>${a}</span><span>${esc(b)}</span></div>`).join('')}</div>`;
  }).join('')}</div>`;
}

// ---------- export
function save(name, type, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
function rowOut(r) { const e = E.get(r.s); return { rank: r.k, slug: r.s, name: r.n, tier: TIER[r.t], category: r.c, chains: r.h.join('|'), tvl_usd: r.tv, change_7d: r.g, age_years: r.a, token_odds: r.o, launch_value_usd: r.lv, implied_value_usd: r.v, range_p25_usd: r.r[1], range_p75_usd: r.r[2], verdict: e.vd, slice_usd: +e.exp.toFixed(2), net_usd: +e.net.toFixed(2), net_per_hour_usd: +e.ph.toFixed(2) }; }

// ---------- wiring
function init() {
  const cats = [...new Set(R.rows.map((r) => r.c || ''))].sort(), chs = [...new Set(R.rows.flatMap((r) => r.h))].sort();
  $('#cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c || 'no category')}</option>`).join('');
  $('#chain').innerHTML = '<option value="">All chains</option>' + chs.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#tierTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.tier = b.dataset.t; refresh(); } };
  $('#vdTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.vd = b.dataset.v; refresh(); } };
  $('#depSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.dep = +b.dataset.d; refresh(); } };
  $('#wkSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.wk = +b.dataset.w; refresh(); } };
  $('#drop').oninput = (e) => { S.drop = +e.target.value / 100; refresh(); };
  $('#q').oninput = (e) => { S.q = e.target.value; board(); };
  $('#cat').onchange = (e) => { S.cat = e.target.value; board(); };
  $('#chain').onchange = (e) => { S.chain = e.target.value; board(); };
  $('#reset').onclick = () => { Object.assign(S, { tier: 'all', vd: 'all', cat: '', chain: '', q: '', sort: 'k', desc: false, dep: R.meta.defaults.deposit, drop: R.meta.defaults.drop, wk: R.meta.defaults.weeks, sel: null, cmp: [] });
    $('#q').value = ''; $('#cat').value = ''; $('#chain').value = ''; $('#detail').hidden = true; refresh(); };
  $('#tbl thead').onclick = (e) => { const th = e.target.closest('th[data-k]'); if (!th) return; const k = th.dataset.k; S.desc = S.sort === k ? !S.desc : k !== 'k'; S.sort = k; head(); board(); };
  $('#tbl tbody').onclick = (e) => {
    const c = e.target.closest('input[data-c]');
    if (c) { const s = c.dataset.c, i = S.cmp.indexOf(s); if (i >= 0) S.cmp.splice(i, 1); else if (S.cmp.length < 4) S.cmp.push(s); else c.checked = false; compare(); return; }
    const tr = e.target.closest('tr[data-s]'); if (tr) detail(tr.dataset.s);
  };
  $('#cmpBtn').onclick = () => $('#compare').scrollIntoView({ behavior: 'smooth' });
  $('#csv').onclick = () => { const o = view().map(rowOut), k = Object.keys(o[0] || {}); save('token-radar.csv', 'text/csv', [k.join(','), ...o.map((r) => k.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n')); };
  $('#json').onclick = () => save('token-radar.json', 'application/json', JSON.stringify(view().map(rowOut), null, 1));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sel) { S.sel = null; $('#detail').hidden = true; board(); } });
  window.addEventListener('resize', () => { scatter(); bars(); });
}
init(); ledger(); checks(); evidence(); scatter(); bars(); refresh();
})();
