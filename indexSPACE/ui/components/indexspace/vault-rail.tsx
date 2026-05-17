"use client";

import { cn } from "@/lib/utils";
import type { Vault } from "@/lib/types";

interface VaultRailProps {
  vaults: Vault[];
  selectedId: string;
  onSelect: (id: string) => void;
}

const VAULT_ACCENT_COLORS = ["#0071BB", "#F05A24", "#8E8A80", "#FFC700"];

export function VaultRail({ vaults, selectedId, onSelect }: VaultRailProps) {
  return (
    <aside className="w-45 bg-ix-shell border-r border-ix-border flex flex-col shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-ix-border">
        <span className="text-[8px] font-mono tracking-[0.25em] text-ix-text-faint uppercase">
          INDICES
        </span>
      </div>

      {/* Vault tiles */}
      {vaults.map((vault, idx) => {
        const isSelected = vault.id === selectedId;
        const isLive = vault.status === "live";
        const changePositive = vault.navChange >= 0;
        const accentColor =
          VAULT_ACCENT_COLORS[idx % VAULT_ACCENT_COLORS.length];
        const changeColor =
          vault.navChange === 0
            ? "text-ix-text-faint"
            : changePositive
              ? "text-ix-green"
              : "text-ix-red";

        return (
          <button
            key={vault.id}
            onClick={() => onSelect(vault.id)}
            className={cn(
              "w-full text-left border-b border-ix-border transition-colors group relative",
              isSelected ? "bg-ix-panel" : "hover:bg-ix-panel-warm",
            )}
          >
            {/* Left identity strip */}
            <div
              className="absolute left-0 top-0 bottom-0 w-0.75"
              style={{
                backgroundColor: isSelected ? accentColor : "transparent",
              }}
            />

            <div className="pl-4 pr-3 pt-3 pb-3">
              {/* Number row */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-[9px] font-mono font-medium tracking-[0.15em] leading-none"
                    style={{ color: isSelected ? accentColor : "#4E4A42" }}
                  >
                    {vault.status === "live" ? "VAULT" : "PREVIEW"}{" "}
                    {String(vault.number).padStart(2, "0")}
                  </span>
                </div>
                <VaultLED vault={vault} />
              </div>

              {/* Name */}
              <div
                className={cn(
                  "text-[11px] font-mono font-medium leading-tight mb-2.5",
                  isSelected
                    ? "text-ix-text"
                    : "text-ix-text-muted group-hover:text-ix-text-dim",
                )}
              >
                {vault.name}
              </div>

              {/* NAV row */}
              <div className="flex items-baseline justify-between">
                <span
                  className={cn(
                    "text-[14px] font-mono tabular font-medium leading-none",
                    isSelected ? "text-ix-text" : "text-ix-text-dim",
                  )}
                >
                  {vault.nav.toFixed(4)}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-mono tabular leading-none",
                    changeColor,
                  )}
                >
                  {vault.navChange === 0
                    ? "—"
                    : `${changePositive ? "+" : ""}${vault.navChange.toFixed(2)}%`}
                </span>
              </div>

              {/* Fill bar for live vaults */}
              {isLive && (
                <div className="mt-2.5">
                  <div className="h-0.5 bg-ix-border-dim w-full relative overflow-hidden">
                    <div
                      className="absolute left-0 top-0 h-full transition-all"
                      style={{
                        width: `${(vault.shares / vault.totalSupply) * 100}%`,
                        backgroundColor: accentColor,
                        opacity: isSelected ? 1 : 0.5,
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[8px] font-mono text-ix-text-faint tabular">
                      {(vault.shares / 1000).toFixed(1)}K shrs
                    </span>
                    <span
                      className="text-[8px] font-mono tabular"
                      style={{ color: accentColor, opacity: 0.8 }}
                    >
                      {((vault.shares / vault.totalSupply) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}

              {/* Preview label */}
              {!isLive && (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="w-1.25 h-1.25 bg-ix-yellow opacity-60" />
                  <span className="text-[8px] font-mono tracking-[0.15em] text-ix-yellow opacity-70 uppercase">
                    SIM ONLY
                  </span>
                </div>
              )}
            </div>
          </button>
        );
      })}

      {/* Footer */}
      <div className="flex-1" />
      <div className="px-3 py-2.5 border-t border-ix-border">
        <span className="text-[8px] font-mono text-ix-text-faint tracking-wider">
          FunctionSpace protocol
        </span>
      </div>
    </aside>
  );
}

function VaultLED({ vault }: { vault: Vault }) {
  if (vault.status === "preview") {
    return (
      <div className="flex items-center gap-1">
        <span className="w-1.25 h-1.25 bg-ix-yellow opacity-50 led-pulse" />
        <span className="text-[8px] font-mono text-ix-text-faint uppercase tracking-widest">
          SIM
        </span>
      </div>
    );
  }

  const { curatorState } = vault;
  const dotColor =
    curatorState === "active"
      ? "bg-ix-green"
      : curatorState === "executing"
        ? "bg-ix-yellow led-pulse"
        : "bg-ix-text-faint";
  const label =
    curatorState === "active"
      ? "ACTIVE"
      : curatorState === "executing"
        ? "EXEC"
        : "IDLE";

  return (
    <div className="flex items-center gap-1">
      <span className={cn("w-1.25 h-1.25", dotColor)} />
      <span className="text-[8px] font-mono text-ix-text-faint uppercase tracking-widest">
        {label}
      </span>
    </div>
  );
}
