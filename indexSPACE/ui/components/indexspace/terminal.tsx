"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { TopBar } from "./top-bar";
import { VaultRail } from "./vault-rail";
import { VaultDetail } from "./vault-detail";
import { IndexChart } from "./index-chart";
import { TradeDrawer } from "./trade-drawer";
import { ActivityStrip } from "./activity-strip";
import { PortfolioDrawer } from "./portfolio-drawer";
import { VAULTS, ACTIVITY } from "@/lib/mock-data";
import { getVault } from "@/lib/indexspace-api";
import type { Vault } from "@/lib/types";

interface TerminalProps {
  initialVaultId?: string;
}

type LiveMetrics = Pick<
  Vault,
  | "nav"
  | "navChange"
  | "shares"
  | "totalSupply"
  | "curatorState"
  | "usdc"
  | "idleUsdc"
  | "fsExposure"
  | "claimableCount"
>;

export function Terminal({ initialVaultId }: TerminalProps) {
  const [selectedId, setSelectedId] = useState(initialVaultId ?? VAULTS[0]!.id);
  const [portfolioOpen, setPortfolio] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState<Record<string, LiveMetrics>>(
    {},
  );

  const { isConnected } = useAccount();

  useEffect(() => {
    async function fetchAll() {
      const updates: Record<string, LiveMetrics> = {};
      for (const v of VAULTS) {
        const data = await getVault(v.id);
        if (!data) continue;
        updates[v.id] = {
          nav: data.nav,
          navChange: data.navChange,
          shares: data.shares,
          totalSupply: data.totalSupply,
          curatorState: data.curatorState,
          usdc: data.usdc,
          idleUsdc: data.idleUsdc,
          fsExposure: data.fsExposure,
          claimableCount: data.claimableCount,
        };
      }
      setLiveMetrics(updates);
    }
    fetchAll();
    const id = setInterval(fetchAll, 15_000);
    return () => clearInterval(id);
  }, []);

  const liveVaults = VAULTS.map((v) => {
    const m = liveMetrics[v.id];
    return m ? { ...v, ...m } : v;
  });
  const vault = liveVaults.find((v) => v.id === selectedId) ?? liveVaults[0]!;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-ix-shell">
      {/* Top system bar */}
      <TopBar networkOk onOpenPortfolio={() => setPortfolio(true)} />

      {/* Main body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left vault rail */}
        <VaultRail
          vaults={liveVaults}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {/* Center: vault detail surface */}
        <main className="flex-1 min-w-0 bg-ix-panel overflow-hidden flex flex-col">
          <VaultDetail vault={vault} chartSlot={<IndexChart vault={vault} />} />
        </main>

        {/* Right: trade drawer */}
        <TradeDrawer vault={vault} walletConnected={isConnected} />
      </div>

      {/* Bottom activity strip */}
      <ActivityStrip entries={ACTIVITY} />

      {/* Portfolio drawer overlay */}
      <PortfolioDrawer
        open={portfolioOpen}
        onClose={() => setPortfolio(false)}
        walletConnected={isConnected}
      />
    </div>
  );
}
