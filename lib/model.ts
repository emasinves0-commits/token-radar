// The radar's model, fitted from the snapshot alone (no protocol names, no network).
//
//  1. Value model  : log10(market cap) ridge-regressed on log10(TVL) (+ shrunk category effects and any other
//                    term that survives a held-out test) over traded-token protocols, one row per ticker.
//  2. Odds model   : probability that a protocol ever records a token, logistic regression fitted by gradient
//                    descent on peers (no-token age, log TVL, 7-day growth, category ...).
//  3. Every term is added in a fixed order and kept only if it lowers the held-out error in BOTH a
//     leave-one-out test and a walk-forward test (fit on protocols listed earlier, test on those listed later).
//  4. implied value = fitted launch value x token odds.
//  5. Ranges are priced per kind (v2): a category with at least eight priced comps gets its own
//     leave-one-out residual band (P10/P25/P75/P90), so a protocol's range comes from peers of its own
//     kind; thinner categories fall back to the global band.

export interface Protocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  change_7d: number | null; mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (!s || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist) || typeof s.as_of !== 'string') throw new Error('not a token-radar snapshot');
  return s;
}

// ------------------------------------------------------------------ the rankability screen and the ledger
const EXCHANGE = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;
const VERSION = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const BRIDGE = new Set(['Bridge', 'Canonical Bridge']);
const STAKING = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

export type Bucket = 'watch' | 'early' | 'off' | 'comp' | 'nocap' | 'kin' | 'bridge' | 'lst' | 'cex' | 'ver';
export const BUCKETS: { k: Bucket; label: string; note: string }[] = [
  { k: 'watch', label: 'ranked: watchlist', note: 'pre-token, TVL at the floor or above, on the house list' },
  { k: 'early', label: 'ranked: early', note: 'pre-token, below the floor, passes the screen' },
  { k: 'off', label: 'ranked: off-list', note: 'pre-token, above the floor, passes the screen, left off the list' },
  { k: 'comp', label: 'token trades (priced comps)', note: 'token with a usable market cap: the value model learns from these' },
  { k: 'nocap', label: 'token recorded, no usable cap', note: 'a token id is recorded but no market cap' },
  { k: 'kin', label: 'kin of a token', note: 'ticker recorded without its own id: a product of a token that trades' },
  { k: 'bridge', label: 'out: bridge', note: 'pre-token, Bridge or Canonical Bridge' },
  { k: 'lst', label: 'out: liquid staking', note: 'pre-token, liquid staking / restaking / restaked BTC' },
  { k: 'cex', label: 'out: exchange', note: 'pre-token, CEX or an exchange-named product' },
  { k: 'ver', label: 'out: versioned or wrapped', note: 'pre-token, name ends in a version or says wrapped/staked/staking' },
];

export function bucketOf(p: Protocol, watch: Set<string>, floor: number): Bucket {
  if (p.gecko_id) return p.mcap_usd !== null && p.mcap_usd > 0 ? 'comp' : 'nocap';
  if (p.symbol) return 'kin';
  if (p.category === 'CEX' || EXCHANGE.test(p.name)) return 'cex';
  if (p.category !== null && BRIDGE.has(p.category)) return 'bridge';
  if (p.category !== null && STAKING.has(p.category)) return 'lst';
  if (VERSION.test(p.name) || WRAPPED.test(p.name)) return 'ver';
  if (watch.has(p.slug)) return 'watch';
  return p.tvl_usd >= floor ? 'off' : 'early';
}
const isRanked = (b: Bucket): boolean => b === 'watch' || b === 'early' || b === 'off';

// ------------------------------------------------------------------ small numerics
const log10 = Math.log10;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const median = (a: number[]): number => quantile(a, 0.5);
export function quantile(a: number[], q: number): number {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a: number[]): number => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1; };
const round = (x: number, d: number): number => { const f = 10 ** d; return Math.round(x * f) / f; };

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    const d = M[c]![c]! || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / d;
      if (f !== 0) for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / (M[r]![r]! || 1e-12);
  }
  return x;
}

// ------------------------------------------------------------------ features
export type Term = 'tvl' | 'cat' | 'age' | 'growth' | 'chains';
export const TERM_LABEL: Record<Term, string> = {
  tvl: 'log10 TVL', cat: 'category effect (shrunk)', age: 'years since listed', growth: '7-day TVL growth', chains: 'chains counted',
};
const TERM_NUM: Term[] = ['tvl', 'age', 'growth', 'chains'];

export interface Feat { slug: string; tvl: number; age: number | null; growth: number | null; chains: number; cat: string; listed: string }

export function featOf(p: Protocol, asOf: string): Feat {
  const ms = p.listed_at ? Date.parse(asOf) - Date.parse(p.listed_at) : NaN;
  return {
    slug: p.slug, tvl: log10(Math.max(p.tvl_usd, 1)), age: Number.isFinite(ms) ? Math.max(ms / 31_557_600_000, 0) : null,
    growth: p.change_7d, chains: Math.max(p.chains.length, 1), cat: p.category ?? 'none', listed: p.listed_at ?? '',
  };
}

/** Raw (pre-standardisation) value of a numeric term; null where the record reports none. */
function raw(f: Feat, t: Term): number | null {
  switch (t) {
    case 'tvl': return f.tvl;
    case 'age': return f.age === null ? null : log10(1 + f.age);
    case 'growth': return f.growth === null ? null : clamp(f.growth, -60, 60) / 10;
    case 'chains': return Math.log2(f.chains);
    default: return null;
  }
}

interface Scaler { m: number; s: number; fill: number }
function scalerFor(rows: Feat[], t: Term): Scaler {
  const known = rows.map((r) => raw(r, t)).filter((x): x is number => x !== null);
  const fill = t === 'growth' ? 0 : known.length ? median(known) : 0;
  const all = rows.map((r) => raw(r, t) ?? fill);
  return { m: mean(all), s: sd(all), fill };
}
const zOf = (f: Feat, t: Term, sc: Scaler): number => ((raw(f, t) ?? sc.fill) - sc.m) / sc.s;

// ------------------------------------------------------------------ value model (ridge on log10 market cap)
export interface ValueFit {
  terms: Term[]; c0: number; scalers: Partial<Record<Term, Scaler>>; beta: Partial<Record<Term, number>>; cat: Map<string, number>;
  flat?: number;
}
const LAM_NUM = 0.5, LAM_CAT = 4;

export function fitValue(rows: Feat[], y: number[], terms: Term[]): ValueFit {
  const nums = terms.filter((t) => t !== 'cat');
  const useCat = terms.includes('cat');
  const cats = useCat ? [...new Set(rows.map((r) => r.cat))].sort() : [];
  const scalers: Partial<Record<Term, Scaler>> = {};
  for (const t of nums) scalers[t] = scalerFor(rows, t);
  const m = 1 + nums.length + cats.length;
  const X = rows.map((r) => {
    const x = new Array<number>(m).fill(0);
    x[0] = 1;
    nums.forEach((t, i) => { x[1 + i] = zOf(r, t, scalers[t]!); });
    if (useCat) x[1 + nums.length + cats.indexOf(r.cat)] = 1;
    return x;
  });
  const A = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const b = new Array<number>(m).fill(0);
  X.forEach((x, k) => {
    for (let i = 0; i < m; i++) { if (x[i] === 0) continue; b[i]! += x[i]! * y[k]!; for (let j = 0; j < m; j++) A[i]![j]! += x[i]! * x[j]!; }
  });
  for (let i = 1; i < m; i++) A[i]![i]! += i <= nums.length ? LAM_NUM : LAM_CAT;
  const w = solve(A, b);
  const beta: Partial<Record<Term, number>> = {};
  nums.forEach((t, i) => { beta[t] = w[1 + i]!; });
  const cat = new Map<string, number>();
  cats.forEach((c, i) => cat.set(c, w[1 + nums.length + i]!));
  return { terms, c0: w[0]!, scalers, beta, cat };
}

/** The log10 contribution of each term to one protocol's predicted cap (c0 is the intercept). */
export function valueParts(fit: ValueFit, f: Feat): { c0: number; parts: [Term, number][]; pred: number } {
  if (fit.flat !== undefined) return { c0: fit.flat + f.tvl, parts: [], pred: fit.flat + f.tvl };
  const parts: [Term, number][] = [];
  let pred = fit.c0;
  for (const t of fit.terms) {
    const v = t === 'cat' ? fit.cat.get(f.cat) ?? 0 : fit.beta[t]! * zOf(f, t, fit.scalers[t]!);
    parts.push([t, v]);
    pred += v;
  }
  return { c0: fit.c0, parts, pred };
}
const predictValue = (fit: ValueFit, f: Feat): number => valueParts(fit, f).pred;

function fitFlat(rows: Feat[], y: number[]): ValueFit {
  return { terms: [], c0: 0, scalers: {}, beta: {}, cat: new Map(), flat: median(rows.map((r, i) => y[i]! - r.tvl)) };
}
const fitFor = (rows: Feat[], y: number[], terms: Term[] | null): ValueFit => (terms === null ? fitFlat(rows, y) : fitValue(rows, y, terms));

/** Walk-forward folds: peers sorted by listing day (unreported first), five chunks, train on earlier chunks, test on the next. */
export function walkFolds(n: number): { train: number[]; test: number[] }[] {
  const chunk = Math.ceil(n / 5), folds: { train: number[]; test: number[] }[] = [];
  for (let k = 1; k < 5; k++) {
    const train = [], test = [];
    for (let i = 0; i < n; i++) { if (i < k * chunk) train.push(i); else if (i < (k + 1) * chunk) test.push(i); }
    if (test.length) folds.push({ train, test });
  }
  return folds;
}

export interface Held { loo: number[]; wf: number[]; looSigned: number[]; wfSigned: number[] }
/** Held-out absolute log10 misses for one term set (null = the flat-multiple baseline). Rows must be sorted by listing day. */
export function heldValue(rows: Feat[], y: number[], terms: Term[] | null): Held {
  const looSigned: number[] = [], wfSigned: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const tr = rows.map((_, k) => k).filter((k) => k !== i);
    const fit = fitFor(tr.map((k) => rows[k]!), tr.map((k) => y[k]!), terms);
    looSigned.push(y[i]! - predictValue(fit, rows[i]!));
  }
  for (const fold of walkFolds(rows.length)) {
    const fit = fitFor(fold.train.map((k) => rows[k]!), fold.train.map((k) => y[k]!), terms);
    for (const k of fold.test) wfSigned.push(y[k]! - predictValue(fit, rows[k]!));
  }
  return { loo: looSigned.map(Math.abs), wf: wfSigned.map(Math.abs), looSigned, wfSigned };
}

// ------------------------------------------------------------------ odds model (logistic regression by gradient descent)
export interface OddsFit { terms: Term[]; scalers: Partial<Record<Term, Scaler>>; cats: string[]; w: number[]; nNum: number }
const LAM_ODDS = 1, LAM_ODDS_CAT = 3, LR = 0.5;

/** Sparse design: flat typed arrays, row k holds entries off[k]..off[k+1] of (col, val); column 0 is the intercept. */
interface Sparse { off: Int32Array; col: Int32Array; val: Float64Array }
function designOdds(rows: Feat[], terms: Term[], like?: OddsFit): { X: Sparse; scalers: Partial<Record<Term, Scaler>>; cats: string[]; nNum: number } {
  const nums = terms.filter((t) => t !== 'cat');
  const cats = like ? like.cats : terms.includes('cat') ? [...new Set(rows.map((r) => r.cat))].sort() : [];
  const scalers: Partial<Record<Term, Scaler>> = like ? like.scalers : {};
  if (!like) for (const t of nums) scalers[t] = scalerFor(rows, t);
  const width = 2 + nums.length;
  const off = new Int32Array(rows.length + 1), col = new Int32Array(rows.length * width), val = new Float64Array(rows.length * width);
  let n = 0;
  rows.forEach((r, k) => {
    col[n] = 0; val[n++] = 1;
    nums.forEach((t, i) => { col[n] = 1 + i; val[n++] = zOf(r, t, scalers[t]!); });
    const c = cats.length ? cats.indexOf(r.cat) : -1;
    if (c >= 0) { col[n] = 1 + nums.length + c; val[n++] = 1; }
    off[k + 1] = n;
  });
  return { X: { off, col, val }, scalers, cats, nNum: nums.length };
}
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function gd(X: Sparse, y: number[], width: number, nNum: number, iters: number, w0?: number[]): number[] {
  const w = new Float64Array(width);
  if (w0) w.set(w0);
  const n = y.length, g = new Float64Array(width);
  const { off, col, val } = X;
  for (let it = 0; it < iters; it++) {
    g.fill(0);
    for (let k = 0; k < n; k++) {
      let z = 0;
      for (let e = off[k]!; e < off[k + 1]!; e++) z += w[col[e]!]! * val[e]!;
      const err = 1 / (1 + Math.exp(-z)) - y[k]!;
      for (let e = off[k]!; e < off[k + 1]!; e++) g[col[e]!]! += err * val[e]!;
    }
    for (let j = 0; j < width; j++) {
      const pen = j === 0 ? 0 : j <= nNum ? LAM_ODDS : LAM_ODDS_CAT;
      w[j]! -= (LR * (g[j]! + pen * w[j]!)) / n;
    }
  }
  return Array.from(w);
}

export function fitOdds(rows: Feat[], y: number[], terms: Term[], iters = 700, warm?: OddsFit): OddsFit {
  const d = designOdds(rows, terms);
  const width = 1 + d.nNum + d.cats.length;
  return { terms, scalers: d.scalers, cats: d.cats, nNum: d.nNum, w: gd(d.X, y, width, d.nNum, iters, warm && warm.w.length === width ? warm.w : undefined) };
}

/** The log-odds contribution of each term for one protocol: intercept first, then the terms in order. */
export function oddsParts(fit: OddsFit, f: Feat): { b0: number; parts: [Term, number][]; logit: number } {
  const nums = fit.terms.filter((t) => t !== 'cat');
  const parts: [Term, number][] = [];
  let logit = fit.w[0]!;
  for (const t of fit.terms) {
    let v = 0;
    if (t === 'cat') { const c = fit.cats.indexOf(f.cat); v = c >= 0 ? fit.w[1 + nums.length + c]! : 0; }
    else v = fit.w[1 + nums.indexOf(t)]! * zOf(f, t, fit.scalers[t]!);
    parts.push([t, v]);
    logit += v;
  }
  return { b0: fit.w[0]!, parts, logit };
}
const predictOdds = (fit: OddsFit, f: Feat): number => sigmoid(oddsParts(fit, f).logit);

export interface HeldOdds { loo: number[]; wf: { i: number; p: number }[] }
/** Held-out probabilities. terms === null is the base rate. Rows must be sorted by listing day. */
export function heldOdds(rows: Feat[], y: number[], terms: Term[] | null, full?: OddsFit): HeldOdds {
  const loo: number[] = [];
  const wf: { i: number; p: number }[] = [];
  if (terms === null) {
    const tot = y.reduce((a, b) => a + b, 0);
    for (let i = 0; i < rows.length; i++) loo.push((tot - y[i]!) / (rows.length - 1));
    for (const fold of walkFolds(rows.length)) {
      const br = mean(fold.train.map((k) => y[k]!));
      for (const k of fold.test) wf.push({ i: k, p: br });
    }
    return { loo, wf };
  }
  const base = full ?? fitOdds(rows, y, terms);
  for (let i = 0; i < rows.length; i++) {
    const tr = rows.map((_, k) => k).filter((k) => k !== i);
    const fit = fitOdds(tr.map((k) => rows[k]!), tr.map((k) => y[k]!), terms, 70, base);
    loo.push(predictOdds(fit, rows[i]!));
  }
  for (const fold of walkFolds(rows.length)) {
    const fit = fitOdds(fold.train.map((k) => rows[k]!), fold.train.map((k) => y[k]!), terms);
    for (const k of fold.test) wf.push({ i: k, p: predictOdds(fit, rows[k]!) });
  }
  return { loo, wf };
}

const brier = (ps: number[], ys: number[]): number => mean(ps.map((p, i) => (p - ys[i]!) ** 2));
const rightShare = (ps: number[], ys: number[]): number => mean(ps.map((p, i) => ((p >= 0.5 ? 1 : 0) === ys[i]! ? 1 : 0)));

// ------------------------------------------------------------------ the whole fit
export interface ValueRow { term: string; loo: number; wf: number; verdict: 'baseline' | 'kept' | 'dropped'; note: string }
export interface OddsRow { term: string; brierLoo: number; brierWf: number; rightLoo: number; rightWf: number; verdict: 'baseline' | 'kept' | 'dropped' }

export interface Model {
  asOf: string; version: string;
  comps: { f: Feat; y: number; p: Protocol }[]; valueFit: ValueFit; valueKept: Term[];
  valueTable: ValueRow[]; resid: { p10: number; p25: number; p75: number; p90: number; sigma: number };
  catRanges: { cat: string; n: number; p10: number; p25: number; p75: number; p90: number }[];
  calib: { looIqr: number; looIdr: number; wfIqr: number; wfIdr: number; nLoo: number; nWf: number };
  missFinal: { loo: number; wf: number; baseLoo: number; baseWf: number };
  oddsFit: OddsFit; oddsKept: Term[]; oddsTable: OddsRow[]; peers: { f: Feat; y: number; slug: string }[];
  oddsFinal: { brierLoo: number; brierWf: number; baseLoo: number; baseWf: number; n: number; rate: number; nWf: number };
  ageBars: { label: string; n: number; real: number; pred: number }[];
}

const VALUE_ORDER: Term[] = ['tvl', 'cat', 'age', 'growth', 'chains'];
const ODDS_ORDER: Term[] = ['age', 'tvl', 'growth', 'cat', 'chains'];
const byListed = <T extends { f: Feat }>(a: T, b: T): number => (a.f.listed < b.f.listed ? -1 : a.f.listed > b.f.listed ? 1 : a.f.slug < b.f.slug ? -1 : 1);
const OUT_OF_UNIVERSE = (p: Protocol): boolean => p.category === 'CEX' || (p.category !== null && (BRIDGE.has(p.category) || STAKING.has(p.category))) || EXCHANGE.test(p.name);

export function fitModel(snap: Snapshot): Model {
  // value comps: one row per ticker (the largest-TVL protocol keeps it), traded, usable cap, the same kinds of
  // product the board prices (no exchange, bridge or liquid-staking products).
  const seen = new Map<string, Protocol>();
  for (const p of [...snap.protocols].sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))) {
    if (!p.gecko_id || !p.mcap_usd || p.mcap_usd <= 0 || OUT_OF_UNIVERSE(p)) continue;
    const key = p.symbol ?? p.gecko_id;
    if (!seen.has(key) && ![...seen.values()].some((q) => q.gecko_id === p.gecko_id)) seen.set(key, p);
  }
  const comps = [...seen.values()].map((p) => ({ f: featOf(p, snap.as_of), y: log10(p.mcap_usd!), p })).sort(byListed);
  const F = comps.map((c) => c.f), Y = comps.map((c) => c.y);

  const base = heldValue(F, Y, null);
  const valueTable: ValueRow[] = [{ term: 'flat median multiple (baseline)', loo: round(10 ** median(base.loo), 3), wf: round(10 ** median(base.wf), 3), verdict: 'baseline', note: 'cap = TVL x median(cap/TVL)' }];
  let kept: Term[] = [], cur = base;
  for (const t of VALUE_ORDER) {
    const trial = [...kept, t];
    const h = heldValue(F, Y, trial);
    const mLoo = median(h.loo), mWf = median(h.wf);
    const ok = mLoo < median(cur.loo) && mWf < median(cur.wf);
    valueTable.push({ term: `+ ${TERM_LABEL[t]}`, loo: round(10 ** mLoo, 3), wf: round(10 ** mWf, 3), verdict: ok ? 'kept' : 'dropped', note: ok ? 'lowers both held-out misses' : 'does not lower both' });
    if (ok) { kept = trial; cur = h; }
  }
  if (kept.length === 0) kept = ['tvl'];
  const valueFit = fitValue(F, Y, kept);
  const lr = cur.looSigned;
  const resid = { p10: quantile(lr, 0.1), p25: quantile(lr, 0.25), p75: quantile(lr, 0.75), p90: quantile(lr, 0.9), sigma: sd(lr) };

  // Per-category residual bands (v2): the same leave-one-out misses, grouped by the comp's own
  // category, so a protocol's range is priced from peers of its own kind. A category needs at
  // least eight priced comps for its quantiles to mean anything; thinner kinds use the global band.
  const byCat = new Map<string, number[]>();
  comps.forEach((c, i) => {
    const arr = byCat.get(c.f.cat) ?? [];
    arr.push(lr[i]!);
    byCat.set(c.f.cat, arr);
  });
  const catRanges = [...byCat.entries()]
    .filter(([, a]) => a.length >= 8)
    .map(([cat, a]) => ({ cat, n: a.length, p10: round(quantile(a, 0.1), 3), p25: round(quantile(a, 0.25), 3), p75: round(quantile(a, 0.75), 3), p90: round(quantile(a, 0.9), 3) }))
    .sort((a, b) => b.n - a.n || (a.cat < b.cat ? -1 : 1));

  // calibration: the range's quantiles come from residuals the tested point never touched.
  let inI = 0, inD = 0;
  lr.forEach((r, i) => {
    const o = lr.filter((_, k) => k !== i);
    if (r >= quantile(o, 0.25) && r <= quantile(o, 0.75)) inI++;
    if (r >= quantile(o, 0.1) && r <= quantile(o, 0.9)) inD++;
  });
  let wI = 0, wD = 0, wN = 0;
  for (const fold of walkFolds(F.length)) {
    const trF = fold.train.map((k) => F[k]!), trY = fold.train.map((k) => Y[k]!);
    const inner = fold.train.map((_, i) => {
      const idx = fold.train.filter((__, k) => k !== i);
      return trY[i]! - predictValue(fitValue(idx.map((k) => F[k]!), idx.map((k) => Y[k]!), kept), trF[i]!);
    });
    const fit = fitValue(trF, trY, kept);
    const [a, b, c, d] = [quantile(inner, 0.1), quantile(inner, 0.25), quantile(inner, 0.75), quantile(inner, 0.9)];
    for (const k of fold.test) {
      const r = Y[k]! - predictValue(fit, F[k]!);
      wN++;
      if (r >= b && r <= c) wI++;
      if (r >= a && r <= d) wD++;
    }
  }
  const calib = { looIqr: inI / lr.length, looIdr: inD / lr.length, wfIqr: wI / wN, wfIdr: wD / wN, nLoo: lr.length, nWf: wN };
  const missFinal = { loo: 10 ** median(cur.loo), wf: 10 ** median(cur.wf), baseLoo: 10 ** median(base.loo), baseWf: 10 ** median(base.wf) };

  // odds peers: protocols of the kinds the board prices; a recorded token id is the outcome (kin of a token are left out).
  const peerP = snap.protocols.filter((p) => !(p.symbol && !p.gecko_id) && !OUT_OF_UNIVERSE(p) && !VERSION.test(p.name) && !WRAPPED.test(p.name));
  const peers = peerP.map((p) => ({ f: featOf(p, snap.as_of), y: p.gecko_id ? 1 : 0, slug: p.slug })).sort(byListed);
  const PF = peers.map((p) => p.f), PY = peers.map((p) => p.y);
  const bH = heldOdds(PF, PY, null);
  const wfIdx = bH.wf.map((w) => w.i), wfY = wfIdx.map((i) => PY[i]!);
  const oddsTable: OddsRow[] = [{
    term: 'base rate (baseline)', brierLoo: brier(bH.loo, PY), brierWf: brier(bH.wf.map((w) => w.p), wfY),
    rightLoo: rightShare(bH.loo, PY), rightWf: rightShare(bH.wf.map((w) => w.p), wfY), verdict: 'baseline',
  }];
  let oKept: Term[] = [], oCur = { bl: oddsTable[0]!.brierLoo, bw: oddsTable[0]!.brierWf };
  let oFit: OddsFit | undefined;
  for (const t of ODDS_ORDER) {
    const trial = [...oKept, t];
    const full = fitOdds(PF, PY, trial);
    const h = heldOdds(PF, PY, trial, full);
    const bl = brier(h.loo, PY), bw = brier(h.wf.map((w) => w.p), wfY);
    const ok = bl < oCur.bl && bw < oCur.bw;
    oddsTable.push({ term: `+ ${t === 'age' ? 'no-token age (years since listed)' : TERM_LABEL[t]}`, brierLoo: bl, brierWf: bw, rightLoo: rightShare(h.loo, PY), rightWf: rightShare(h.wf.map((w) => w.p), wfY), verdict: ok ? 'kept' : 'dropped' });
    if (ok) { oKept = trial; oCur = { bl, bw }; oFit = full; }
  }
  if (oKept.length === 0) { oKept = ['age']; oFit = fitOdds(PF, PY, oKept); }
  const oddsFit = oFit!;
  const fh = heldOdds(PF, PY, oKept, oddsFit);
  const ageBars: Model['ageBars'] = [];
  const edges = [0, 1, 2, 3, 4, 6, 99];
  for (let b = 0; b + 1 < edges.length; b++) {
    const idx = peers.map((_, i) => i).filter((i) => PF[i]!.age !== null && PF[i]!.age! >= edges[b]! && PF[i]!.age! < edges[b + 1]!);
    if (idx.length < 5) continue;
    ageBars.push({ label: b + 2 === edges.length ? `${edges[b]}y+` : `${edges[b]}-${edges[b + 1]}y`, n: idx.length, real: mean(idx.map((i) => PY[i]!)), pred: mean(idx.map((i) => fh.loo[i]!)) });
  }
  return {
    asOf: snap.as_of, version: 'radar-2.1', comps, valueFit, valueKept: kept, valueTable, resid, catRanges, calib, missFinal,
    oddsFit, oddsKept: oKept, oddsTable, peers,
    oddsFinal: { brierLoo: oCur.bl, brierWf: oCur.bw, baseLoo: oddsTable[0]!.brierLoo, baseWf: oddsTable[0]!.brierWf, n: PY.length, rate: mean(PY), nWf: wfY.length },
    ageBars,
  };
}

// ------------------------------------------------------------------ scoring one protocol
export interface Scored {
  f: Feat; valueParts: [Term, number][]; c0: number; logCap: number; cap: number; capLo10: number; capLo25: number; capHi75: number; capHi90: number;
  oddsParts: [Term, number][]; b0: number; odds: number; implied: number; ageFilled: boolean;
  rangeKind: 'category' | 'global'; rangeCat: string | null; rangeN: number;
}
export function score(m: Model, p: Protocol): Scored {
  const f = featOf(p, m.asOf);
  const v = valueParts(m.valueFit, f), o = oddsParts(m.oddsFit, f);
  const odds = sigmoid(o.logit);
  const cap = 10 ** v.pred;
  const cr = m.catRanges.find((c) => c.cat === f.cat);
  const band = cr ?? { p10: m.resid.p10, p25: m.resid.p25, p75: m.resid.p75, p90: m.resid.p90 };
  return {
    f, valueParts: v.parts, c0: v.c0, logCap: v.pred, cap, capLo10: 10 ** (v.pred + band.p10), capLo25: 10 ** (v.pred + band.p25), capHi75: 10 ** (v.pred + band.p75),
    capHi90: 10 ** (v.pred + band.p90), oddsParts: o.parts, b0: o.b0, odds, implied: Math.max(1, Math.round(cap * odds)), ageFilled: f.age === null,
    rangeKind: cr ? 'category' : 'global', rangeCat: cr ? cr.cat : null, rangeN: cr ? cr.n : 0,
  };
}

/** Nearest priced comps: close in TVL, same category preferred. */
export function nearestComps(m: Model, p: Protocol, k = 4): { slug: string; name: string; symbol: string; tvl: number; mcap: number; cat: string | null }[] {
  const f = featOf(p, m.asOf);
  return m.comps
    .map((c) => ({ c, d: Math.abs(c.f.tvl - f.tvl) + (c.f.cat === f.cat ? 0 : 0.6) }))
    .sort((a, b) => a.d - b.d || (a.c.p.slug < b.c.p.slug ? -1 : 1))
    .slice(0, k)
    .map(({ c }) => ({ slug: c.p.slug, name: c.p.name, symbol: c.p.symbol ?? '', tvl: c.p.tvl_usd, mcap: c.p.mcap_usd!, cat: c.p.category }));
}
