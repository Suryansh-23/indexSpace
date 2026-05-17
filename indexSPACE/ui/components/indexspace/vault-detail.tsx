"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Vault, Constituent } from "@/lib/types";

type DetailTab = "chart" | "constituents" | "methodology";

interface VaultDetailProps {
  vault: Vault;
  chartSlot: React.ReactNode;
}

export function VaultDetail({ vault, chartSlot }: VaultDetailProps) {
  const [tab, setTab] = useState<DetailTab>("chart");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Metrics strip ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 border-b border-ix-border bg-ix-shell">
        <MetricCell
          label="USDC POOL"
          value={`$${vault.usdc.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
        />
        <MetricCell
          label="SHARES ISSUED"
          value={vault.shares.toLocaleString()}
        />
        <MetricCell
          label="TOTAL SUPPLY"
          value={vault.totalSupply.toLocaleString()}
        />
        <MetricCell
          label="CURATOR"
          value={vault.curatorState.toUpperCase()}
          valueColor={
            vault.curatorState === "active"
              ? "text-ix-green"
              : vault.curatorState === "executing"
                ? "text-ix-yellow"
                : "text-ix-text-faint"
          }
          led={
            vault.curatorState === "active"
              ? "bg-ix-green"
              : vault.curatorState === "executing"
                ? "bg-ix-yellow led-pulse"
                : "bg-ix-text-faint"
          }
        />
        <MetricCell
          label="SIMULATOR"
          value={vault.simulatorState.toUpperCase()}
          valueColor={
            vault.simulatorState === "on"
              ? "text-ix-orange"
              : "text-ix-text-faint"
          }
          led={
            vault.simulatorState === "on"
              ? "bg-ix-orange led-pulse"
              : "bg-ix-text-faint"
          }
        />
        <MetricCell
          label="CONSTITUENTS"
          value={String(vault.constituents.length)}
        />
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 border-b border-ix-border bg-ix-shell">
        {(["chart", "constituents", "methodology"] as DetailTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-5 py-2.5 text-[9px] font-mono uppercase tracking-[0.2em] border-r border-ix-border transition-colors",
              tab === t
                ? "bg-ix-panel text-ix-text border-b-2 border-b-ix-blue"
                : "text-ix-text-faint hover:text-ix-text-muted hover:bg-ix-panel-warm",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "chart" && chartSlot}
        {tab === "constituents" && <ConstituentsView vault={vault} />}
        {tab === "methodology" && <MethodologyView vault={vault} />}
      </div>
    </div>
  );
}

// ── Metric cell ───────────────────────────────────────────────────────────────

function MetricCell({
  label,
  value,
  valueColor,
  led,
}: {
  label: string;
  value: string;
  valueColor?: string;
  led?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 border-r border-ix-border min-w-[120px]">
      {led && <div className={cn("w-[5px] h-[5px] shrink-0", led)} />}
      <div className="flex flex-col gap-[3px]">
        <span className="text-[8px] font-mono tracking-[0.2em] text-ix-text-faint uppercase leading-none">
          {label}
        </span>
        <span
          className={cn(
            "text-[11px] font-mono tabular leading-none",
            valueColor ?? "text-ix-text-dim",
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

// ── Constituents view ─────────────────────────────────────────────────────────

const WEIGHT_COLORS = [
  "#0071BB",
  "#F05A24",
  "#1E9E5A",
  "#FFC700",
  "#D62D20",
  "#8E8A80",
];

const BELIEF_GLYPHS: Record<string, string> = {
  bullish: "▲",
  bearish: "▼",
  "stress up": "◆",
  "stress down": "◇",
  neutral: "→",
  accelerating: "▲",
  "tail widening": "↗",
  compression: "↙",
  steady: "→",
  rising: "↑",
  easing: "↘",
  momentum: "▲",
  compressing: "↙",
  fragmenting: "≡",
  slow: "→",
  "low risk": "○",
  uncertain: "?",
  persistent: "→",
  "range bound": "⇔",
  elevated: "↑",
  plateau: "—",
  "rising fast": "▲",
};

function ConstituentsView({ vault }: { vault: Vault }) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const selected =
    selectedIdx !== null ? vault.constituents[selectedIdx] : null;
  const totalExposure =
    vault.status === "live"
      ? vault.constituents.reduce(
          (s, c) => s + parseFloat(c.exposure.replace(/[$,]/g, "") || "0"),
          0,
        )
      : 0;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main table */}
      <div className="flex-1 overflow-auto">
        {/* Summary header */}
        <div className="flex items-center gap-6 px-5 py-3 border-b border-ix-border bg-ix-panel-warm">
          <SummaryChip
            label="CONSTITUENTS"
            value={String(vault.constituents.length)}
          />
          {vault.status === "live" && (
            <SummaryChip
              label="WEIGHTED EXPOSURE"
              value={`$${totalExposure.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            />
          )}
          <SummaryChip
            label="LARGEST DRIVER"
            value={vault.constituents[0]?.market ?? "—"}
            dim
          />
          <SummaryChip
            label="DISPERSION"
            value="MEDIUM"
            accent="text-ix-yellow"
          />
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ix-border sticky top-0 bg-ix-panel">
              {[
                "#",
                "MARKET",
                "WEIGHT",
                "EXPOSURE",
                "BELIEF",
                "PREVIEW",
                "STATE",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2.5 text-[8px] font-mono tracking-[0.2em] text-ix-text-faint uppercase font-normal"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vault.constituents.map((c, i) => (
              <ConstituentRow
                key={i}
                c={c}
                idx={i}
                live={vault.status === "live"}
                selected={selectedIdx === i}
                onSelect={() => setSelectedIdx(selectedIdx === i ? null : i)}
              />
            ))}
          </tbody>
        </table>

        {/* Weight distribution bar */}
        <div className="px-5 py-4 border-t border-ix-border">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[8px] font-mono tracking-[0.2em] text-ix-text-faint uppercase">
              WEIGHT DISTRIBUTION
            </span>
            <span className="text-[8px] font-mono text-ix-text-faint">
              / INDEX INSTRUMENT READOUT
            </span>
          </div>
          <div className="flex h-[6px] w-full overflow-hidden gap-px">
            {vault.constituents.map((c, i) => (
              <div
                key={i}
                className="h-full transition-opacity"
                style={{
                  width: `${c.weight}%`,
                  backgroundColor: WEIGHT_COLORS[i % WEIGHT_COLORS.length],
                  opacity: selectedIdx === null || selectedIdx === i ? 1 : 0.25,
                }}
                title={`${c.market}: ${c.weight}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2.5">
            {vault.constituents.map((c, i) => (
              <button
                key={i}
                onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                className="flex items-center gap-1.5 group"
              >
                <div
                  className="w-2 h-2 shrink-0"
                  style={{
                    backgroundColor: WEIGHT_COLORS[i % WEIGHT_COLORS.length],
                  }}
                />
                <span
                  className={cn(
                    "text-[9px] font-mono transition-colors",
                    selectedIdx === i
                      ? "text-ix-text-dim"
                      : "text-ix-text-muted group-hover:text-ix-text-dim",
                  )}
                >
                  {c.market}
                </span>
                <span className="text-[9px] font-mono tabular text-ix-text-faint">
                  {c.weight}%
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Selected market detail panel */}
      {selected && (
        <div className="w-[220px] border-l border-ix-border bg-ix-panel-warm flex flex-col shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-ix-border">
            <span className="text-[8px] font-mono tracking-[0.2em] text-ix-text-faint uppercase">
              MARKET DETAIL
            </span>
            <button
              onClick={() => setSelectedIdx(null)}
              className="text-ix-text-faint hover:text-ix-text font-mono text-[10px]"
            >
              ✕
            </button>
          </div>
          <div className="px-4 pt-4 pb-2">
            <div className="text-[11px] font-mono font-medium text-ix-text mb-1 leading-tight">
              {selected.market}
            </div>
            <div
              className="text-[8px] font-mono tracking-widest uppercase mb-3"
              style={{ color: WEIGHT_COLORS[selectedIdx!] }}
            >
              {selected.weight}% WEIGHT
            </div>
            <MarketDetailRow
              label="EXPOSURE"
              value={vault.status === "live" ? selected.exposure : "—"}
            />
            <MarketDetailRow
              label="PREVIEW P"
              value={selected.preview.toFixed(2)}
            />
            <MarketDetailRow
              label="BELIEF"
              value={`${BELIEF_GLYPHS[selected.belief] ?? "?"} ${selected.belief}`}
            />
            <MarketDetailRow
              label="STATE"
              value={selected.state.toUpperCase()}
              accent={
                selected.state === "live"
                  ? "text-ix-green"
                  : selected.state === "lagging"
                    ? "text-ix-yellow"
                    : "text-ix-text-faint"
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryChip({
  label,
  value,
  dim,
  accent,
}: {
  label: string;
  value: string;
  dim?: boolean;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-[8px] font-mono tracking-[0.18em] text-ix-text-faint uppercase">
        {label}
      </span>
      <span
        className={cn(
          "text-[10px] font-mono tabular",
          dim ? "text-ix-text-muted" : (accent ?? "text-ix-text-dim"),
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MarketDetailRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-[2px] py-2 border-b border-ix-border-dim">
      <span className="text-[8px] font-mono tracking-[0.18em] text-ix-text-faint uppercase">
        {label}
      </span>
      <span
        className={cn("text-[11px] font-mono", accent ?? "text-ix-text-dim")}
      >
        {value}
      </span>
    </div>
  );
}

function ConstituentRow({
  c,
  idx,
  live,
  selected,
  onSelect,
}: {
  c: Constituent;
  idx: number;
  live: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const stateChip =
    c.state === "live"
      ? { label: "LIVE", bg: "bg-ix-green", text: "text-ix-shell" }
      : c.state === "lagging"
        ? { label: "LAGGING", bg: "bg-ix-yellow", text: "text-ix-shell" }
        : { label: "STALE", bg: "bg-ix-text-faint", text: "text-ix-shell" };

  return (
    <tr
      onClick={onSelect}
      className={cn(
        "border-b border-ix-border-dim cursor-pointer transition-colors",
        selected ? "bg-ix-surface" : "hover:bg-ix-panel-warm",
      )}
    >
      <td className="px-4 py-3">
        <span className="text-[9px] font-mono tabular text-ix-text-faint">
          {String(idx + 1).padStart(2, "0")}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-[11px] font-mono text-ix-text">{c.market}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono tabular text-ix-text">
            {c.weight}%
          </span>
          <div className="w-14 h-[2px] bg-ix-border relative overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full"
              style={{
                width: `${c.weight}%`,
                backgroundColor: WEIGHT_COLORS[idx % WEIGHT_COLORS.length],
              }}
            />
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-[11px] font-mono tabular text-ix-text-muted">
          {live ? c.exposure : "—"}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono text-ix-text-faint">
            {BELIEF_GLYPHS[c.belief] ?? "?"}
          </span>
          <span className="text-[10px] font-mono text-ix-text-muted">
            {c.belief}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-[11px] font-mono tabular text-ix-text">
          {c.preview.toFixed(2)}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 leading-none",
            stateChip.bg,
            stateChip.text,
          )}
        >
          {stateChip.label}
        </span>
      </td>
    </tr>
  );
}

// ── Methodology view ──────────────────────────────────────────────────────────

function MethodologyView({ vault }: { vault: Vault }) {
  return (
    <div className="p-5 grid grid-cols-2 gap-px bg-ix-border-dim">
      {/* Execution model */}
      <SchematicModule title="EXECUTION MODEL" code="MOD-01">
        <div className="text-[10px] font-mono text-ix-text-muted leading-relaxed">
          Subscriptions and redemptions are async. A trusted curator monitors
          pending requests and executes the underlying FunctionSpace basket.
          Shares mint proportionally to deposited USDC divided by current NAV.
        </div>
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          {["subscribe", "curator exec", "mint shares"].map((s, i, a) => (
            <div key={s} className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono text-ix-text-dim border border-ix-border px-2 py-0.5">
                {s}
              </span>
              {i < a.length - 1 && (
                <span className="text-ix-text-faint font-mono text-[10px]">
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </SchematicModule>

      {/* NAV calculation */}
      <SchematicModule title="NAV CALCULATION" code="MOD-02">
        <div className="bg-ix-border-dim px-3 py-2.5 border border-ix-border mb-3">
          <span className="text-[10px] font-mono text-ix-text-dim block mb-1 tracking-wider">
            NAV FORMULA
          </span>
          <span className="text-[11px] font-mono text-ix-text">
            (idle USDC + FS position value) / shares outstanding
          </span>
        </div>
        <div className="text-[10px] font-mono text-ix-text-muted leading-relaxed">
          Updated on each curator execution cycle. Reflects live FunctionSpace
          position marks.
        </div>
      </SchematicModule>

      {/* Constituent selection */}
      <SchematicModule title="CONSTITUENT SELECTION" code="MOD-03">
        <div className="text-[10px] font-mono text-ix-text-muted leading-relaxed mb-3">
          Markets selected by curator based on narrative relevance, liquidity
          depth, and FunctionSpace belief coherence. Weights reviewed on a
          rolling basis.
        </div>
        <div className="flex flex-col gap-1">
          {["narrative relevance", "belief coherence", "liquidity depth"].map(
            (c) => (
              <div key={c} className="flex items-center gap-2">
                <span className="w-[5px] h-[5px] bg-ix-blue shrink-0" />
                <span className="text-[9px] font-mono text-ix-text-muted uppercase tracking-wider">
                  {c}
                </span>
              </div>
            ),
          )}
        </div>
      </SchematicModule>

      {/* Request lifecycle */}
      <SchematicModule title="REQUEST LIFECYCLE" code="MOD-04">
        <div className="flex flex-col gap-2">
          {[
            { n: "01", label: "WALLET", color: "#4E4A42" },
            { n: "02", label: "APPROVE", color: "#4E4A42" },
            { n: "03", label: "REQUEST", color: "#0071BB" },
            { n: "04", label: "CURATOR", color: "#FFC700" },
            { n: "05", label: "CLAIMABLE", color: "#F05A24" },
            { n: "06", label: "CLAIMED", color: "#1E9E5A" },
          ].map((s, i, a) => (
            <div key={s.n} className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-ix-text-faint w-4 tabular">
                {s.n}
              </span>
              <div
                className="w-[5px] h-[5px] shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span
                className="text-[9px] font-mono tracking-widest"
                style={{ color: s.color }}
              >
                {s.label}
              </span>
              {i < a.length - 1 && (
                <span className="text-ix-text-faint text-[8px] font-mono ml-auto">
                  ↓
                </span>
              )}
            </div>
          ))}
        </div>
      </SchematicModule>

      {/* Curator role */}
      <SchematicModule title="CURATOR ROLE" code="MOD-05">
        <div className="bg-ix-border-dim border border-ix-border px-3 py-2.5 mb-3">
          <span className="text-[9px] font-mono text-ix-text-faint tracking-widest block mb-1">
            TRUST MODEL
          </span>
          <span className="text-[11px] font-mono text-ix-orange">
            trusted MVP operator
          </span>
        </div>
        <div className="text-[10px] font-mono text-ix-text-muted leading-relaxed">
          Curator is a privileged offchain account that executes basket trades
          on FunctionSpace and triggers vault rebalancing. Trustless path TBD.
        </div>
      </SchematicModule>

      {/* Risk / trust */}
      <SchematicModule title="RISK / TRUST ASSUMPTIONS" code="MOD-06">
        <div className="flex flex-col gap-1.5">
          {[
            {
              label: "OFFCHAIN POSITIONS",
              note: "FunctionSpace market exposure is offchain",
            },
            {
              label: "CURATOR EXECUTION",
              note: "Async delay between request and execution",
            },
            {
              label: "NAV STALENESS",
              note: "NAV reflects last curator cycle, not real-time",
            },
            {
              label: "BASE SEPOLIA TESTNET",
              note: `${vault.label} on testnet. Not production.`,
            },
          ].map((r) => (
            <div
              key={r.label}
              className="border-l-2 border-ix-border pl-2.5 py-0.5"
            >
              <span className="text-[8px] font-mono tracking-[0.15em] text-ix-text-faint uppercase block">
                {r.label}
              </span>
              <span className="text-[10px] font-mono text-ix-text-muted">
                {r.note}
              </span>
            </div>
          ))}
        </div>
      </SchematicModule>
    </div>
  );
}

function SchematicModule({
  title,
  code,
  children,
}: {
  title: string;
  code: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-ix-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] font-mono tracking-[0.22em] text-ix-text-muted uppercase">
          {title}
        </span>
        <span className="text-[8px] font-mono text-ix-text-faint">{code}</span>
      </div>
      {children}
    </div>
  );
}
