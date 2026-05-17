import type {
  VaultMode,
  IndexConstituent,
  RequestStatus,
  Orientation,
} from "@indexspace/shared";

export type VaultStatus = "live" | "preview";
export type CuratorState = "active" | "executing" | "idle";
export type SimulatorState = "on" | "off";
export type TradeMode = "subscribe" | "redeem";
export type DetailTab = "chart" | "constituents" | "methodology";

export interface Constituent {
  market: string;
  marketId: number;
  weight: number;
  exposure: string;
  belief: string;
  preview: number;
  state: "live" | "lagging" | "stale";
  orientation: Orientation;
  role: string;
}

export interface NavPoint {
  ts: string;
  nav: number;
  shares: number;
}

export interface ActivityEntry {
  id: string;
  ts: string;
  type: "subscribe" | "redeem" | "claim" | "curator" | "system";
  vault: string;
  amount?: string;
  state: string;
  user?: string;
}

export interface Vault {
  id: string;
  number: number;
  name: string;
  label: string;
  mode: VaultMode;
  status: VaultStatus;
  nav: number;
  navChange: number;
  shares: number;
  totalSupply: number;
  curatorState: CuratorState;
  simulatorState: SimulatorState;
  usdc: number;
  idleUsdc: number;
  fsExposure: number;
  claimableCount: number;
  constituents: Constituent[];
  navHistory: NavPoint[];
}

export interface RequestRow {
  id: number;
  vaultId: string;
  kind: "subscribe" | "redeem";
  status: RequestStatus;
  assetAmount: string;
  shareAmount: string;
  controller: string;
  owner: string;
  createdAt: string;
}

export interface PositionRow {
  id: number;
  vaultId: string;
  marketId: number;
  positionId: string;
  status: string;
  collateral: string;
}

export interface MarketWeightRow {
  marketId: number;
  label: string;
  weight: number;
  orientation: string;
  role: string;
  collateralTotal: number;
  openPositions: number;
  latestBelief: number[] | null;
}

export interface VaultMarketWeights {
  vaultId: string;
  totalOpenCollateral: number;
  markets: MarketWeightRow[];
}

export interface SubscribeQuote {
  vaultId: string;
  inputAssets: string;
  estimatedShares: string;
  navPerShare: string;
  allocations: Array<{ marketId: number; weight: number; collateral: string }>;
}

export interface RedeemQuote {
  vaultId: string;
  inputShares: string;
  estimatedAssets: string;
  navPerShare: string;
  unwindPlan: Array<{ marketId: number; targetValue: string }>;
}
