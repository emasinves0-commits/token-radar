// Assemble the radar: score every rankable protocol, rank by implied value, write farm plans, the ledger and
// the data the dashboard reads. Everything here is a function of the snapshot's bytes.
import { BUCKETS, bucketOf, fitModel, nearestComps, score, TERM_LABEL } from './model.ts';
import type { Bucket, Model, Protocol, Snapshot, Term } from './model.ts';
import { econ, planFor, stepText } from './farm.ts';

export const DEFAULTS = { deposit: 1000, drop: 0.2, weeks: 13 };

export interface BoardRow {
  slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[];
  tier: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null; age_years: number | null;
  token_odds: number; launch_value_usd: number; implied_range_p25_p75: [number, number]; verdict: string; net_usd: number; net_per_hour_usd: number;
}

/** FNV-1a (32-bit) over the UTF-8 bytes of a string, as 8 hex digits. The page runs the identical function. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text, 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** The canonical text the checksum covers: one JSON array [slug, rank, implied] per row in rank order. */
export const canonical = (rows: { s: string; k: number; v: number }[]): string => rows.map((r) => JSON.stringify([r.s, r.k, r.v])).join('\n');

const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const r4 = (x: number): number => Math.round(x * 10000) / 10000;
const TIER: Record<string, string> = { watch: 'W', early: 'E', off: 'O' };

export function buildRadar(snap: Snapshot): { board: BoardRow[]; data: unknown; model: Model } {
  const watch = new Set(snap.watchlist);
  const model = fitModel(snap);
  const counts = new Map<Bucket, number>(BUCKETS.map((b) => [b.k, 0]));
  const scored: { p: Protocol; b: Bucket; s: ReturnType<typeof score> }[] = [];
  for (const p of snap.protocols) {
    const b = bucketOf(p, watch, snap.floor_usd);
    counts.set(b, counts.get(b)! + 1);
    if (b === 'watch' || b === 'early' || b === 'off') scored.push({ p, b, s: score(model, p) });
  }
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = [];
  const rows: Record<string, unknown>[] = [];
  let total = 0;
  scored.forEach(({ p, b, s }, i) => {
    const plan = planFor(p, s.f.age, DEFAULTS.deposit);
    const e = econ(plan.steps, s.implied, p.tvl_usd, DEFAULTS.deposit, DEFAULTS.drop, DEFAULTS.weeks);
    const rank = i + 1;
    total += s.implied;
    const rg = [s.capLo10, s.capLo25, s.capHi75, s.capHi90].map((x) => Math.max(1, Math.round(x * s.odds)));
    board.push({
      slug: p.slug, name: p.name, rank, implied_value_usd: s.implied, farm_steps: plan.steps.map((st) => stepText(st, DEFAULTS.deposit, DEFAULTS.weeks)),
      tier: TIER[b]!, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_years: s.f.age === null ? null : r3(s.f.age),
      token_odds: r4(s.odds), launch_value_usd: Math.round(s.cap), implied_range_p25_p75: [rg[1]!, rg[2]!], verdict: e.verdict, net_usd: Math.round(e.net * 100) / 100, net_per_hour_usd: Math.round(e.perHour * 100) / 100,
    });
    rows.push({
      s: p.slug, n: p.name, k: rank, t: TIER[b], c: p.category, h: p.chains, ch: plan.chain, v: s.implied, tv: p.tvl_usd, g: p.change_7d, a: s.f.age === null ? null : r3(s.f.age),
      o: r4(s.odds), lv: Math.round(s.cap), r: rg, vt: s.valueParts.map(([t, x]) => [t, r3(x)]), ot: s.oddsParts.map(([t, x]) => [t, r3(x)]), c0: r3(s.c0), b0: r3(s.b0),
      st: plan.steps.map((st) => [st.a, r4(st.gas), r3(st.cap), r4(st.fee), st.min, st.w]),
      cm: nearestComps(model, p).map((c) => [c.name, c.symbol, c.tvl, c.mcap]),
    });
  });

  const ledger = BUCKETS.map((b) => ({ k: b.k, label: b.label, note: b.note, n: counts.get(b.k)! }));
  const grid = [5, 6, 7, 8, 9, 10, 11, 12];
  const synth = (x: number) => score(model, { ...snap.protocols[0]!, tvl_usd: 10 ** x, category: null, change_7d: null, listed_at: null, chains: ['x'], mcap_usd: null, gecko_id: null, symbol: null }).logCap;
  const fitInfo = {
    valueTable: model.valueTable, oddsTable: model.oddsTable, valueKept: model.valueKept.map((t) => TERM_LABEL[t]), oddsKept: model.oddsKept.map((t) => TERM_LABEL[t]),
    termLabel: TERM_LABEL as Record<Term, string>, resid: Object.fromEntries(Object.entries(model.resid).map(([k, v]) => [k, r3(v)])),
    calib: Object.fromEntries(Object.entries(model.calib).map(([k, v]) => [k, r4(v)])), miss: Object.fromEntries(Object.entries(model.missFinal).map(([k, v]) => [k, r3(v)])),
    oddsFinal: Object.fromEntries(Object.entries(model.oddsFinal).map(([k, v]) => [k, r4(v)])),
    valueCoef: { c0: r3(model.valueFit.c0), ...Object.fromEntries(Object.entries(model.valueFit.beta).map(([k, v]) => [k, r3(v!)])), nComps: model.comps.length },
    oddsCoef: model.oddsFit.w.slice(0, 1 + model.oddsKept.filter((t) => t !== 'cat').length).map(r3),
  };
  const data = {
    meta: { asOf: snap.as_of, source: snap.source, version: model.version, floor: snap.floor_usd, protocols: snap.protocols.length, defaults: DEFAULTS },
    rows, ledger, watch: snap.watchlist, fit: fitInfo,
    charts: {
      comps: model.comps.map((c) => [r3(c.f.tvl), r3(c.y)]), board: rows.map((r) => [r3(Math.log10(r.tv as number)), r3(Math.log10(r.v as number))]),
      line: grid.map((x) => [x, r3(synth(x))]), band: [r3(model.resid.p10), r3(model.resid.p90)], ageBars: model.ageBars.map((a) => ({ ...a, real: r4(a.real), pred: r4(a.pred) })),
    },
    check: { rows: rows.length, total, checksum: fnv1a(canonical(rows as { s: string; k: number; v: number }[])) },
  };
  return { board, data, model };
}

export const dataScript = (data: unknown): string => `window.RADAR=${JSON.stringify(data)};\n`;

/** The gate's own checks on a board, so a bad board never reaches /output. null when it passes. */
export function boardIssue(board: BoardRow[], snap: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `${board.length} rows`;
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Infinity;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!slugs.has(r.slug) || seen.has(r.slug)) return `slug ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `rank ${r.rank} at ${i + 1}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > prev) return `value at rank ${r.rank}`;
    prev = r.implied_value_usd;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.trim().length < 20 || s.trim().length > 600)) return `farm steps of ${r.slug}`;
  }
  for (const w of snap.watchlist) if (!seen.has(w)) return `watchlist slug ${w} missing`;
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'all values equal';
  return null;
}
