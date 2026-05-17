import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "bun";
import { loadConfig, INDICES, LIVE_VAULTS, PREVIEW_INDICES, ANVIL_AI_VAULT, ANVIL_CRYPTO_VAULT, BASE_SEPOLIA_AI_VAULT, BASE_SEPOLIA_CRYPTO_VAULT } from "./config.ts";
import { createDb } from "./db.ts";
import { buildBeliefVector, getFsClient } from "./sdk.ts";
import { MockVault } from "./mock-vault.ts";
import { RealIndexer } from "./indexer.ts";
import { computeSubscribeQuote, computeRedeemQuote } from "./quotes.ts";
import { Curator } from "./curator.ts";
import { Simulator } from "./simulator.ts";
import { seedCandleHistory, appendCurrentCandle } from "./candles.ts";
import type { Address } from "viem";
import { configureRunLogger, logError, logRuntime } from "./logger.ts";
import { setFsTraceEnabled } from "./sdk.ts";
import type { ConstituentStrategy } from "@indexspace/shared";

const config = loadConfig();
configureRunLogger(config.runLogEnabled, config.runLogPath);
setFsTraceEnabled(config.fsTraceEnabled);
const db = createDb(process.env.DB_PATH ?? "data/indexspace.db");

function getLastCandleState(vaultId: string) {
  const row = db.query(
    "SELECT close, share_supply FROM index_candles WHERE vault_id = ? ORDER BY bucket_ts DESC LIMIT 1",
  ).get(vaultId) as { close: string; share_supply: string } | null;
  if (!row) return null;
  return {
    nav: parseFloat(row.close),
    shares: parseFloat(row.share_supply),
  };
}

function getLastNonZeroCandleShares(vaultId: string): number {
  const row = db.query(
    "SELECT share_supply FROM index_candles WHERE vault_id = ? AND CAST(share_supply AS REAL) > 0 ORDER BY bucket_ts DESC LIMIT 1",
  ).get(vaultId) as { share_supply: string } | null;
  return row ? parseFloat(row.share_supply) : 0;
}

function getVaultSummary(vaultId: string) {
  const isLive = LIVE_VAULTS.includes(vaultId as typeof LIVE_VAULTS[number]);
  const totalShares = mockVault.getTotalShares(vaultId);
  const usdcBalance = mockVault.getVaultUsdcBalance(vaultId);
  const latestCandle = getLastCandleState(vaultId);
  const maxCandleShares = db.query(
    "SELECT MAX(CAST(share_supply AS REAL)) AS max_share_supply FROM index_candles WHERE vault_id = ?",
  ).get(vaultId) as { max_share_supply: number | null } | null;
  const openExposureRow = db.query(
    "SELECT COALESCE(SUM(CAST(collateral AS REAL)), 0) AS total FROM fs_positions WHERE vault_id = ? AND status = 'open'",
  ).get(vaultId) as { total: number } | null;
  const claimableRow = db.query(
    "SELECT COUNT(*) AS cnt FROM requests WHERE vault_id = ? AND status = 'claimable'",
  ).get(vaultId) as { cnt: number } | null;
  const activeRow = db.query(
    "SELECT COUNT(*) AS cnt FROM requests WHERE vault_id = ? AND status IN ('pending', 'executing')",
  ).get(vaultId) as { cnt: number } | null;
  const navRows = db.query(
    "SELECT bucket_ts, close FROM index_candles WHERE vault_id = ? ORDER BY bucket_ts ASC",
  ).all(vaultId) as Array<{ bucket_ts: string; close: string }>;

  const latestCandleNav = latestCandle?.nav ?? 1.0;
  const latestCandleShares = latestCandle?.shares ?? 0;
  const fallbackCandleShares = latestCandleShares > 0 ? latestCandleShares : getLastNonZeroCandleShares(vaultId);
  const resolvedDisplayShares = totalShares > 0 ? totalShares : fallbackCandleShares;
  const shareCapacity = Math.max(resolvedDisplayShares, maxCandleShares?.max_share_supply ?? 0, 1);
  const navPerShare = totalShares > 0 ? usdcBalance / totalShares : latestCandleNav;
  const openExposure = openExposureRow?.total ?? 0;
  const idleUsdc = Math.max(0, usdcBalance - openExposure);
  const claimableRequests = claimableRow?.cnt ?? 0;
  const navCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const navWindow = navRows.filter((row) => new Date(row.bucket_ts).getTime() >= navCutoff);
  const navBase = navWindow.length > 0 ? parseFloat(navWindow[0]!.close) : latestCandleNav;
  const navChange24h = navBase > 0 ? ((navPerShare - navBase) / navBase) * 100 : 0;
  const curatorState = !isLive ? "idle" : (activeRow?.cnt ?? 0) > 0 ? "executing" : "armed";

  return {
    navPerShare,
    totalShares,
    displayShares: resolvedDisplayShares,
    shareCapacity,
    shareUtilizationPct: (resolvedDisplayShares / shareCapacity) * 100,
    usdcBalance,
    idleUsdc,
    openExposure,
    claimableRequests,
    navChange24h,
    curatorState,
  };
}
const mockVault = new MockVault(db, INDICES);
const curator = new Curator(db);
const simulator = new Simulator(mockVault);
const fsClient = getFsClient(config.fsApiUrl, {
  username: config.fsUsername,
  accessToken: config.fsAccessToken,
});

if (!config.mockVault) {
  curator.configureRpc(config.rpcUrl, config.curatorPrivateKey, config.chainId);
}

const realVaultAddresses = config.chainId === 31337
  ? { "ai-acceleration": ANVIL_AI_VAULT as Address, "crypto-reflexivity": ANVIL_CRYPTO_VAULT as Address }
  : { "ai-acceleration": BASE_SEPOLIA_AI_VAULT as Address, "crypto-reflexivity": BASE_SEPOLIA_CRYPTO_VAULT as Address };

const realIndexer = config.mockVault ? null : new RealIndexer(db, config, realVaultAddresses);

// Seed artificial price history for all vaults on startup (no-op if already seeded)
for (const idx of INDICES) {
  seedCandleHistory(db, idx.id);
}

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    fsClientConfigured: fsClient !== null,
    mockVault: config.mockVault,
    simulatorEnabled: simulator.isEnabled(),
  });
});

app.get("/api/indices", (c) => {
  return c.json(INDICES);
});

app.get("/api/vaults", (c) => {
  const vaults = INDICES.map((idx) => ({
    id: idx.id,
    name: idx.name,
    mode: idx.mode,
    isLive: LIVE_VAULTS.includes(idx.id as typeof LIVE_VAULTS[number]),
    isPreview: PREVIEW_INDICES.includes(idx.id as typeof PREVIEW_INDICES[number]),
    constituentCount: idx.constituents.length,
    metrics: getVaultSummary(idx.id),
  }));
  return c.json(vaults);
});

app.get("/api/vaults/:vaultId", (c) => {
  const vaultId = c.req.param("vaultId");
  const index = INDICES.find((i) => i.id === vaultId);
  if (!index) return c.json({ error: "vault not found" }, 404);

  return c.json({
    ...index,
    metrics: {
      ...getVaultSummary(vaultId),
      curatorConfigured: fsClient !== null,
    },
  });
});

app.get("/api/vaults/:vaultId/requests", (c) => {
  const vaultId = c.req.param("vaultId");
  const controller = c.req.query("controller") ?? "";

  if (controller) {
    const rows = db.query(
      "SELECT * FROM requests WHERE vault_id = ? AND controller = ? ORDER BY created_at DESC LIMIT 100",
    ).all(vaultId, controller);
    return c.json(rows);
  }

  const rows = db.query(
    "SELECT * FROM requests WHERE vault_id = ? ORDER BY created_at DESC LIMIT 100",
  ).all(vaultId);
  return c.json(rows);
});

app.get("/api/vaults/:vaultId/positions", (c) => {
  const vaultId = c.req.param("vaultId");
  const rows = db.query(
    "SELECT * FROM fs_positions WHERE vault_id = ? ORDER BY created_at DESC LIMIT 100",
  ).all(vaultId);
  return c.json(rows);
});

app.get("/api/vaults/:vaultId/market-weights", (c) => {
  const vaultId = c.req.param("vaultId");
  const index = INDICES.find((i) => i.id === vaultId);
  if (!index) return c.json({ error: "vault not found" }, 404);

  const isConstituentStrategy = (value: unknown): value is ConstituentStrategy => {
    if (!value || typeof value !== "object") return false;
    const strategy = value as Partial<ConstituentStrategy>;
    return (
      typeof strategy.weight === "number" &&
      typeof strategy.centerNormalized === "number" &&
      typeof strategy.widthNormalized === "number" &&
      (strategy.shape === "gaussian" ||
        strategy.shape === "range" ||
        strategy.shape === "right_skew" ||
        strategy.shape === "left_skew")
    );
  };

  const parseBeliefVector = (raw: string | null): number[] | null => {
    if (!raw) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const belief = parsed.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        return belief.length > 0 ? belief : null;
      }

      if (isConstituentStrategy(parsed)) {
        return buildBeliefVector(24, 0, 1, parsed);
      }

      return null;
    } catch {
      return null;
    }
  };

  type PosRow = {
    market_id: number;
    collateral: string;
    belief_json: string | null;
  };

  // Fetch all open positions ordered newest first so first-seen per market = latest belief
  const positions = db.query(
    "SELECT market_id, collateral, belief_json FROM fs_positions WHERE vault_id = ? AND status = 'open' ORDER BY created_at DESC",
  ).all(vaultId) as PosRow[];

  // Aggregate per market in JS — positions count is small (<= ~100)
  const aggMap = new Map<number, { collateral: number; openPositions: number; latestBelief: number[] | null }>();
  for (const pos of positions) {
    const existing = aggMap.get(pos.market_id);
    if (!existing) {
      aggMap.set(pos.market_id, {
        collateral: parseFloat(pos.collateral),
        openPositions: 1,
        latestBelief: parseBeliefVector(pos.belief_json),
      });
    } else {
      existing.collateral += parseFloat(pos.collateral);
      existing.openPositions++;
      // latest belief already captured (DESC order, first entry = newest)
    }
  }

  const markets = index.constituents.map((c) => {
    const agg = aggMap.get(c.marketId);
    return {
      marketId: c.marketId,
      label: c.label,
      weight: c.weight,
      orientation: c.orientation,
      role: c.role,
      collateralTotal: agg?.collateral ?? 0,
      openPositions: agg?.openPositions ?? 0,
      latestBelief: agg?.latestBelief ?? null,
    };
  });

  return c.json({
    vaultId,
    totalOpenCollateral: Array.from(aggMap.values()).reduce((s, a) => s + a.collateral, 0),
    markets,
  });
});

app.get("/api/vaults/:vaultId/candles", (c) => {
  const vaultId = c.req.param("vaultId");
  type CandleRow = { bucket_ts: string; close: string; share_supply: string };
  const rows = db.query(
    "SELECT bucket_ts, close, share_supply FROM index_candles WHERE vault_id = ? ORDER BY bucket_ts ASC LIMIT 4000",
  ).all(vaultId) as CandleRow[];
  const navPoints = rows.map((r) => ({
    ts: r.bucket_ts,
    nav: parseFloat(r.close),
    shares: parseFloat(r.share_supply),
  }));
  return c.json(navPoints);
});

app.post("/api/vaults/:vaultId/quote-subscribe", async (c) => {
  const vaultId = c.req.param("vaultId");
  const index = INDICES.find((i) => i.id === vaultId);
  if (!index) return c.json({ error: "vault not found" }, 404);

  let assets = 100;
  try {
    const body = await c.req.json<{ assets?: string }>();
    if (body.assets) assets = parseFloat(body.assets);
  } catch {}

  const quote = computeSubscribeQuote(vaultId, assets, index, db);
  return c.json(quote);
});

app.post("/api/vaults/:vaultId/quote-redeem", async (c) => {
  const vaultId = c.req.param("vaultId");
  const index = INDICES.find((i) => i.id === vaultId);
  if (!index) return c.json({ error: "vault not found" }, 404);

  let shares = 10;
  try {
    const body = await c.req.json<{ shares?: string }>();
    if (body.shares) shares = parseFloat(body.shares);
  } catch {}

  const quote = computeRedeemQuote(vaultId, shares, index, db);
  return c.json(quote);
});

app.get("/internal/status", (c) => {
  const checkpointCount = db.query(
    "SELECT COUNT(*) AS cnt FROM indexer_checkpoints",
  ).get() as { cnt: number };

  const requestCount = db.query(
    "SELECT status, COUNT(*) AS cnt FROM requests GROUP BY status",
  ).all();

  const positionCount = db.query(
    "SELECT status, COUNT(*) AS cnt FROM fs_positions GROUP BY status",
  ).all();

  return c.json({
    config: {
      port: config.port,
      mockVault: config.mockVault,
      fsConfigured: config.fsUsername !== undefined,
      rpcUrl: config.rpcUrl,
      pollIntervalMs: config.pollIntervalMs,
    },
    db: {
      checkpoints: checkpointCount?.cnt ?? 0,
      requests: requestCount,
      positions: positionCount,
    },
    simulator: {
      enabled: simulator.isEnabled(),
    },
  });
});

app.post("/internal/curator/tick", async (c) => {
  logRuntime("http.internal", "Manual curator tick requested");
  const results = await curator.tick();
  logRuntime("http.internal", "Manual curator tick completed", { processed: results.length, results });
  return c.json({ processed: results.length, results });
});

app.post("/internal/indexer/tick", async (c) => {
  if (realIndexer) {
    logRuntime("http.internal", "Manual indexer tick requested");
    const events = await realIndexer.tick();
    const count = realIndexer.persistEvents(events);
    logRuntime("http.internal", "Manual indexer tick completed", { events: events.length, indexed: count });
    return c.json({ indexed: count });
  }

  const events = mockVault.pollEvents();
  for (const ev of events) {
    const exists = db.query(
      "SELECT COUNT(*) AS cnt FROM requests WHERE vault_id = ? AND internal_request_id = ?",
    ).get(ev.vaultId, ev.internalRequestId) as { cnt: number };

    if (exists.cnt === 0) {
      db.run(
        `INSERT INTO requests (chain_id, vault_id, internal_request_id, controller, owner, kind, status, asset_amount, share_amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'), datetime('now'))`,
        [config.chainId, ev.vaultId, ev.internalRequestId, ev.controller, ev.owner, ev.kind, ev.assetAmount, ev.shareAmount],
      );
    }
  }

  if (events.length > 0) {
    const existing = db.query(
      "SELECT last_indexed_block FROM indexer_checkpoints WHERE chain_id = ? AND contract_address = 'mock-vault'",
    ).get(config.chainId) as { last_indexed_block: number } | null;
    const nextBlock = (existing?.last_indexed_block ?? 0) + 1;
    db.run(
      "INSERT OR REPLACE INTO indexer_checkpoints (chain_id, contract_address, last_indexed_block, updated_at) VALUES (?, 'mock-vault', ?, datetime('now'))",
      [config.chainId, nextBlock],
    );
  }

  return c.json({ indexed: events.length });
});

app.post("/internal/simulator", async (c) => {
  let enabled: boolean | undefined;
  try {
    const body = await c.req.json<{ enabled?: boolean }>();
    enabled = body.enabled;
  } catch {}

  if (enabled !== undefined) {
    simulator.setEnabled(enabled);
  }
  return c.json({ enabled: simulator.isEnabled() });
});

app.post("/internal/simulator/generate", (c) => {
  const count = simulator.generateActivity();
  return c.json({ generated: count });
});

if (config.mockVault) {
  setInterval(() => {
    const events = mockVault.pollEvents();
    for (const ev of events) {
      const exists = db.query(
        "SELECT COUNT(*) AS cnt FROM requests WHERE vault_id = ? AND internal_request_id = ?",
      ).get(ev.vaultId, ev.internalRequestId) as { cnt: number };

      if (exists.cnt === 0) {
        db.run(
          `INSERT INTO requests (chain_id, vault_id, internal_request_id, controller, owner, kind, status, asset_amount, share_amount, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'), datetime('now'))`,
          [config.chainId, ev.vaultId, ev.internalRequestId, ev.controller, ev.owner, ev.kind, ev.assetAmount, ev.shareAmount],
        );
      }
    }
  }, config.pollIntervalMs);

  setInterval(async () => {
    await curator.tick();
    for (const idx of INDICES) {
      const totalShares = mockVault.getTotalShares(idx.id);
      const usdcBalance = mockVault.getVaultUsdcBalance(idx.id);
      const lastCandle = getLastCandleState(idx.id);
      const accountingNav = totalShares > 0 ? usdcBalance / totalShares : lastCandle?.nav ?? 100.0;
      const lastClose = lastCandle?.nav ?? 0;
      if (lastClose === 0 || Math.abs(accountingNav - lastClose) / lastClose > 0.0001) {
        const shareSupply = totalShares > 0 ? totalShares : lastCandle?.shares || getLastNonZeroCandleShares(idx.id);
        appendCurrentCandle(db, idx.id, accountingNav, shareSupply);
      }
    }
  }, Math.max(config.pollIntervalMs, 15000));

  simulator.start();
} else {
  setInterval(async () => {
    try {
      const events = await realIndexer!.tick();
      const persisted = realIndexer!.persistEvents(events);
      if (events.length > 0 || persisted > 0) {
        logRuntime("scheduler.indexer", "Background indexer tick completed", { events: events.length, persisted });
      }
    } catch (err) {
      logError("scheduler.indexer", "Background indexer tick failed", err);
    }
  }, config.pollIntervalMs);

  setInterval(async () => {
    try {
      const results = await curator.tick();
      if (results.length > 0) {
        logRuntime("scheduler.curator", "Background curator tick completed", { processed: results.length, results });
      }
      for (const idx of INDICES) {
        const totalShares = mockVault.getTotalShares(idx.id);
        const usdcBalance = mockVault.getVaultUsdcBalance(idx.id);
        const lastCandle = getLastCandleState(idx.id);
        const accountingNav = totalShares > 0 ? usdcBalance / totalShares : lastCandle?.nav ?? 100.0;
        const lastClose = lastCandle?.nav ?? 0;
        if (lastClose === 0 || Math.abs(accountingNav - lastClose) / lastClose > 0.0001) {
          const shareSupply = totalShares > 0 ? totalShares : lastCandle?.shares || getLastNonZeroCandleShares(idx.id);
          appendCurrentCandle(db, idx.id, accountingNav, shareSupply);
        }
      }
    } catch (err) {
      logError("scheduler.curator", "Background curator tick failed", err);
    }
  }, Math.max(config.pollIntervalMs, 15000));
}

logRuntime("startup", `IndexSpace backend starting on http://${config.host}:${config.port}`, {
  mockVault: config.mockVault,
  fsClientConfigured: fsClient !== null,
  simulatorEnabled: simulator.isEnabled(),
  runLogEnabled: config.runLogEnabled,
  runLogPath: config.runLogPath,
  fsTraceEnabled: config.fsTraceEnabled,
});

serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});
