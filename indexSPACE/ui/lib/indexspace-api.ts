import { VAULTS, ACTIVITY } from "./mock-data";
import type {
  SubscribeQuote,
  RedeemQuote,
  RequestRow,
  PositionRow,
  VaultMarketWeights,
} from "./types";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";

async function backendFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; data: T | null }> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, data: null };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, data: null };
  }
}

export async function getIndices(): Promise<
  Array<{ id: string; name: string; mode: string; status: string }>
> {
  const { ok, data } =
    await backendFetch<
      Array<{ id: string; name: string; mode: string; status?: string }>
    >("/api/indices");
  if (ok && data) {
    return data.map((i) => ({
      ...i,
      status: i.mode === "live-vault" ? "live" : "preview",
    }));
  }
  return VAULTS.map((v) => ({
    id: v.id,
    name: v.name,
    mode: v.mode,
    status: v.status,
  }));
}

export async function getVault(vaultId: string) {
  const { ok, data } = await backendFetch<Record<string, unknown>>(
    `/api/vaults/${vaultId}`,
  );
  if (ok && data) {
    const metrics = (data.metrics as Record<string, unknown> | undefined) ?? {};
    return {
      ...data,
      status:
        data.mode === "live-vault" ? ("live" as const) : ("preview" as const),
      nav: parseFloat(String(metrics.navPerShare ?? "1")),
      navChange: parseFloat(String(metrics.navChange24h ?? "0")),
      shares: parseFloat(String(metrics.displayShares ?? "0")),
      totalSupply: parseFloat(String(metrics.shareCapacity ?? "1")),
      usdc: parseFloat(String(metrics.usdcBalance ?? "0")),
      idleUsdc: parseFloat(String(metrics.idleUsdc ?? "0")),
      fsExposure: parseFloat(String(metrics.openExposure ?? "0")),
      claimableCount: parseInt(String(metrics.claimableRequests ?? "0"), 10),
      curatorState: (() => {
        const s = (metrics.curatorState as string | undefined) ?? "idle";
        return (s === "armed" ? "active" : s) as "active" | "executing" | "idle";
      })(),
    };
  }
  return VAULTS.find((v) => v.id === vaultId) ?? null;
}

export async function getVaultCandles(vaultId: string) {
  const { ok, data } = await backendFetch<Array<Record<string, unknown>>>(
    `/api/vaults/${vaultId}/candles`,
  );
  if (ok && data) return data;
  const v = VAULTS.find((x) => x.id === vaultId);
  return v?.navHistory ?? [];
}

export async function getVaultRequests(
  vaultId: string,
  controller?: string,
): Promise<RequestRow[]> {
  const params = controller ? `?controller=${controller}` : "";
  const { ok, data } = await backendFetch<RequestRow[]>(
    `/api/vaults/${vaultId}/requests${params}`,
  );
  if (ok && data) return data;
  return [];
}

export async function getVaultPositions(
  vaultId: string,
): Promise<PositionRow[]> {
  const { ok, data } = await backendFetch<PositionRow[]>(
    `/api/vaults/${vaultId}/positions`,
  );
  if (ok && data) return data;
  return [];
}

export async function getVaultMarketWeights(
  vaultId: string,
): Promise<VaultMarketWeights | null> {
  const { ok, data } = await backendFetch<VaultMarketWeights>(
    `/api/vaults/${vaultId}/market-weights`,
  );
  return ok && data ? data : null;
}

export async function quoteSubscribe(
  vaultId: string,
  assets: number,
): Promise<SubscribeQuote> {
  const { ok, data } = await backendFetch<SubscribeQuote>(
    `/api/vaults/${vaultId}/quote-subscribe`,
    {
      method: "POST",
      body: JSON.stringify({ assets: String(assets) }),
    },
  );
  if (ok && data) return data;

  const v = VAULTS.find((x) => x.id === vaultId);
  const nav = v?.nav ?? 1;
  return {
    vaultId,
    inputAssets: assets.toFixed(6),
    estimatedShares: (assets / nav).toFixed(18),
    navPerShare: nav.toFixed(18),
    allocations:
      v?.constituents.map((c) => ({
        marketId: c.marketId,
        weight: c.weight,
        collateral: ((assets * c.weight) / 100).toFixed(6),
      })) ?? [],
  };
}

export async function quoteRedeem(
  vaultId: string,
  shares: number,
): Promise<RedeemQuote> {
  const { ok, data } = await backendFetch<RedeemQuote>(
    `/api/vaults/${vaultId}/quote-redeem`,
    {
      method: "POST",
      body: JSON.stringify({ shares: String(shares) }),
    },
  );
  if (ok && data) return data;

  const v = VAULTS.find((x) => x.id === vaultId);
  const nav = v?.nav ?? 1;
  return {
    vaultId,
    inputShares: shares.toFixed(18),
    estimatedAssets: (shares * nav).toFixed(6),
    navPerShare: nav.toFixed(18),
    unwindPlan:
      v?.constituents.map((c) => ({
        marketId: c.marketId,
        targetValue: ((shares * nav * c.weight) / 100).toFixed(6),
      })) ?? [],
  };
}

export async function getInternalStatus() {
  const { ok, data } =
    await backendFetch<Record<string, unknown>>("/internal/status");
  if (ok && data) return data;
  return {
    config: { mockVault: true },
    db: { checkpoints: 0, requests: [], positions: [] },
    simulator: { enabled: true },
  };
}
