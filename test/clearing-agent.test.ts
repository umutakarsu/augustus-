import { describe, it, expect, vi, beforeEach } from "vitest";
import { runComplianceChecks } from "../src/clearing/compliance.js";
import { ChainClient } from "../src/clearing/chain-client.js";
import { GasOracle } from "../src/clearing/gas-oracle.js";
import { ClearingRouter } from "../src/clearing/router.js";
import { EscrowManager } from "../src/clearing/escrow.js";
import { ClearingAgent } from "../src/clearing/clearing-agent.js";
import type {
  PaymentInstruction,
  ClearingConfig,
  ClearingEvent,
} from "../src/clearing/types.js";
import type { BankingClient, Account, Paginated, Balance, Quote, Conversion } from "../src/augustus-client.js";

// ── Fixtures ────────────────────────────────────────────────────────

const testConfig: ClearingConfig = {
  augustus_banking_token: "test-token",
  augustus_payments_key: null,
  sandbox: true,
  default_deadline_seconds: 3600,
  max_slippage_bps: 50,
  ethereum_rpc_url: "http://localhost:8545",
  base_rpc_url: "http://localhost:8546",
};

function makeInstruction(overrides: Partial<PaymentInstruction> = {}): PaymentInstruction {
  return {
    id: "pi-001",
    from: {
      id: "bank-a",
      name: "Deutsche Bank AG",
      augustus_account_id: "acc-eur",
      jurisdiction: "DE",
      signing_address: "0xaaaa",
    },
    to: {
      id: "bank-b",
      name: "JPMorgan Chase",
      augustus_account_id: "acc-usd",
      jurisdiction: "US",
      signing_address: "0xbbbb",
    },
    amount: "5000.00",
    source_currency: "EUR",
    target_currency: "USD",
    reference: "INV-2026-042",
    deadline: Math.floor(Date.now() / 1000) + 7200,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function stubBankingClient(overrides: Partial<BankingClient> = {}): BankingClient {
  const usdcAccount: Account = {
    id: "acc-usdc",
    currency: "USDC",
    account_type: "payment_account",
    status: "active",
    asset_type: "crypto",
    label: "USDC Wallet",
    financial_addresses: [{ type: "crypto", address: "0xusdc", blockchain: "ethereum" }],
    created_at: "2026-01-01T00:00:00Z",
  };

  const eurAccount: Account = {
    id: "acc-eur",
    currency: "EUR",
    account_type: "payment_account",
    status: "active",
    asset_type: "fiat",
    label: "EUR Operating",
    financial_addresses: [{ type: "iban", iban: "DE89370400440532013000" }],
    created_at: "2026-01-01T00:00:00Z",
  };

  const usdAccount: Account = {
    id: "acc-usd",
    currency: "USD",
    account_type: "payment_account",
    status: "active",
    asset_type: "fiat",
    label: "USD Operating",
    financial_addresses: [{ type: "iban", iban: "US12345678901234567890" }],
    created_at: "2026-01-01T00:00:00Z",
  };

  return {
    listAccounts: vi.fn().mockResolvedValue({
      data: [eurAccount, usdcAccount, usdAccount],
      has_more: false,
      next_cursor: null,
    } satisfies Paginated<Account>),

    getBalance: vi.fn().mockResolvedValue({
      account_id: "acc-usdc",
      amount: "50000.00",
      currency: "USDC",
      as_of: new Date().toISOString(),
    } satisfies Balance),

    getQuote: vi.fn().mockResolvedValue({
      rate: "1.08",
      source_currency: "EUR",
      target_currency: "USDC",
      source_amount: "5000.00",
      target_amount: "5400.00",
    } satisfies Quote),

    createConversion: vi.fn().mockResolvedValue({
      id: "conv-001",
      status: "completed",
      source_amount: "5000.00",
      source_currency: "EUR",
      target_amount: "5400.00",
      target_currency: "USDC",
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    } satisfies Conversion),

    ...overrides,
  } as unknown as BankingClient;
}

// ── Compliance ──────────────────────────────────────────────────────

describe("compliance", () => {
  it("clears a clean transaction between non-sanctioned banks", async () => {
    const instruction = makeInstruction();
    const result = await runComplianceChecks(instruction);

    expect(result.cleared).toBe(true);
    expect(result.sanctions.from_clear).toBe(true);
    expect(result.sanctions.to_clear).toBe(true);
  });

  it("blocks a sanctioned jurisdiction (North Korea)", async () => {
    const instruction = makeInstruction({
      from: {
        id: "bank-kp",
        name: "Pyongyang Bank",
        augustus_account_id: "acc-kp",
        jurisdiction: "KP",
        signing_address: "0xdead",
      },
    });
    const result = await runComplianceChecks(instruction);

    expect(result.cleared).toBe(false);
    expect(result.sanctions.from_clear).toBe(false);
  });

  it("blocks a sanctioned entity", async () => {
    const instruction = makeInstruction({
      from: {
        id: "bank-ru",
        name: "Sberbank International",
        augustus_account_id: "acc-ru",
        jurisdiction: "CH", // non-sanctioned jurisdiction — entity name triggers it
        signing_address: "0xdead",
      },
    });
    const result = await runComplianceChecks(instruction);

    expect(result.cleared).toBe(false);
    expect(result.sanctions.from_clear).toBe(false);
  });

  it("flags AML review for $50,000 but still clears", async () => {
    const instruction = makeInstruction({ amount: "50000.00" });
    const result = await runComplianceChecks(instruction);

    expect(result.cleared).toBe(true);
    expect(result.aml.flag).toBe("review");
  });

  it("flags review for unknown currency", async () => {
    const instruction = makeInstruction({ source_currency: "XYZ" });
    const result = await runComplianceChecks(instruction);

    const currencyCheck = result.checks.find((c) => c.name === "currency_reasonableness");
    expect(currencyCheck).toBeDefined();
    expect(currencyCheck!.result).toBe("review");
  });
});

// ── Router ──────────────────────────────────────────────────────────

describe("router", () => {
  it("picks Base when Ethereum gas is expensive", async () => {
    const gasOracle = new GasOracle({
      ethereumRpcUrl: testConfig.ethereum_rpc_url,
      baseRpcUrl: testConfig.base_rpc_url,
      sandbox: true,
    });

    // Force gas prices: ETH expensive, Base cheap
    vi.spyOn(gasOracle, "estimateTransferCost").mockImplementation(async (chain) => {
      return chain === "ethereum" ? "12.5000" : "0.0020";
    });

    const banking = stubBankingClient();
    const router = new ClearingRouter(gasOracle, banking);
    const instruction = makeInstruction();

    const route = await router.findBestRoute(instruction);
    expect(route.chain).toBe("base");
  });

  it("handles USDC-to-USDC without FX", async () => {
    const gasOracle = new GasOracle({
      ethereumRpcUrl: testConfig.ethereum_rpc_url,
      baseRpcUrl: testConfig.base_rpc_url,
      sandbox: true,
    });

    vi.spyOn(gasOracle, "estimateTransferCost").mockImplementation(async (chain) => {
      return chain === "ethereum" ? "8.0000" : "0.0030";
    });

    const banking = stubBankingClient();
    const router = new ClearingRouter(gasOracle, banking);

    const instruction = makeInstruction({
      source_currency: "USDC",
      target_currency: "USDC",
      amount: "10000.00",
    });

    const route = await router.findBestRoute(instruction);

    // No FX quotes should be fetched for USDC→USDC
    expect(banking.getQuote).not.toHaveBeenCalled();
    // Total cost = gas only (no FX spread)
    expect(route.chain).toBe("base");
    expect(parseFloat(route.total_cost_usd)).toBeLessThan(1);
  });
});

// ── Escrow state machine ────────────────────────────────────────────

describe("escrow state machine", () => {
  let chainClient: ChainClient;
  let escrow: EscrowManager;

  const chain = "base" as const;
  const params = {
    bankA: "0xaaaa",
    bankB: "0xbbbb",
    chain,
    usdcAmount: "5000.00",
    deadline: Math.floor(Date.now() / 1000) + 7200,
  };

  beforeEach(() => {
    chainClient = new ChainClient({
      ethereumRpcUrl: testConfig.ethereum_rpc_url,
      baseRpcUrl: testConfig.base_rpc_url,
      sandbox: true,
    });
    escrow = new EscrowManager(chainClient, true);
  });

  it("happy path: deploy → fund → sign A → sign B → released", async () => {
    const deployed = await escrow.deployEscrow(params);
    expect(deployed.state).toBe("awaiting_funding");

    const funded = await escrow.fundEscrow(deployed.contract_address, chain, "5000.00");
    expect(funded.state).toBe("funded");

    const signedA = await escrow.sign(deployed.contract_address, chain, "bank_a");
    expect(signedA.bank_a_signed).toBe(true);
    expect(signedA.state).toBe("funded"); // only one sig, not released yet

    const signedB = await escrow.sign(deployed.contract_address, chain, "bank_b");
    expect(signedB.bank_b_signed).toBe(true);
    expect(signedB.state).toBe("released");
    expect(signedB.release_tx).toBeTruthy();
  }, 15_000);

  it("rejects getState on unknown address", async () => {
    await expect(escrow.getState("0xnonexistent")).rejects.toThrow("unknown escrow");
  });

  it("rejects signing before funding", async () => {
    const deployed = await escrow.deployEscrow(params);

    await expect(
      escrow.sign(deployed.contract_address, chain, "bank_a"),
    ).rejects.toThrow("awaiting_funding");
  }, 10_000);

  it("rejects double-sign by same bank", async () => {
    const deployed = await escrow.deployEscrow(params);
    await escrow.fundEscrow(deployed.contract_address, chain, "5000.00");
    await escrow.sign(deployed.contract_address, chain, "bank_a");

    await expect(
      escrow.sign(deployed.contract_address, chain, "bank_a"),
    ).rejects.toThrow("bank A already signed");
  }, 10_000);

  it("allows refund after deadline passes", async () => {
    const shortDeadline = {
      ...params,
      deadline: Math.floor(Date.now() / 1000) - 10, // already expired
    };

    const deployed = await escrow.deployEscrow(shortDeadline);
    await escrow.fundEscrow(deployed.contract_address, chain, "5000.00");

    const refunded = await escrow.refund(deployed.contract_address, chain);
    expect(refunded.state).toBe("refunded");
  }, 10_000);
});

// ── Full pipeline ───────────────────────────────────────────────────

describe("full pipeline", () => {
  it("settles end-to-end and produces a complete receipt", async () => {
    const agent = new ClearingAgent(testConfig);

    // Replace the banking client with our mock
    const banking = stubBankingClient();
    (agent as unknown as { bankingClient: BankingClient }).bankingClient = banking;

    // Also patch the router to use the mocked banking client
    (agent as unknown as { router: ClearingRouter }).router = new ClearingRouter(
      (agent as unknown as { gasOracle: GasOracle }).gasOracle,
      banking,
    );

    const events: ClearingEvent[] = [];
    const instruction = makeInstruction();

    const receipt = await agent.settle(instruction, (e) => events.push(e));

    // Receipt has all fields populated
    expect(receipt.instruction_id).toBe("pi-001");
    expect(receipt.instruction).toEqual(instruction);
    expect(receipt.compliance.cleared).toBe(true);
    expect(receipt.route.chain).toBeDefined();
    expect(receipt.on_ramp.conversion_id).toBeTruthy();
    expect(receipt.escrow.state).toBe("released");
    expect(receipt.escrow.release_tx).toBeTruthy();
    expect(receipt.off_ramp.conversion_id).toBeTruthy();
    expect(receipt.proof.tx_hash).toBeTruthy();
    expect(receipt.proof.receipt_hash).toBeTruthy();
    expect(receipt.total_duration_ms).toBeGreaterThan(0);
    expect(receipt.settled_at).toBeTruthy();

    // Events were emitted for each step
    const steps = events.map((e) => e.step);
    expect(steps).toContain("compliance");
    expect(steps).toContain("routing");
    expect(steps).toContain("on_ramp");
    expect(steps).toContain("escrow_deploy");
    expect(steps).toContain("escrow_fund");
    expect(steps).toContain("sign_a");
    expect(steps).toContain("sign_b");
    expect(steps).toContain("off_ramp");
    expect(steps).toContain("anchor_proof");
    expect(steps).toContain("settled");

    // Every step has a started+completed pair (except settled which is just completed)
    const pipelineSteps = ["compliance", "routing", "on_ramp", "escrow_deploy", "escrow_fund", "sign_a", "sign_b", "off_ramp", "anchor_proof"];
    for (const step of pipelineSteps) {
      const stepEvents = events.filter((e) => e.step === step);
      expect(stepEvents.some((e) => e.status === "started"), `${step} should have started event`).toBe(true);
      expect(stepEvents.some((e) => e.status === "completed"), `${step} should have completed event`).toBe(true);
    }

    // Banking client was called for on-ramp and off-ramp conversions
    expect(banking.createConversion).toHaveBeenCalledTimes(2);
    expect(banking.listAccounts).toHaveBeenCalled();
  }, 30_000);
});
