/**
 * Token Launch Radar — main.ts
 *
 * Builds board.json: a ranked board of upcoming / recent token launches.
 *
 * DATA HONESTY NOTE
 * -----------------
 * Every entry in this file is SIMULATED EXAMPLE DATA, constructed locally
 * from the name/chain/category seed tables below plus a deterministic PRNG.
 * It is NOT real on-chain data, NOT scraped from any launchpad, and must not
 * be presented or traded on as if it were real. The point of this entry is
 * the radar pipeline (scoring -> valuation -> farm plan -> board), which can
 * be re-pointed at a real data source by replacing `buildSeeds()`.
 *
 * Run (Node 22+):
 *   node main.ts                        # Node 23/24: native type stripping
 *   node --experimental-strip-types main.ts   # Node 22
 * Outputs:
 *   board.json            (next to this file)
 *   dashboard/data.js     (embedded copy for the offline dashboard)
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- types

interface Heat {
  socialMentions24h: number;
  searchTrendIndex: number; // 0..100
  holderGrowthPct24h: number;
  heatScore: number; // 0..100, computed
}

interface FarmPlan {
  strategy: string;
  suggestedAllocationPct: number; // % of a hypothetical farm budget, 0 = do not allocate
  entryWindow: string;
  actions: string[];
  exitRule: string;
  reviewCadence: string;
}

interface TokenEntry {
  id: string;
  rank: number;
  name: string;
  symbol: string;
  chain: string;
  category: string;
  narrative: string;
  launchTimeUtc: string;
  launchStatus: "upcoming" | "live" | "ended";
  hoursToLaunch: number;
  initialMarketCapUsd: number;
  liquidityUsd: number;
  liquidityLockedPct: number;
  circulatingSupplyPct: number;
  vestingMonths: number;
  auditStatus: "audited" | "partial" | "none" | "unknown";
  teamDoxxed: boolean;
  heat: Heat;
  riskScore: number; // 0..100, higher = riskier
  riskLevel: "low" | "medium" | "high" | "extreme";
  opportunityScore: number; // 0..100, computed
  estimatedValueUsd: number; // estimated fair market cap after launch stabilises
  estimatedValue: { fairMarketCapUsd: number; upsideMultiple: number; method: string };
  farmPlan: FarmPlan;
  dataNote: string;
}

const DATA_NOTE =
  "Simulated example data for demonstration only — not real on-chain data, not financial advice.";

// ------------------------------------------------------- deterministic PRNG

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261126);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number): number => min + rand() * (max - min);
const intBetween = (min: number, max: number): number => Math.floor(between(min, max + 1));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const money = (n: number): number => Math.round(n);

// ------------------------------------------------------------- seed tables

const CHAINS = ["Solana", "Ethereum", "Base", "Arbitrum", "BNB Chain", "Sui", "Avalanche", "Aptos"] as const;

const CATEGORIES: ReadonlyArray<{ category: string; narrative: string; prefixes: string[]; suffixes: string[] }> = [
  { category: "AI", narrative: "AI agents / inference network", prefixes: ["Neural", "Cortex", "Synapse", "Vector", "Oracle", "Mind", "Agent", "Tensor"], suffixes: ["AI", "Mind", "Net", "Labs", "Protocol"] },
  { category: "DePIN", narrative: "Decentralised physical infrastructure", prefixes: ["Grid", "Mesh", "Relay", "Beacon", "Volt", "Aero", "Terra", "Signal"], suffixes: ["Mesh", "Grid", "Link", "Works", "Network"] },
  { category: "Gaming", narrative: "On-chain game / game studio token", prefixes: ["Pixel", "Quest", "Arena", "Loot", "Forge", "Realm", "Blitz", "Nova"], suffixes: ["Quest", "Arena", "Play", "Realms", "GG"] },
  { category: "Meme", narrative: "Community meme token", prefixes: ["Turbo", "Moon", "Doge", "Pepe", "Wif", "Bonk", "Silly", "Chad"], suffixes: ["Cat", "Frog", "Moon", "Wif", "Coin"] },
  { category: "DeFi", narrative: "DEX / lending / yield protocol", prefixes: ["Delta", "Apex", "Vault", "Swap", "Lend", "Yield", "Prime", "Flux"], suffixes: ["Swap", "Fi", "Vault", "Markets", "Lend"] },
  { category: "RWA", narrative: "Real-world asset tokenisation", prefixes: ["Asset", "Brick", "Gold", "Harvest", "Bond", "Estate", "Carbon", "Trade"], suffixes: ["Chain", "Assets", "RWA", "Ledger", "Trust"] },
  { category: "Infra", narrative: "L2 / data / interoperability infra", prefixes: ["Hyper", "Omni", "Bridge", "Data", "Roll", "Zero", "Para", "Inter"], suffixes: ["Layer", "Bridge", "Roll", "Link", "Stack"] },
  { category: "Social", narrative: "Social / creator platform token", prefixes: ["Social", "Creator", "Wave", "Buzz", "Tribe", "Echo", "Vibe", "Fan"], suffixes: ["Social", "Tribe", "Wave", "Club", "Fans"] },
];

interface Seed {
  name: string;
  symbol: string;
  chain: string;
  category: string;
  narrative: string;
}

function buildSeeds(count: number): Seed[] {
  const seeds: Seed[] = [];
  const used = new Set<string>();
  let i = 0;
  while (seeds.length < count) {
    const c = CATEGORIES[i % CATEGORIES.length];
    const name = `${pick(c.prefixes)}${pick(c.suffixes)}`;
    if (used.has(name)) { i++; continue; }
    used.add(name);
    const symbol = name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase().padEnd(3, "X") + (seeds.length % 7 === 0 ? "2" : "");
    seeds.push({ name, symbol, chain: pick(CHAINS), category: c.category, narrative: c.narrative });
    i++;
  }
  return seeds;
}

// --------------------------------------------------------------- scoring

function riskLevelOf(score: number): TokenEntry["riskLevel"] {
  if (score < 35) return "low";
  if (score < 55) return "medium";
  if (score < 75) return "high";
  return "extreme";
}

function farmPlanFor(risk: number, level: TokenEntry["riskLevel"], status: TokenEntry["launchStatus"], heatScore: number): FarmPlan {
  if (level === "extreme") {
    return {
      strategy: "Monitor only — do not allocate",
      suggestedAllocationPct: 0,
      entryWindow: "No entry planned; revisit only if audit + lock improve",
      actions: ["Add to watchlist", "Verify audit and liquidity lock manually", "Set alert for post-launch holder growth"],
      exitRule: "N/A — no position",
      reviewCadence: "Weekly re-check of risk inputs",
    };
  }
  if (level === "high") {
    return {
      strategy: heatScore >= 60 ? "Small snipe + fast ladder-out" : "Wait for post-launch dip",
      suggestedAllocationPct: 1,
      entryWindow: status === "upcoming" ? "First 15 minutes, limit orders only" : "On a 20-30% pullback from launch high",
      actions: ["Cap position at 1% of farm budget", "Pre-set staged sell orders", "No leverage, no chasing green candles"],
      exitRule: "Sell 50% at 2x, remainder at 3x or on risk score rising above 80",
      reviewCadence: "Hourly for first 24h, then daily",
    };
  }
  if (level === "medium") {
    return {
      strategy: "Staged entry + points/airdrop farm where offered",
      suggestedAllocationPct: 3,
      entryWindow: status === "upcoming" ? "Launch + first hour, in 3 tranches" : "Staged over 24h",
      actions: ["Enter in 3 equal tranches", "Complete official points/quest tasks if any", "Provide LP only if lock >= 80% and fees justify impermanent loss"],
      exitRule: "Trim 30% at 2.5x, trail the rest with a 25% stop from peak",
      reviewCadence: "Daily for first week, then weekly",
    };
  }
  return {
    strategy: "Core farm — staged entry + LP / staking",
    suggestedAllocationPct: 5,
    entryWindow: status === "upcoming" ? "Launch day, staged" : "Staged over 48h",
    actions: ["Enter in 3 tranches", "Stake / LP the core position for yield", "Farm official points programme if present"],
    exitRule: "Hold core; rebalance if position exceeds 8% of budget or fundamentals change",
    reviewCadence: "Weekly",
  };
}

function buildEntry(seed: Seed, index: number, now: Date): TokenEntry {
  const hoursToLaunch = intBetween(-72, 240); // some already live, most upcoming
  const launch = new Date(now.getTime() + hoursToLaunch * 3600_000);
  const status: TokenEntry["launchStatus"] = hoursToLaunch < -24 ? "ended" : hoursToLaunch <= 0 ? "live" : "upcoming";

  const initialMarketCapUsd = money(between(150_000, 85_000_000));
  const liquidityUsd = money(initialMarketCapUsd * between(0.04, 0.45));
  const liquidityLockedPct = intBetween(0, 100);
  const circulatingSupplyPct = intBetween(8, 90);
  const vestingMonths = pick([0, 3, 6, 12, 18, 24, 36]);
  const auditStatus = pick(["audited", "audited", "partial", "none", "unknown"] as const);
  const teamDoxxed = rand() > 0.45;

  const socialMentions24h = intBetween(40, 48_000);
  const searchTrendIndex = intBetween(3, 100);
  const holderGrowthPct24h = round2(between(-8, 160));
  const heatScore = Math.round(
    Math.min(100, Math.max(0,
      0.45 * searchTrendIndex +
      0.35 * Math.min(100, Math.log10(socialMentions24h + 1) * 22) +
      0.20 * Math.min(100, Math.max(0, holderGrowthPct24h)),
    )),
  );

  // Risk: unaudited, unlocked liquidity, anonymous team, low float all add risk.
  let risk = 18;
  if (auditStatus === "none") risk += 22; else if (auditStatus === "unknown") risk += 16; else if (auditStatus === "partial") risk += 9;
  if (!teamDoxxed) risk += 12;
  if (liquidityLockedPct < 50) risk += 16; else if (liquidityLockedPct < 80) risk += 7;
  if (circulatingSupplyPct < 20) risk += 12;
  if (vestingMonths === 0) risk += 8;
  if (liquidityUsd < 250_000) risk += 10;
  if (seed.category === "Meme") risk += 10;
  risk = Math.round(Math.min(97, Math.max(4, risk + between(-6, 6))));
  const riskLevel = riskLevelOf(risk);

  // Valuation: heat and liquidity support a higher fair cap; risk discounts it.
  const upsideMultiple = round2(Math.max(0.25, (0.6 + heatScore / 55) * (1 - risk / 160) * between(0.8, 1.35)));
  const estimatedValueUsd = money(initialMarketCapUsd * upsideMultiple);
  const opportunityScore = Math.round(Math.min(100, Math.max(0, heatScore * 0.55 + (100 - risk) * 0.35 + Math.min(10, liquidityUsd / 1_000_000))));

  return {
    id: `sim-${String(index + 1).padStart(3, "0")}`,
    rank: 0, // assigned after sorting
    name: seed.name,
    symbol: seed.symbol,
    chain: seed.chain,
    category: seed.category,
    narrative: seed.narrative,
    launchTimeUtc: launch.toISOString(),
    launchStatus: status,
    hoursToLaunch,
    initialMarketCapUsd,
    liquidityUsd,
    liquidityLockedPct,
    circulatingSupplyPct,
    vestingMonths,
    auditStatus,
    teamDoxxed,
    heat: { socialMentions24h, searchTrendIndex, holderGrowthPct24h, heatScore },
    riskScore: risk,
    riskLevel,
    opportunityScore,
    estimatedValueUsd,
    estimatedValue: {
      fairMarketCapUsd: estimatedValueUsd,
      upsideMultiple,
      method: "heat/liquidity-supported fair-cap multiple, discounted by risk score (see README)",
    },
    farmPlan: farmPlanFor(risk, riskLevel, status, heatScore),
    dataNote: DATA_NOTE,
  };
}

// ------------------------------------------------------------------ main

function main(): void {
  const now = new Date("2026-11-26T00:00:00.000Z"); // fixed anchor -> reproducible board
  const entries = buildSeeds(120)
    .map((s, i) => buildEntry(s, i, now))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .map((e, i) => ({ ...e, rank: i + 1 }));

  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, "board.json"), JSON.stringify(entries, null, 2) + "\n", "utf8");
  writeFileSync(
    join(here, "dashboard", "data.js"),
    "// Embedded copy of board.json for offline dashboard use. Simulated example data only.\n" +
      `window.BOARD_DATA = ${JSON.stringify(entries)};\n`,
    "utf8",
  );
  console.log(`board.json written: ${entries.length} entries`);
  console.log(`top entry: #1 ${entries[0].name} (${entries[0].symbol}) opportunity=${entries[0].opportunityScore}`);
}

main();
