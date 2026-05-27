// Clearing Agent Types
// Cross-border settlement via stablecoin escrow on Ethereum / Base L2

/** A bank participating in a clearing transaction */
export interface BankParty {
  id: string;
  name: string;
  augustus_account_id: string;   // Augustus account holding fiat
  jurisdiction: string;          // ISO 3166-1 alpha-2
  signing_address: string;       // Ethereum address for escrow co-signing
}

/** Instruction to clear a cross-border payment */
export interface PaymentInstruction {
  id: string;
  from: BankParty;
  to: BankParty;
  amount: string;                // decimal string (source currency)
  source_currency: string;       // e.g. "EUR"
  target_currency: string;       // e.g. "USD"
  reference: string;
  deadline: number;              // unix seconds — auto-refund after this
  created_at: string;            // ISO 8601
}

// ── Chain ────────────────────────────────────────────────────────────

export type Chain = "ethereum" | "base";

export const USDC_ADDRESSES: Record<Chain, string> = {
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

// ── Route ────────────────────────────────────────────────────────────

export interface Route {
  chain: Chain;
  gas_estimate_usd: string;
  fx_rate_source_to_usdc: string;
  fx_rate_usdc_to_target: string;
  source_amount: string;
  usdc_amount: string;
  target_amount: string;
  total_cost_usd: string;        // gas + FX spread combined
  quoted_at: number;             // unix ms
  expires_at: number;            // unix ms — quote TTL
}

// ── Compliance ───────────────────────────────────────────────────────

export interface ComplianceResult {
  cleared: boolean;
  sanctions: { from_clear: boolean; to_clear: boolean };
  aml: { flag: "none" | "review" | "blocked"; reason: string | null };
  checks: ComplianceCheck[];
  checked_at: string;
}

export interface ComplianceCheck {
  name: string;
  result: "pass" | "fail" | "review";
  detail: string;
}

// ── Escrow ───────────────────────────────────────────────────────────

export type EscrowState =
  | "deploying"
  | "awaiting_funding"
  | "funded"
  | "dual_signed"
  | "released"
  | "refunded"
  | "expired";

export interface EscrowRecord {
  contract_address: string;
  chain: Chain;
  usdc_amount: string;
  bank_a_signed: boolean;
  bank_b_signed: boolean;
  state: EscrowState;
  deploy_tx: string;
  fund_tx: string | null;
  sign_a_tx: string | null;
  sign_b_tx: string | null;
  release_tx: string | null;
  deadline: number;
}

// ── On/Off Ramp ──────────────────────────────────────────────────────

export interface OnRampResult {
  conversion_id: string;
  source_amount: string;
  source_currency: string;
  usdc_received: string;
  augustus_tx_id: string;
}

export interface OffRampResult {
  conversion_id: string;
  usdc_spent: string;
  target_amount: string;
  target_currency: string;
  augustus_tx_id: string;
}

// ── Proof ────────────────────────────────────────────────────────────

export interface ProofAnchor {
  chain: Chain;
  tx_hash: string;
  block_number: number;
  receipt_hash: string;          // keccak256 of the settlement receipt
  anchored_at: string;
}

// ── Settlement Receipt ───────────────────────────────────────────────

export interface SettlementReceipt {
  instruction_id: string;
  instruction: PaymentInstruction;
  compliance: ComplianceResult;
  route: Route;
  on_ramp: OnRampResult;
  escrow: EscrowRecord;
  off_ramp: OffRampResult;
  proof: ProofAnchor;
  total_duration_ms: number;
  settled_at: string;
}

// ── Progress tracking ────────────────────────────────────────────────

export type ClearingStep =
  | "compliance"
  | "routing"
  | "on_ramp"
  | "escrow_deploy"
  | "escrow_fund"
  | "sign_a"
  | "sign_b"
  | "release"
  | "off_ramp"
  | "anchor_proof"
  | "settled";

export interface ClearingEvent {
  step: ClearingStep;
  status: "started" | "completed" | "failed";
  detail: string;
  timestamp: number;
}

// ── Config ───────────────────────────────────────────────────────────

export interface ClearingConfig {
  augustus_banking_token: string;
  augustus_payments_key: string | null;
  sandbox: boolean;
  default_deadline_seconds: number;
  max_slippage_bps: number;      // basis points, e.g. 50 = 0.5%
  ethereum_rpc_url: string;
  base_rpc_url: string;
}
