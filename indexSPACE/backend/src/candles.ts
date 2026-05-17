import type { Database } from "bun:sqlite";

const CANDLE_SEED_VERSION = 5;
const MIN5_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Hourly candles for days 3–90 (2088 buckets), 5-min for last 3 days (864 buckets)
const SEED_RECENT_DAYS = 3;
const SEED_TOTAL_DAYS = 90;
const SEED_HOURS_HOURLY = (SEED_TOTAL_DAYS - SEED_RECENT_DAYS) * 24;
const SEED_5MIN_BUCKETS = SEED_RECENT_DAYS * 24 * 12;

// NAV baseline ~100 (index-style, not near-par). Keep the seeded fund modest so
// drawer stats and chart-era share supply read like a smaller demo vehicle.
const NAV_MEAN = 100.0;
const NAV_FLOOR = 82.0;
const NAV_CEIL = 140.0;
const NAV_STEP_VOL_HOURLY = 0.18;      // ≈0.18% relative vol per hour
const NAV_STEP_VOL_5MIN = NAV_STEP_VOL_HOURLY / Math.sqrt(12);

const VAULT_START_NAV: Record<string, number> = {
  "ai-acceleration":  94.0,   // starts below benchmark, trending up
  "crypto-reflexivity": 103.0, // starts slightly above par
};

// 10k seeded shares each keeps historical stats legible without pretending the
// demo vault already manages a nine-figure pool.
const VAULT_TARGET_SHARES: Record<string, number> = {
  "ai-acceleration":  10_000,
  "crypto-reflexivity": 10_000,
};

// Fake genesis controller — never a real user address
const GENESIS_CONTROLLER = "0x0000000000000000000000000000000000000001";

function floorTo5Min(ts: number): number {
  return Math.floor(ts / MIN5_MS) * MIN5_MS;
}

function isoTs(ts: number): string {
  return new Date(ts).toISOString();
}

// Seeded LCG — deterministic per vault so history stays stable across restarts
function makeLcgRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// Smoothstep growth with small noise — simulates cumulative subscription activity.
function forwardShareSupply(
  totalSteps: number,
  targetShares: number,
  rng: () => number,
): number[] {
  const startShares = Math.round(targetShares * 0.07); // ~7% of target at t=0
  const out = new Array<number>(totalSteps + 1);
  out[0] = startShares;
  for (let i = 1; i <= totalSteps; i++) {
    const t = i / totalSteps;
    // Smoothstep (S-curve): slow→fast→slow
    const smooth = t * t * (3 - 2 * t);
    const trend = startShares + (targetShares - startShares) * smooth;
    const noise = (rng() - 0.5) * targetShares * 0.015;
    out[i] = Math.max(startShares, Math.round(trend + noise));
  }
  return out;
}

// Forward Ornstein-Uhlenbeck walk. mean-reverting by construction.
function forwardWalk(
  startNav: number,
  steps: number,
  mean: number,
  theta: number,     // mean-reversion speed per step
  stepVol: number,
  rng: () => number,
): number[] {
  const navs = new Array<number>(steps + 1);
  navs[0] = startNav;
  for (let i = 1; i <= steps; i++) {
    const prev = navs[i - 1]!;
    const drift = theta * (mean - prev);
    const shock = (rng() - 0.5) * 2 * stepVol;
    navs[i] = Math.max(NAV_FLOOR, Math.min(NAV_CEIL, prev + drift + shock));
  }
  return navs;
}

export function seedCandleHistory(db: Database, vaultId: string): void {
  const stateKey = `candle_seed_version_${vaultId}`;
  const stored = db.query(
    "SELECT value_json FROM simulator_state WHERE key = ?",
  ).get(stateKey) as { value_json: string } | null;

  if (stored && JSON.parse(stored.value_json) === CANDLE_SEED_VERSION) return;

  // Version mismatch — clear stale data and reseed
  db.run("DELETE FROM index_candles WHERE vault_id = ?", [vaultId]);

  const startNav = VAULT_START_NAV[vaultId] ?? NAV_MEAN;
  const targetShares = VAULT_TARGET_SHARES[vaultId] ?? 10_000;
  const totalSteps = SEED_HOURS_HOURLY + SEED_5MIN_BUCKETS;

  // Hourly walk: theta=0.004 per hour, mean-reverting to NAV_MEAN
  const hourlyNavs = forwardWalk(
    startNav,
    SEED_HOURS_HOURLY,
    NAV_MEAN,
    0.004,
    NAV_STEP_VOL_HOURLY,
    makeLcgRand(hashSeed(`${vaultId}:hourly`)),
  );

  // 5-min walk: bridge from where hourly walk ends
  const bridgeNav = hourlyNavs[hourlyNavs.length - 1]!;
  const fiveMinNavs = forwardWalk(
    bridgeNav,
    SEED_5MIN_BUCKETS,
    NAV_MEAN,
    0.004 / 12,
    NAV_STEP_VOL_5MIN,
    makeLcgRand(hashSeed(`${vaultId}:5min`)),
  );

  // Single continuous share supply walk over all seeded steps
  const shareSupplies = forwardShareSupply(
    totalSteps,
    targetShares,
    makeLcgRand(hashSeed(`${vaultId}:shares`)),
  );

  const now = Date.now();
  // Boundary: the 5-min bucket that is exactly SEED_RECENT_DAYS ago
  const recentBoundaryTs = floorTo5Min(now) - SEED_5MIN_BUCKETS * MIN5_MS;

  const insert = db.prepare(`
    INSERT INTO index_candles
      (vault_id, bucket_ts, open, high, low, close, gross_nav, share_supply, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertMany = db.transaction(() => {
    // Hourly candles: i-th bucket is recentBoundaryTs - (SEED_HOURS_HOURLY - i) * HOUR_MS
    for (let i = 0; i < SEED_HOURS_HOURLY; i++) {
      const bucketTs = isoTs(recentBoundaryTs - (SEED_HOURS_HOURLY - i) * HOUR_MS);
      const o = hourlyNavs[i]!;
      const c = hourlyNavs[i + 1]!;
      const spread = Math.abs(c - o);
      const hi = (Math.max(o, c) * (1 + spread * 0.4 + 0.0003)).toFixed(6);
      const lo = (Math.min(o, c) * (1 - spread * 0.4 - 0.0003)).toFixed(6);
      insert.run(vaultId, bucketTs, o.toFixed(6), hi, lo, c.toFixed(6), c.toFixed(6), String(shareSupplies[i]!));
    }

    // 5-min candles: j-th bucket starts at recentBoundaryTs + j * MIN5_MS
    for (let j = 0; j < SEED_5MIN_BUCKETS; j++) {
      const bucketTs = isoTs(recentBoundaryTs + j * MIN5_MS);
      const o = fiveMinNavs[j]!;
      const c = fiveMinNavs[j + 1]!;
      const spread = Math.abs(c - o);
      const hi = (Math.max(o, c) * (1 + spread * 0.5 + 0.0002)).toFixed(6);
      const lo = (Math.min(o, c) * (1 - spread * 0.5 - 0.0002)).toFixed(6);
      insert.run(vaultId, bucketTs, o.toFixed(6), hi, lo, c.toFixed(6), c.toFixed(6), String(shareSupplies[SEED_HOURS_HOURLY + j]!));
    }
  });

  insertMany();

  // Seed a genesis subscription so the live NAV (from requests table) starts exactly
  // where the seeded candle history ends. Without this, the first real test deposit
  // would have no counterpart shares, which inflates NAV massively.
  const lastSeedNav = fiveMinNavs[fiveMinNavs.length - 1]!;
  // asset_amount in USDC micro-units (6 decimals). NAV × shares gives the right ratio.
  const genesisAssets = Math.round(lastSeedNav * targetShares);

  db.run("DELETE FROM requests WHERE vault_id = ? AND controller = ?", [vaultId, GENESIS_CONTROLLER]);
  db.run(
    `INSERT INTO requests
       (chain_id, vault_id, internal_request_id, controller, owner,
        kind, status, asset_amount, share_amount, created_at, updated_at)
     VALUES (0, ?, 0, ?, ?, 'subscribe', 'claimed', ?, ?, datetime('now'), datetime('now'))`,
    [vaultId, GENESIS_CONTROLLER, GENESIS_CONTROLLER, String(genesisAssets), String(targetShares)],
  );

  db.run(
    "INSERT OR REPLACE INTO simulator_state (key, value_json, updated_at) VALUES (?, ?, datetime('now'))",
    [stateKey, JSON.stringify(CANDLE_SEED_VERSION)],
  );
}

export function appendCurrentCandle(
  db: Database,
  vaultId: string,
  navPerShare: number,
  shareSupply: number,
): void {
  const bucketTs = isoTs(floorTo5Min(Date.now()));
  const nav = navPerShare.toFixed(6);

  const existing = db.query(
    "SELECT id, open, high, low FROM index_candles WHERE vault_id = ? AND bucket_ts = ?",
  ).get(vaultId, bucketTs) as { id: number; open: string; high: string; low: string } | null;

  if (existing) {
    const hi = Math.max(parseFloat(existing.high), navPerShare).toFixed(6);
    const lo = Math.min(parseFloat(existing.low), navPerShare).toFixed(6);
    db.run(
      "UPDATE index_candles SET close = ?, gross_nav = ?, high = ?, low = ?, share_supply = ? WHERE id = ?",
      [nav, nav, hi, lo, shareSupply.toFixed(6), existing.id],
    );
  } else {
    db.run(
      `INSERT INTO index_candles
         (vault_id, bucket_ts, open, high, low, close, gross_nav, share_supply, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [vaultId, bucketTs, nav, nav, nav, nav, nav, shareSupply.toFixed(6)],
    );
  }
}
