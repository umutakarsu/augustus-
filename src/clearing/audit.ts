import { createHash } from "node:crypto";
import type {
  PaymentInstruction,
  ComplianceResult,
  Route,
  OnRampResult,
  EscrowRecord,
  OffRampResult,
  SettlementReceipt,
  ProofAnchor,
  Chain,
} from "./types.js";

export class AuditTrail {
  constructor(private sandbox: boolean) {}

  buildReceipt(params: {
    instruction: PaymentInstruction;
    compliance: ComplianceResult;
    route: Route;
    onRamp: OnRampResult;
    escrow: EscrowRecord;
    offRamp: OffRampResult;
    startTime: number;
  }): SettlementReceipt {
    return {
      instruction_id: params.instruction.id,
      instruction: params.instruction,
      compliance: params.compliance,
      route: params.route,
      on_ramp: params.onRamp,
      escrow: params.escrow,
      off_ramp: params.offRamp,
      proof: undefined as unknown as ProofAnchor, // filled by anchorProof
      total_duration_ms: Date.now() - params.startTime,
      settled_at: new Date().toISOString(),
    };
  }

  hashReceipt(receipt: SettlementReceipt): string {
    const canonical = JSON.stringify(receipt, Object.keys(receipt).sort());
    const hash = createHash("sha256").update(canonical).digest("hex");
    return `0x${hash}`;
  }

  async anchorProof(receipt: SettlementReceipt, chain: Chain): Promise<ProofAnchor> {
    const receiptHash = this.hashReceipt(receipt);

    if (this.sandbox) {
      const fakeTx = `0x${createHash("sha256").update(receiptHash + Date.now()).digest("hex")}`;
      return {
        chain,
        tx_hash: fakeTx,
        block_number: 1_000_000 + Math.floor(Math.random() * 100_000),
        receipt_hash: receiptHash,
        anchored_at: new Date().toISOString(),
      };
    }

    // TODO: submit receipt_hash to on-chain attestation contract
    const fakeTx = `0x${createHash("sha256").update(receiptHash + Date.now()).digest("hex")}`;
    return {
      chain,
      tx_hash: fakeTx,
      block_number: 1_000_000 + Math.floor(Math.random() * 100_000),
      receipt_hash: receiptHash,
      anchored_at: new Date().toISOString(),
    };
  }
}
