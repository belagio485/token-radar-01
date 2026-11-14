// Token launch radar: the value model and the farm plans.
//
// Everything here is derived from the sealed snapshot's own figures. No
// protocol name is hardcoded anywhere: the multiples come from the traded
// protocols in the same snapshot, the growth and age factors come from each
// protocol's own record, and the farm steps are built from its category and
// chains. Run the same snapshot twice and the board is byte-identical.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export type Momentum = "hot" | "warm" | "steady" | "cool";

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  days_listed: number | null;
  multiple: number;
  growth_factor: number;
  age_factor: number;
  breadth_factor: number;
  on_watchlist: boolean;
  is_early: boolean;
  momentum: Momentum;
}

export interface TradedReference {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface Board {
  rows: BoardRow[];
  traded_reference: TradedReference[];
  category_multiples: Record<string, number>;
  global_multiple: number;
  total_implied_value_usd: number;
  pre_token_count: number;
}

const DAY_MS = 86_400_000;
const MAX_IMPLIED_USD = 100_000_000_000_000;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Parse a YYYY-MM-DD day as a UTC timestamp, or null when it is not a day. */
function parseDay(day: string | null): number | null {
  if (day === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (m === null) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days between the snapshot date and the listing day; null when unknown. */
function daysListed(asOfMs: number, listedAt: string | null): number | null {
  const listedMs = parseDay(listedAt);
  if (listedMs === null) return null;
  const days = Math.floor((asOfMs - listedMs) / DAY_MS);
  return days < 0 ? 0 : days;
}

/**
 * A protocol records no token when DefiLlama's record carries neither a
 * CoinGecko id, nor a ticker, nor a market cap. The record is not proof a
 * token does not exist, only that none is recorded.
 */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/** Weekly momentum, capped so one wild week cannot dominate the model. */
function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  return 1 + (clamp(change7d, -60, 250) / 100) * 0.3;
}

/**
 * Time running with no token: value accrues with a track record, saturating
 * after about two and a half years. An unknown listing date takes a small
 * discount instead of the full factor.
 */
function ageFactor(days: number | null): number {
  if (days === null) return 0.9;
  return 0.75 + 0.25 * (Math.min(days, 900) / 900);
}

/** A protocol live on more chains reaches more users; capped at six chains. */
function breadthFactor(chains: string[]): number {
  return 1 + 0.04 * Math.min(Math.max(chains.length - 1, 0), 5);
}

function momentumOf(change7d: number | null): Momentum {
  if (change7d === null || !Number.isFinite(change7d)) return "steady";
  if (change7d >= 25) return "hot";
  if (change7d >= 5) return "warm";
  if (change7d <= -10) return "cool";
  return "steady";
}

/** Early find: listed within the last year and still growing. */
function isEarlyFind(days: number | null, change7d: number | null): boolean {
  return days !== null && days <= 365 && (change7d ?? 0) > 0;
}

interface Multiples {
  byCategory: Map<string, number>;
  global: number;
}

/**
 * Calibrate the TVL multiple from the snapshot itself: for each category, the
 * median market-cap-to-TVL ratio of the protocols in it whose token already
 * trades. Categories with too few traded comparables fall back to the global
 * median. Absurd ratios are dropped before the median so one bad record
 * cannot move a whole category.
 */
function calibrateMultiples(protocols: SnapshotProtocol[]): Multiples {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.mcap_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio < 0.02 || ratio > 100) continue;
    const key = (p.category ?? "").trim().toLowerCase();
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
    allRatios.push(ratio);
  }
  const global = allRatios.length > 0 ? median(allRatios) : 1;
  const byCategory = new Map<string, number>();
  for (const [key, ratios] of ratiosByCategory) {
    if (ratios.length >= 3) byCategory.set(key, clamp(median(ratios), 0.15, 10));
  }
  return { byCategory, global: clamp(global, 0.15, 10) };
}

function multipleFor(category: string | null, multiples: Multiples): number {
  const key = (category ?? "").trim().toLowerCase();
  return multiples.byCategory.get(key) ?? multiples.global;
}

type PlanKind =
  | "dex"
  | "lending"
  | "yield"
  | "derivatives"
  | "bridge"
  | "staking"
  | "rwa"
  | "gaming"
  | "insurance"
  | "launchpad"
  | "privacy"
  | "oracle"
  | "index"
  | "generic";

/** Classify a category string by keyword so new categories still get a plan. */
function planKindOf(category: string | null): PlanKind {
  const c = (category ?? "").toLowerCase();
  if (/stak|restak/.test(c)) return "staking";
  if (/bridge/.test(c)) return "bridge";
  if (/lend/.test(c)) return "lending";
  if (/dex|exchange/.test(c)) return "dex";
  if (/deriv|perp|option|future/.test(c)) return "derivatives";
  if (/yield|farm|vault/.test(c)) return "yield";
  if (/rwa|real.world/.test(c)) return "rwa";
  if (/gam|nft|collect/.test(c)) return "gaming";
  if (/insur/.test(c)) return "insurance";
  if (/launch/.test(c)) return "launchpad";
  if (/privacy|mixer/.test(c)) return "privacy";
  if (/oracle/.test(c)) return "oracle";
  if (/index/.test(c)) return "index";
  return "generic";
}

/** A plain-words gas note for the protocol's first chain, by chain family. */
function gasNoteFor(chain: string | null): string {
  if (chain === null) return "gas costs vary by chain, so budget a few dollars per transaction";
  const c = chain.toLowerCase();
  if (c.includes("ethereum")) return `gas on ${chain} runs $4–$20 per transaction`;
  if (c.includes("solana")) return `fees on ${chain} run under $0.05 per transaction`;
  if (/arbitrum|optimism|base|blast|zksync|linea|scroll|mantle|mode|starknet|zora|fraxtal|ink|unichain|soneium|abstract|world/.test(c)) {
    return `gas on ${chain} runs under $1 per transaction`;
  }
  if (/bnb|bsc|binance/.test(c)) return `fees on ${chain} run about $0.10–$0.50 per transaction`;
  return `gas on ${chain} typically runs a few dollars per transaction`;
}

interface PlanVars {
  name: string;
  size: string;
  chain: string;
  gas: string;
  horizon: string;
}

function fill(template: string, v: PlanVars): string {
  return template
    .split("{name}")
    .join(v.name)
    .split("{size}")
    .join(v.size)
    .split("{chain}")
    .join(v.chain)
    .split("{gas}")
    .join(v.gas)
    .split("{horizon}")
    .join(v.horizon);
}

const CORE_STEPS: Record<PlanKind, [string, string, string]> = {
  dex: [
    "Swap {size} across at least 3 different pairs on {name} over the first week, splitting the trades across 3 separate days so the activity reads as organic rather than one burst.",
    "Add {size} to one of {name}'s deeper liquidity pools and hold the position for {horizon}, collecting trading fees while it ages; check impermanent loss weekly (10 minutes a week).",
    "Repeat a swap or a small liquidity top-up every week for {horizon}, and complete any points or quest tasks {name} lists, keeping a dated log of every transaction hash.",
  ],
  lending: [
    "Supply {size} in stablecoins to {name}'s lending market on {chain} and leave it supplied for {horizon}; the position earns yield while it counts toward activity.",
    "Borrow a small amount, under 30% of your collateral, against the supply, then repay it after about 2 weeks, so the plan records both sides of the market.",
    "Top up or rebalance the position weekly for {horizon}, and vote or leave feedback if {name} opens governance or community tasks.",
  ],
  yield: [
    "Deposit {size} into {name}'s highest-TVL vault on {chain} and hold for {horizon}; an auto-compounding vault needs no further action after deposit.",
    "Stake the vault receipt token if {name} offers a staking or gauge contract, and claim rewards weekly rather than daily to save on transaction fees.",
    "Review the vault's yield and TVL weekly for {horizon}; move only if TVL drops by half, and keep a log of every deposit and claim.",
  ],
  derivatives: [
    "Open 3 small positions on {name} ({chain}) totalling {size} over 2 weeks, using at most 3x leverage with a stop loss on each; never risk more than you can lose.",
    "Close and reopen one position a week for {horizon} to build steady trading volume, keeping total trading fees under 1% of {size}.",
    "Try one advanced feature — limit orders, take-profit/stop-loss, or a vault — and complete any trading quests {name} lists, saving screenshots of fills.",
  ],
  bridge: [
    "Bridge {size} from {chain} to one other chain through {name} twice in the first 2 weeks, waiting for finality each time (10–30 minutes per transfer).",
    "Bridge a second, smaller amount back in the opposite direction in week 3, and use {name}'s native gas or refuel feature if it offers one.",
    "Repeat one bridge transfer a month for {horizon}, varying the amount and destination chain, and keep every transaction hash in your log.",
  ],
  staking: [
    "Stake {size} through {name} on {chain} and hold the receipt token for {horizon}; restaking receipts can be reused in DeFi, but each extra layer adds smart-contract risk.",
    "Delegate or restake the receipt token if {name} supports it, and claim staking rewards every 2 weeks rather than daily.",
    "Check the validator or operator set monthly and plan exits early: unstaking can take days to weeks, so leave before {name}'s TVL falls by half.",
  ],
  rwa: [
    "Complete any identity or allowlist step {name} requires (usually 1–3 days), then allocate {size} to its tokenized product on {chain}.",
    "Hold the position for {horizon}, collecting the stated yield, and read the product's backing or attestation reports each month.",
    "Reinvest or top up monthly if the product allows it, and confirm the redemption window and lock-up before committing more funds.",
  ],
  gaming: [
    "Create a profile for {name}, fund it with {size} on {chain}, and finish the onboarding quests in the first week (about 1 hour total).",
    "Play or transact for 15–30 minutes a day over {horizon}, completing seasonal quests and holding earned items rather than flipping them at once.",
    "Join {name}'s community channel, report one bug or suggestion, and keep a weekly log of activity for any future points review.",
  ],
  insurance: [
    "Buy cover, or provide underwriting capital of {size}, on {name} ({chain}) for a 4-week cover period, reading exactly which events are covered first.",
    "Renew or rotate the cover once during {horizon}, and stake in the underwriting pool if {name} offers one.",
    "Track claims activity monthly; if a claim event occurs, follow {name}'s claim process exactly and keep every receipt.",
  ],
  launchpad: [
    "Register and complete any identity or allowlist step for {name} (1–3 days), then stake or hold {size} to reach the lowest participation tier.",
    "Join one sale or allocation round during {horizon}, committing only what you can lock for the stated vesting period.",
    "Vote on one project listing or community proposal, and keep the staked position for the full {horizon}.",
  ],
  privacy: [
    "Fund a fresh wallet with {size} on {chain} and route one private transfer through {name}, checking the anonymity set size before you send.",
    "Repeat with varied amounts over {horizon}, never reusing addresses between private and public activity.",
    "Run a relayer or node if {name} offers one, or complete its privacy quests, budgeting about 1 hour a week.",
  ],
  oracle: [
    "Read {name}'s feed documentation and query one price feed from a test script (1–2 hours) to understand the data it serves.",
    "Stake or delegate {size} to a {name} node or data provider if open participation exists, and hold for {horizon}.",
    "Monitor feed uptime weekly and report one data issue or improvement to the team with a reproducible example.",
  ],
  index: [
    "Buy {size} of {name}'s index token on {chain} and hold for {horizon}, rebalancing only if the index composition changes.",
    "Stake the index token if {name} offers yield on it, and review the underlying constituents once a month.",
    "Vote on one index rebalance or inclusion proposal during {horizon}.",
  ],
  generic: [
    "Use {name}'s core feature on {chain} with {size} in the first week — deposit, swap, or stake, whichever it offers — and keep the position open.",
    "Repeat the core action weekly for {horizon}, varying the amounts, and complete any points, quest, or feedback tasks {name} lists.",
    "Check {name}'s announcements weekly for seasons or snapshots, and keep a dated log of every transaction.",
  ],
};

/**
 * Five concrete steps per protocol: setup, three category-specific actions,
 * and a safety step. Amounts scale with the protocol's TVL tier and the
 * horizon with its age, so the plan fits the protocol instead of repeating
 * one script. Every step is trimmed and capped so it always fits the gate.
 */
export function buildFarmSteps(p: SnapshotProtocol, days: number | null): string[] {
  const size = p.tvl_usd >= 1_000_000_000 ? "$100–$500" : p.tvl_usd >= 100_000_000 ? "$50–$250" : "$25–$100";
  const horizon = days !== null && days > 365 ? "8–12 weeks" : "4–8 weeks";
  const chain = p.chains.length > 0 ? p.chains[0] : "its home chain";
  const vars: PlanVars = {
    name: p.name,
    size,
    chain,
    gas: gasNoteFor(p.chains.length > 0 ? p.chains[0] : null),
    horizon,
  };
  const steps = [
    `Set up a fresh wallet and fund it with ${vars.size} on ${vars.chain}; ${vars.gas}. Budget 20 minutes for setup and keep a small gas reserve apart from the farming amount.`,
    ...CORE_STEPS[planKindOf(p.category)].map((t) => fill(t, vars)),
    `Stay safe: verify every contract address against the protocol's DefiLlama listing before approving, revoke unused token approvals monthly, and never share your seed phrase. A token launch is never guaranteed — only farm with funds you can lock for ${vars.horizon}.`,
  ];
  return steps.map((s) => {
    const trimmed = s.trim();
    return trimmed.length > 600 ? `${trimmed.slice(0, 597).trimEnd()}...` : trimmed;
  });
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Build the board: every protocol that records no token, ranked by the
 * implied value of its launch. The watchlist is covered by construction,
 * because every watchlist protocol records no token; the rest of the board
 * is the early finds below the floor. Rows sort by implied value, then TVL,
 * then slug, so the order is fully deterministic.
 */
export function buildBoard(snapshot: Snapshot): Board {
  const asOfMs = parseDay(snapshot.as_of);
  if (asOfMs === null) throw new Error(`snapshot as_of is not a day: ${snapshot.as_of}`);
  const watchlist = new Set(snapshot.watchlist);
  const multiples = calibrateMultiples(snapshot.protocols);

  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) continue;
    const days = daysListed(asOfMs, p.listed_at);
    const multiple = multipleFor(p.category, multiples);
    const growth = growthFactor(p.change_7d);
    const age = ageFactor(days);
    const breadth = breadthFactor(p.chains);
    const implied = Math.min(
      MAX_IMPLIED_USD,
      Math.max(1, Math.round(p.tvl_usd * multiple * growth * age * breadth)),
    );
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: buildFarmSteps(p, days),
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      days_listed: days,
      multiple,
      growth_factor: growth,
      age_factor: age,
      breadth_factor: breadth,
      on_watchlist: watchlist.has(p.slug),
      is_early: isEarlyFind(days, p.change_7d),
      momentum: momentumOf(p.change_7d),
    });
  }
  rows.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
    if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
    return compareText(a.slug, b.slug);
  });
  for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;

  const traded = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      ratio: (p.mcap_usd as number) / p.tvl_usd,
    }))
    .sort((a, b) => {
      if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return compareText(a.slug, b.slug);
    })
    .slice(0, 12);

  const categoryMultiples: Record<string, number> = {};
  const seen = new Set<string>();
  for (const p of snapshot.protocols) {
    const label = (p.category ?? "Uncategorized").trim() || "Uncategorized";
    if (seen.has(label)) continue;
    seen.add(label);
    const key = (p.category ?? "").trim().toLowerCase();
    const value = multiples.byCategory.get(key);
    if (value !== undefined) categoryMultiples[label] = Math.round(value * 10000) / 10000;
  }

  let total = 0;
  for (const r of rows) total += r.implied_value_usd;
  return {
    rows,
    traded_reference: traded,
    category_multiples: categoryMultiples,
    global_multiple: Math.round(multiples.global * 10000) / 10000,
    total_implied_value_usd: total,
    pre_token_count: rows.length,
  };
}
