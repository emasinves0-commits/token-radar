// Farm plans, derived from each protocol's own record: its category picks the playbook, its chains pick where
// the farmer pays gas, its TVL and age set the warnings and the pace. The cost model is shared with the page:
// every step carries gas (USD), capital and fees (fractions of the deposit) and minutes, so the page can
// recompute a plan live when the deposit or the horizon changes.
import type { Protocol } from './model.ts';

/** Assumed USD gas for one ordinary contract call by chain (an editable assumption, not a measurement). */
const GAS_USD: Record<string, number> = {
  Ethereum: 1.2, Bitcoin: 1.5, Tron: 0.8, BSC: 0.08, Avalanche: 0.06, Polygon: 0.02, Base: 0.02, Arbitrum: 0.03, Optimism: 0.02,
  Solana: 0.01, Sui: 0.02, Aptos: 0.02, Mantle: 0.03, Linea: 0.04, Scroll: 0.04, Blast: 0.03, Unichain: 0.02, Sonic: 0.02, Hyperliquid: 0.01,
};
const GAS_DEFAULT = 0.15;
/** Chains a centralised exchange pays out to directly (flat withdrawal fee); any other chain needs a bridge from Ethereum. */
const DIRECT = new Set(['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'Avalanche', 'Tron', 'Bitcoin', 'Sui', 'Aptos']);
const WITHDRAW_FEE = 0.8;
const BRIDGE_FEE = 0.0006;

export interface Step { a: string; gas: number; cap: number; fee: number; min: number; w: 0 | 1 }
export interface Plan { chain: string; family: string; tx: number; steps: Step[] }

type Family = 'dex' | 'lend' | 'yield' | 'deriv' | 'asset';
const FAMILY: Record<string, Family> = {
  Dexs: 'dex', 'Liquidity Manager': 'dex', Launchpad: 'dex', Indexes: 'dex',
  Lending: 'lend', 'Uncollateralized Lending': 'lend', CDP: 'lend', 'CDP Manager': 'lend', 'Collateral Management': 'lend', 'Collateral Markets': 'lend', 'Interest Rate Derivatives': 'lend',
  Yield: 'yield', 'Yield Aggregator': 'yield', Farm: 'yield', 'Leveraged Farming': 'yield', 'Basis Trading': 'yield', 'Onchain Capital Allocator': 'yield', 'Risk Curators': 'yield',
  'Staking Pool': 'yield', Restaking: 'yield', 'Options Vault': 'yield', 'Token Locker': 'yield', 'Governance Incentives': 'yield',
  Derivatives: 'deriv', Options: 'deriv', Synthetics: 'deriv', 'Prediction Market': 'deriv', Insurance: 'deriv', 'Cross Chain Bridge': 'deriv',
};
export const familyOf = (cat: string | null): Family => (cat !== null && FAMILY[cat]) || 'asset';

export const usd = (x: number): string => (x >= 100 ? `$${Math.round(x).toLocaleString('en-US')}` : x >= 10 ? `$${x.toFixed(1)}` : `$${x.toFixed(2)}`);
export const compact = (x: number): string => (x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(0)}K` : `$${Math.round(x)}`);

/** The chain the farmer works on: the cheapest of the protocol's own chains (ties by name). */
export function farmChain(chains: string[]): string {
  const list = chains.length ? [...chains] : ['Ethereum'];
  return list.sort((a, b) => (GAS_USD[a] ?? GAS_DEFAULT) - (GAS_USD[b] ?? GAS_DEFAULT) || (a < b ? -1 : 1))[0]!;
}

export function planFor(p: Protocol, ageYears: number | null, deposit = 1000): Plan {
  const chain = farmChain(p.chains);
  const tx = GAS_USD[chain] ?? GAS_DEFAULT;
  const fam = familyOf(p.category);
  const cat = p.category ?? 'core';
  const tvl = compact(p.tvl_usd);
  const young = ageYears !== null && ageYears < 0.75;
  const old = ageYears !== null && ageYears >= 2.5;
  const pace = young
    ? 'It is young, so early deposits are the likeliest to be counted'
    : old
      ? 'It has run over two years with no token, so keep the hours low'
      : ageYears === null ? 'Its listing date is unreported, so size the effort cautiously' : 'Mid-age with no token, so budget a steady, cheap routine';
  const g = p.change_7d;
  const trend = g === null ? 'TVL trend unreported' : g >= 10 ? `TVL is up ${g.toFixed(0)}% on the week, so your share dilutes fast` : g <= -10 ? `TVL is down ${Math.abs(g).toFixed(0)}% on the week, so check for withdrawals before depositing` : `TVL moved ${g.toFixed(1)}% on the week`;
  const direct = DIRECT.has(chain);
  const fund: Step = direct
    ? { a: `Fund a fresh wallet on ${chain}: withdraw the deposit in stablecoins from an exchange straight to it.`, gas: WITHDRAW_FEE, cap: 1, fee: 0, min: 15, w: 0 }
    : { a: `Fund a fresh wallet on ${chain}: withdraw to Ethereum, then bridge the deposit across (a bridge fee plus one Ethereum call).`, gas: WITHDRAW_FEE + (GAS_USD.Ethereum ?? 1.2) + tx, cap: 1, fee: BRIDGE_FEE, min: 30, w: 0 };
  const scout: Step = {
    a: `Scout ${p.name}: confirm its ${cat} contracts and docs, read the pool or market list, and note the incentive pages. ${tvl} TVL${ageYears === null ? '' : `, ${ageYears.toFixed(1)} years listed`}. ${trend}. ${pace}.`,
    gas: 0, cap: 0, fee: 0, min: 20, w: 0,
  };
  const wk: Step = { a: '', gas: tx, cap: 0, fee: 0, min: 8, w: 1 };
  const exit: Step = {
    a: `Exit at the horizon: withdraw everything on ${p.name}, check its announcements for a snapshot or points tally, and send the funds home.`,
    gas: tx * 2 + WITHDRAW_FEE, cap: 0, fee: 0.0005, min: 15, w: 0,
  };
  let core: Step[];
  if (fam === 'dex') {
    core = [
      { a: `Swap about a third of the deposit across three of ${p.name}'s most liquid pairs on ${chain}, a small round trip each, to register volume.`, gas: tx * 6, cap: 0.33, fee: 0.0012, min: 25, w: 0 },
      { a: `Add liquidity to its deepest pool with the rest of the deposit (approve, then add) and keep the position in range.`, gas: tx * 2, cap: 0.67, fee: 0.0005, min: 15, w: 0 },
    ];
    wk.a = `Weekly: one swap and a check that the liquidity position is still in range and earning.`;
  } else if (fam === 'lend') {
    core = [
      { a: `Supply the deposit as collateral in ${p.name}'s most liquid market on ${chain} (approve, then supply).`, gas: tx * 2, cap: 1, fee: 0, min: 15, w: 0 },
      { a: `Borrow roughly a quarter of the collateral value in a stablecoin, hold it, and keep the loan-to-value well under the limit.`, gas: tx, cap: 0.25, fee: 0.001, min: 10, w: 0 },
    ];
    wk.a = `Weekly: check health factor and the borrow rate, top up or repay a little to stay active.`;
  } else if (fam === 'yield') {
    core = [
      { a: `Deposit about 70% into ${p.name}'s largest vault or strategy on ${chain} (approve, then deposit) and keep the receipt token in the same wallet.`, gas: tx * 2, cap: 0.7, fee: 0.0005, min: 15, w: 0 },
      { a: `Put the remaining 30% in its second-largest vault, so the wallet holds two positions, and record both entry prices.`, gas: tx * 2, cap: 0.3, fee: 0.0005, min: 15, w: 0 },
    ];
    wk.a = `Weekly: check vault yield and any boost or lock page, and compound or re-deposit once.`;
  } else if (fam === 'deriv') {
    core = [
      { a: `Post the deposit as margin or liquidity on ${p.name} (${chain}); keep it unlevered so one move cannot liquidate it.`, gas: tx * 2, cap: 1, fee: 0, min: 15, w: 0 },
      { a: `Trade four small positions, about a fifth of the margin each, opening and closing to build volume and a trade history.`, gas: tx * 8, cap: 0.2, fee: 0.004, min: 30, w: 0 },
    ];
    wk.a = `Weekly: one small open-and-close trade, and a check of margin and funding.`;
  } else {
    core = [
      { a: `Use ${p.name}'s core product once with the deposit on ${chain}: mint, subscribe or deposit through its main page.`, gas: tx * 3, cap: 1, fee: 0.001, min: 20, w: 0 },
      { a: `Touch its second feature (a transfer, a redeem and re-mint, or a referral link) so the wallet shows more than one kind of use.`, gas: tx * 2, cap: 0.2, fee: 0.0005, min: 15, w: 0 },
    ];
    wk.a = `Weekly: one small use of the product and a look at its points or rewards page.`;
  }
  const steps = [fund, scout, ...core, wk, exit];
  return { chain, family: fam, tx, steps };
}

/** One step as the board's text, at the stated deposit: action, cost, time. */
export function stepText(s: Step, deposit: number, weeks: number): string {
  const cap = s.cap * deposit, fee = s.fee * deposit;
  const cost = `Cost: ${usd(s.gas)} gas${s.w ? ' a week' : ''}, ${cap > 0 ? `${usd(cap)} of capital` : 'no capital'}${fee > 0 ? `, ${usd(fee)} fees` : ''}.`;
  return `${s.a} ${cost} Time: ${s.min} min${s.w ? ` a week for ${weeks} weeks` : ''}.`;
}

export interface Econ { expected: number; gas: number; fees: number; carry: number; net: number; hours: number; perHour: number; verdict: 'FARM' | 'THIN' | 'SKIP' }
export const CARRY_APR = 0.04;
/** The economics of a plan: slice = implied x drop share x deposit / TVL. The page runs this same arithmetic live. */
export function econ(steps: Step[], implied: number, tvl: number, deposit: number, dropShare: number, weeks: number): Econ {
  let gas = 0, fees = 0, mins = 0;
  for (const s of steps) {
    const k = s.w ? weeks : 1;
    gas += s.gas * k; fees += s.fee * deposit; mins += s.min * k;
  }
  const expected = implied * dropShare * (deposit / tvl);
  const carry = deposit * CARRY_APR * (weeks / 52);
  const net = expected - gas - fees - carry;
  const hours = mins / 60;
  const perHour = net / hours;
  return { expected, gas, fees, carry, net, hours, perHour, verdict: net >= 20 && perHour >= 10 ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP' };
}
