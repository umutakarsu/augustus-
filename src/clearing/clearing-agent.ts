import type {
  ClearingConfig,
  ClearingEvent,
  ClearingStep,
  PaymentInstruction,
  SettlementReceipt,
  OnRampResult,
  OffRampResult,
  Route,
  ComplianceResult,
  EscrowRecord,
} from "./types.js";
import { runComplianceChecks } from "./compliance.js";
import { ChainClient } from "./chain-client.js";
import { GasOracle } from "./gas-oracle.js";
import { ClearingRouter } from "./router.js";
import { EscrowManager } from "./escrow.js";
import { SettlementMonitor } from "./monitor.js";
import { AuditTrail } from "./audit.js";
import { BankingClient } from "../augustus-client.js";

export type ClearingEmit = (event: ClearingEvent) => void;

function event(step: ClearingStep, status: ClearingEvent["status"], detail = ""): ClearingEvent {
  return { step, status, detail, timestamp: Date.now() };
}

export class ClearingAgent {
  private bankingClient: BankingClient;
  private chainClient: ChainClient;
  private gasOracle: GasOracle;
  private router: ClearingRouter;
  private escrowManager: EscrowManager;
  private monitor: SettlementMonitor;
  private auditTrail: AuditTrail;
  private config: ClearingConfig;

  constructor(config: ClearingConfig) {
    this.config = config;
    this.bankingClient = new BankingClient(config.augustus_banking_token, config.sandbox);

    const rpcConfig = {
      ethereumRpcUrl: config.ethereum_rpc_url,
      baseRpcUrl: config.base_rpc_url,
      sandbox: config.sandbox,
    };

    this.chainClient = new ChainClient(rpcConfig);
    this.gasOracle = new GasOracle(rpcConfig);
    this.router = new ClearingRouter(this.gasOracle, this.bankingClient);
    this.escrowManager = new EscrowManager(this.chainClient, config.sandbox);
    this.monitor = new SettlementMonitor(this.chainClient, this.escrowManager);
    this.auditTrail = new AuditTrail(config.sandbox);
  }

  async settle(instruction: PaymentInstruction, emit?: ClearingEmit): Promise<SettlementReceipt> {
    const startTime = Date.now();
    const send = emit ?? (() => {});

    // 1. Compliance
    const compliance = await this.step(send, "compliance", () =>
      runComplianceChecks(instruction),
    );

    if (!compliance.cleared) {
      const reasons = compliance.checks
        .filter((c) => c.result === "fail")
        .map((c) => c.detail)
        .join("; ");
      throw new Error(`compliance blocked: ${reasons}`);
    }

    // 2. Route
    const route = await this.step(send, "routing", () =>
      this.router.findBestRoute(instruction),
    );

    // 3. On-ramp — fiat to USDC
    const onRamp = await this.step(send, "on_ramp", () =>
      this.onRamp(instruction, route),
    );

    // 4. Deploy escrow
    const deadline = instruction.deadline || Math.floor(Date.now() / 1000) + this.config.default_deadline_seconds;
    const deployedEscrow = await this.step(send, "escrow_deploy", () =>
      this.escrowManager.deployEscrow({
        bankA: instruction.from.signing_address,
        bankB: instruction.to.signing_address,
        chain: route.chain,
        usdcAmount: route.usdc_amount,
        deadline,
      }),
    );

    // 5. Fund escrow
    const fundedEscrow = await this.step(send, "escrow_fund", () =>
      this.escrowManager.fundEscrow(
        deployedEscrow.contract_address,
        route.chain,
        route.usdc_amount,
      ),
    );

    // 6. Bank A signs
    await this.step(send, "sign_a", () =>
      this.escrowManager.sign(
        fundedEscrow.contract_address,
        route.chain,
        "bank_a",
      ),
    );

    // 7. Bank B signs — triggers auto-release
    const releasedEscrow = await this.step(send, "sign_b", () =>
      this.escrowManager.sign(
        fundedEscrow.contract_address,
        route.chain,
        "bank_b",
      ),
    );

    // 8. Off-ramp — USDC to target currency
    const offRamp = await this.step(send, "off_ramp", () =>
      this.offRamp(instruction, route),
    );

    // 9-10. Anchor proof and build receipt
    const receipt = this.auditTrail.buildReceipt({
      instruction,
      compliance,
      route,
      onRamp,
      escrow: releasedEscrow,
      offRamp,
      startTime,
    });

    const proof = await this.step(send, "anchor_proof", () =>
      this.auditTrail.anchorProof(receipt, route.chain),
    );

    receipt.proof = proof;

    send(event("settled", "completed", `settled in ${receipt.total_duration_ms}ms`));

    return receipt;
  }

  /**
   * Run a pipeline step with emit bookends and error handling.
   */
  private async step<T>(
    send: ClearingEmit,
    stepName: ClearingStep,
    fn: () => Promise<T>,
  ): Promise<T> {
    send(event(stepName, "started"));
    try {
      const result = await fn();
      send(event(stepName, "completed"));
      return result;
    } catch (err) {
      send(event(stepName, "failed", err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  /**
   * Convert source fiat → USDC via Augustus conversion.
   */
  private async onRamp(instruction: PaymentInstruction, route: Route): Promise<OnRampResult> {
    const usdcAccount = await this.findUsdcAccount();

    const conversion = await this.bankingClient.createConversion({
      source_account_id: instruction.from.augustus_account_id,
      target_account_id: usdcAccount.id,
      source_amount: instruction.amount,
    });

    return {
      conversion_id: conversion.id,
      source_amount: conversion.source_amount,
      source_currency: conversion.source_currency,
      usdc_received: conversion.target_amount,
      augustus_tx_id: conversion.id,
    };
  }

  /**
   * Convert USDC → target fiat via Augustus conversion.
   */
  private async offRamp(instruction: PaymentInstruction, route: Route): Promise<OffRampResult> {
    const usdcAccount = await this.findUsdcAccount();

    const conversion = await this.bankingClient.createConversion({
      source_account_id: usdcAccount.id,
      target_account_id: instruction.to.augustus_account_id,
      source_amount: route.usdc_amount,
    });

    return {
      conversion_id: conversion.id,
      usdc_spent: conversion.source_amount,
      target_amount: conversion.target_amount,
      target_currency: conversion.target_currency,
      augustus_tx_id: conversion.id,
    };
  }

  private async findUsdcAccount(): Promise<{ id: string }> {
    const { data: accounts } = await this.bankingClient.listAccounts();
    const usdc = accounts.find((a) => a.currency === "USDC");
    if (!usdc) {
      throw new Error("no USDC account found on Augustus — cannot on/off-ramp");
    }
    return usdc;
  }
}
