# Token launch radar (token-radar-01)

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/emasinves0-commits/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/emasinves0-commits/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty. It reads the sealed DefiLlama snapshot, finds protocols that record no token, prices what a launch could be worth, and writes a costed farm plan for each one. Node 22, standard library only, no network, deterministic.

v2 (radar-2.1): ranges are priced per kind — a category with at least eight priced comps gets its own leave-one-out residual band — and every row carries its break-even deposit, the minimum viable capital for its farm plan. The cover is tightened: the integrity strip and the ledger legend each fit on one row, and the board shows eight complete rows at the fold.

## What it does

* **Board**: 198 ranked rows: all 40 watchlist protocols, 138 early protocols below the $50M floor and 20 off-list protocols above it that the house list leaves out but that pass the same screen (pre-token, not CEX / bridge / liquid staking / restaking, no version marker, no whole word wrapped / staked / staking). Rank 1 has the highest implied value. Every row shows its break-even deposit under its farm verdict.
* **Ledger**: all 758 protocols fall in exactly one bucket (ranked watchlist / early / off-list, priced comps, token recorded with no usable cap, kin of a token, out: bridge / liquid staking / exchange / versioned or wrapped). The page re-adds them.
* **Integrity strip**: the page recomputes eight checks from `data.js` (row count, FNV-1a checksum, ranks 1..N, values never rise, totals, watchlist 40/40, ledger 758/758, tier counts) and answers them on the cover as 8/8 PASS.
* **Dashboard**: sortable and filterable board, tier and verdict tabs, farm sandbox (deposit, drop share, horizon) that re-scores every verdict live, CSV and JSON export, a detail drawer with the full model breakdown, plan and nearest comps, and a four-way compare.

## The model (`lib/model.ts`)

Everything is fitted from the snapshot; no protocol name appears in the code.

1. **Value model**: ridge regression of `log10(market cap)` on `log10(TVL)` over protocols whose token trades (one row per ticker, no exchange / bridge / liquid-staking products; 94 comps). Candidate terms are added in a fixed order (TVL, shrunk category effect, years listed, 7-day growth, chains) and kept only if they lower the held-out median miss in **both** a leave-one-out test and a walk-forward test (fit on protocols listed earlier, test on those listed later). Only `log10 TVL` survives: `log10 cap = 6.965 + 0.403 x (log10 TVL - 7.552)`. Held-out median miss: **3.62x** leave-one-out (flat median multiple: 4.60x), **2.60x** walk-forward (flat: 4.33x). Ranges come from the leave-one-out residuals (P25-P75 and P10-P90); the share of real caps inside them is 49% and 78% leave-one-out, 61% and 83% walk-forward.
2. **Ranges per kind (v2)**: the same leave-one-out misses, grouped by the comp's own category. Four categories clear the eight-comp bar — Lending (n=15), Dexs (n=11), RWA (n=9), Yield (n=9) — and their 68 board rows take their band from peers of their own kind; the other 130 rows use the global band. The bands differ honestly: RWA prices tight (P10-P90 −0.23 to +0.31 dex) while Lending spreads wide (−1.62 to +1.00 dex). The detail view names which band each protocol uses.
3. **Odds model**: logistic regression fitted by gradient descent on 310 peers (the probability a protocol ever records a token). Terms are tested the same way on Brier score. Kept: no-token age, 7-day growth, shrunk category effect; dropped: log TVL, chains. Brier **0.179** leave-one-out (base rate 0.232) and **0.225** walk-forward (base rate 0.290).
4. **Implied value = launch value x odds.** The detail view shows every term's multiplier.

Honest limits: market caps spread about 0.9 dex around the fit (TVL explains little of a token's cap), the 7-day growth term enters with a negative sign (peers with a token lost more TVL in the sealed week, partly because their TVL is priced in their own token), and the odds are association, not causation. The model prices a launch; it does not predict whether or when one happens.

## Farm plans (`lib/farm.ts`)

Each plan has six steps built from the protocol's own record: category picks the playbook, its chains pick the cheapest chain to work on (gas per chain is an editable assumption table), TVL and age set the warnings. Every step states an action, a cost (gas + capital + fees) and a time. Economics: `slice = implied x drop share x (deposit / TVL)`; `net = slice - gas - fees - 4% carry`; FARM needs net >= $20 and net/hour >= $10 of active work, THIN is net >= 0, SKIP is below. Defaults: $1,000, 20% drop share, 13 weeks (16 FARM, 60 THIN, 122 SKIP). Every row also carries its **break-even deposit** — the smallest deposit at which its plan pays for itself (101 of 198 rows break even at some deposit; the other 97 never do, because fees and carry outrun the slice at any size).

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (via `vendor/makefun-board.ts`) to `out/`, or `/output` when no override is given. Open `out/dashboard/index.html` (it loads `../data.js`). Two runs write identical bytes.

## Layout

`main.ts` entry, `lib/model.ts` fit and tests, `lib/farm.ts` plans and economics, `lib/radar.ts` board, ledger, checksum and `data.js`, `dashboard/` the static page, `screenshots/` three captures of it, `vendor/makefun-board.ts` the house dossier library (unchanged).

License: MIT.
