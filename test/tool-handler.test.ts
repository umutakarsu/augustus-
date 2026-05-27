import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleToolCall } from "../src/tool-handler.js";
import type { BankingClient, PaymentsClient } from "../src/augustus-client.js";

// Stubs that behave like the real API — returning realistic data,
// not just empty objects.

function stubBanking(overrides: Partial<BankingClient> = {}): BankingClient {
  return {
    listAccounts: vi.fn().mockResolvedValue({
      data: [
        { id: "acc-eur", currency: "EUR", label: "EUR Operating", status: "active", asset_type: "fiat", account_type: "payment_account", financial_addresses: [{ type: "iban", iban: "DE89370400440532013000" }], created_at: "2026-01-01T00:00:00Z" },
        { id: "acc-usdc", currency: "USDC", label: "USDC Wallet", status: "active", asset_type: "crypto", account_type: "payment_account", financial_addresses: [{ type: "crypto", address: "0xabc...", blockchain: "ethereum" }], created_at: "2026-01-01T00:00:00Z" },
      ],
      has_more: false, next_cursor: null,
    }),
    getBalance: vi.fn().mockImplementation((id: string) => {
      if (id === "acc-eur") return Promise.resolve({ account_id: id, amount: "24500.00", currency: "EUR", as_of: new Date().toISOString() });
      if (id === "acc-usdc") return Promise.resolve({ account_id: id, amount: "12340.50", currency: "USDC", as_of: new Date().toISOString() });
      if (id === "acc-broke") return Promise.resolve({ account_id: id, amount: "0.00", currency: "EUR", as_of: new Date().toISOString() });
      return Promise.resolve({ account_id: id, amount: "1000.00", currency: "EUR", as_of: new Date().toISOString() });
    }),
    listTransactions: vi.fn().mockResolvedValue({
      data: [
        { id: "tx-1", amount: "500.00", currency: "EUR", side: "debit", balance: "24000.00", reference: "PAYOUT-001", created_at: "2026-05-17T10:00:00Z" },
        { id: "tx-2", amount: "15000.00", currency: "EUR", side: "credit", balance: "24500.00", reference: "DEPOSIT-BIG", created_at: "2026-05-16T08:00:00Z" },
      ],
      has_more: false, next_cursor: null,
    }),
    listPayouts: vi.fn().mockResolvedValue({
      data: [
        { id: "po-1", status: "paid", source_account_id: "acc-eur", amount: "500.00", currency: "EUR", reference: "Salary Jan", failure: null, created_at: "2026-05-17T10:00:00Z", updated_at: "2026-05-17T10:05:00Z" },
      ],
      has_more: false, next_cursor: null,
    }),
    createPayout: vi.fn().mockResolvedValue({
      id: "po-new", status: "pending", source_account_id: "acc-eur", amount: "500.00", currency: "EUR",
      destination: { type: "iban", iban: "DE89370400440532013000", account_holder_name: "Hans Mueller" },
      reference: "Invoice 42", failure: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }),
    getPayout: vi.fn().mockResolvedValue({
      id: "po-1", status: "paid", source_account_id: "acc-eur", amount: "500.00", currency: "EUR",
      reference: "Salary Jan", failure: null,
      created_at: "2026-05-17T10:00:00Z", updated_at: "2026-05-17T10:05:00Z",
    }),
    getQuote: vi.fn().mockResolvedValue({ rate: "1.0847", source_currency: "EUR", target_currency: "USDC", source_amount: "1000", target_amount: "1084.70" }),
    createConversion: vi.fn().mockResolvedValue({
      id: "conv-1", status: "completed", source_amount: "1000", source_currency: "EUR",
      target_amount: "1084.70", target_currency: "USDC", created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    }),
    getConversion: vi.fn().mockResolvedValue({ id: "conv-1", status: "completed" }),
    listDeposits: vi.fn().mockResolvedValue({
      data: [
        { id: "dep-1", status: "received", amount: "1000.00", currency: "EUR", bank_statement_reference: "INV-001", rail: "sepa", returns: [], created_at: "2026-05-17T08:00:00Z", updated_at: "2026-05-17T08:00:00Z", source: {}, destination_account_id: "acc-eur" },
        { id: "dep-2", status: "received", amount: "250.00", currency: "EUR", bank_statement_reference: "MYSTERY-PAY", rail: "sepa", returns: [], created_at: "2026-05-16T12:00:00Z", updated_at: "2026-05-16T12:00:00Z", source: {}, destination_account_id: "acc-eur" },
      ],
      has_more: false, next_cursor: null,
    }),
    getDeposit: vi.fn().mockResolvedValue({ id: "dep-1", status: "received", amount: "1000.00", currency: "EUR" }),
    createReturn: vi.fn().mockResolvedValue({ id: "ret-1", status: "pending", deposit_id: "dep-1", amount: "1000.00", currency: "EUR", failure: null, created_at: new Date().toISOString() }),
    listReturns: vi.fn().mockResolvedValue({ data: [], has_more: false, next_cursor: null }),
    ...overrides,
  } as unknown as BankingClient;
}

function stubPayments(overrides: Partial<PaymentsClient> = {}): PaymentsClient {
  return {
    verifyPayee: vi.fn().mockResolvedValue({ status: "match" }),
    createCheckout: vi.fn().mockResolvedValue({
      id: "cs-1", status: "open", redirectUrl: "https://checkout.augustus.com/cs-1",
      referenceId: "ORDER-42", price: { total: 119, currency: "EUR" },
      created: Date.now() / 1000, expiresAt: Date.now() / 1000 + 3600,
    }),
    getCheckout: vi.fn().mockResolvedValue({ id: "cs-1", status: "closed", referenceId: "ORDER-42", price: { total: 119, currency: "EUR" } }),
    getOrder: vi.fn().mockResolvedValue({ id: "ord-1", status: "paid", referenceId: "ORDER-42", price: { total: 119, currency: "EUR" } }),
    createRefund: vi.fn().mockResolvedValue({ id: "ref-1", amount: 50, currency: "EUR", status: "initiated", orderId: "ord-1" }),
    searchBanks: vi.fn().mockResolvedValue({ banks: [{ id: "b1", name: "Deutsche Bank", logo: "", market: "DE", currencies: ["EUR"] }], count: 1 }),
    ...overrides,
  } as unknown as PaymentsClient;
}

describe("Two-Phase Payout Workflow", () => {
  const payoutInput = {
    source_account_id: "acc-eur",
    amount: "500.00",
    currency: "EUR",
    iban: "DE89370400440532013000",
    account_holder_name: "Hans Mueller",
    reference: "Invoice 42",
  };

  it("blocks preparation when balance is insufficient", async () => {
    const banking = stubBanking();
    const payments = stubPayments();

    const result = JSON.parse(await handleToolCall({ banking, payments }, "prepare_payout", {
      ...payoutInput,
      source_account_id: "acc-broke",
      amount: "5000.00",
    }));

    expect(result.balance_check.sufficient).toBe(false);
    expect(result.blocked).toContain("Insufficient funds");
    expect(result.preparation_id).toBeUndefined();
    expect(banking.createPayout).not.toHaveBeenCalled();
  });

  it("prepare returns VOP warning without sending money", async () => {
    const banking = stubBanking();
    const payments = stubPayments({
      verifyPayee: vi.fn().mockResolvedValue({ status: "no_match", suggestedAccountHolderName: "Johannes Mueller" }),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments }, "prepare_payout", payoutInput));

    expect(result.verification.result).toBe("no_match");
    expect(result.verification.safe).toBe(false);
    expect(result.verification_warning).toContain("does NOT match");
    expect(result.preparation_id).toBeDefined();
    expect(result.status).toBe("ready");
    expect(banking.createPayout).not.toHaveBeenCalled();
  });

  it("prepare + confirm sends the payout", async () => {
    const banking = stubBanking();
    const payments = stubPayments();

    const prep = JSON.parse(await handleToolCall({ banking, payments }, "prepare_payout", payoutInput));
    expect(prep.verification.result).toBe("match");
    expect(prep.preparation_id).toBeDefined();
    expect(banking.createPayout).not.toHaveBeenCalled();

    const confirm = JSON.parse(await handleToolCall({ banking, payments }, "confirm_payout", {
      preparation_id: prep.preparation_id,
    }));
    expect(confirm.payout.id).toBe("po-new");
    expect(confirm.payout.status).toBe("pending");
    expect(banking.createPayout).toHaveBeenCalledTimes(1);
  });

  it("confirm rejects invalid preparation_id", async () => {
    const banking = stubBanking();
    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "confirm_payout", {
      preparation_id: "prep_bogus",
    }));
    expect(result.error).toContain("not found");
    expect(banking.createPayout).not.toHaveBeenCalled();
  });

  it("gracefully handles VOP unavailability", async () => {
    const banking = stubBanking();
    const payments = stubPayments({
      verifyPayee: vi.fn().mockRejectedValue(new Error("VOP service unavailable")),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments }, "prepare_payout", {
      ...payoutInput,
      amount: "100.00",
    }));

    expect(result.verification.result).toBe("skipped");
    expect(result.preparation_id).toBeDefined();
  });
});

describe("Retry Failed Payout", () => {
  it("retries a failed payout with new idempotency key", async () => {
    const banking = stubBanking({
      getPayout: vi.fn().mockResolvedValue({
        id: "po-fail", status: "failed", source_account_id: "acc-eur", amount: "200.00", currency: "EUR",
        destination: { type: "iban", iban: "DE89370400440532013000", account_holder_name: "Hans" },
        reference: "Retry me", failure: { code: "insufficient_funds", message: "Not enough balance" },
        created_at: "2026-05-17T10:00:00Z", updated_at: "2026-05-17T10:01:00Z",
      }),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "retry_failed_payout", {
      payout_id: "po-fail",
    }));

    expect(result.original_payout.status).toBe("failed");
    expect(result.retried_payout.id).toBe("po-new");
    expect(banking.createPayout).toHaveBeenCalled();
  });

  it("refuses to retry a non-failed payout", async () => {
    const banking = stubBanking();
    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "retry_failed_payout", {
      payout_id: "po-1",
    }));
    expect(result.error).toContain("paid");
    expect(banking.createPayout).not.toHaveBeenCalled();
  });
});

describe("Treasury Report", () => {
  it("flags large transactions over 10k", async () => {
    const banking = stubBanking();
    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "treasury_report", {}));

    const hasLargeTxAnomaly = result.anomalies.some((a: string) => a.includes("Large transaction") && a.includes("15000"));
    expect(hasLargeTxAnomaly).toBe(true);
  });

  it("flags stale pending payouts", async () => {
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const banking = stubBanking({
      listPayouts: vi.fn().mockResolvedValue({
        data: [{ id: "po-stale", status: "pending", amount: "200.00", currency: "EUR", failure: null, created_at: staleDate, updated_at: staleDate }],
        has_more: false, next_cursor: null,
      }),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "treasury_report", {}));
    const hasStaleAnomaly = result.anomalies.some((a: string) => a.includes("Stale payout") && a.includes("po-stale"));
    expect(hasStaleAnomaly).toBe(true);
  });
});

describe("Reconciliation", () => {
  it("matches deposits against expected payments (exact)", async () => {
    const banking = stubBanking();

    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "reconcile_deposits", {
      expected: [
        { reference: "INV-001", amount: "1000.00", currency: "EUR" },
        { reference: "INV-002", amount: "500.00", currency: "EUR" },
      ],
    }));

    expect(result.summary.matched).toBe(1);
    expect(result.summary.matched_exact).toBe(1);
    expect(result.summary.missing_payments).toBe(1);
    expect(result.summary.unexpected_deposits).toBe(1);
    expect(result.missing_payments.items[0].reference).toBe("INV-002");
    expect(result.unexpected_deposits.items[0].ref).toBe("MYSTERY-PAY");
  });

  it("fuzzy matches on mangled reference and fee-adjusted amount (small transfer)", async () => {
    const banking = stubBanking({
      listDeposits: vi.fn().mockResolvedValue({
        data: [
          { id: "dep-f1", status: "received", amount: "149.98", currency: "EUR", bank_statement_reference: "inv-001", rail: "sepa", returns: [], created_at: "2026-05-17T00:00:00Z", source: {}, destination_account_id: "acc-eur" },
        ],
        has_more: false, next_cursor: null,
      }),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "reconcile_deposits", {
      expected: [{ reference: "INV-001", amount: "150.00", currency: "EUR" }],
    }));

    expect(result.summary.matched).toBe(1);
    expect(result.summary.matched_fuzzy).toBe(1);
    expect(result.matched[0].match_type).toBe("fuzzy");
  });

  it("fuzzy matches when bank truncates or mangles reference", async () => {
    const banking = stubBanking({
      listDeposits: vi.fn().mockResolvedValue({
        data: [
          { id: "dep-f2", status: "received", amount: "500.00", currency: "EUR", bank_statement_reference: "PAYMENT INV 042 FROM CLIENT", rail: "sepa", returns: [], created_at: "2026-05-17T00:00:00Z", source: {}, destination_account_id: "acc-eur" },
        ],
        has_more: false, next_cursor: null,
      }),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "reconcile_deposits", {
      expected: [{ reference: "INV-042", amount: "500.00", currency: "EUR" }],
    }));

    expect(result.summary.matched).toBe(1);
    expect(result.summary.matched_fuzzy).toBe(1);
  });

  it("requires exact amount match on large transfers", async () => {
    const banking = stubBanking({
      listDeposits: vi.fn().mockResolvedValue({
        data: [
          { id: "dep-big", status: "received", amount: "99999.98", currency: "EUR", bank_statement_reference: "inv-500", rail: "sepa", returns: [], created_at: "2026-05-17T00:00:00Z", source: {}, destination_account_id: "acc-eur" },
        ],
        has_more: false, next_cursor: null,
      }),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "reconcile_deposits", {
      expected: [{ reference: "INV-500", amount: "100000.00", currency: "EUR" }],
    }));

    // 0.02 diff on a 100k transfer should NOT fuzzy match
    expect(result.summary.matched).toBe(0);
    expect(result.summary.missing_payments).toBe(1);
  });

  it("flags fuzzy matches on large amounts for manual review", async () => {
    const banking = stubBanking({
      listDeposits: vi.fn().mockResolvedValue({
        data: [
          { id: "dep-lg", status: "received", amount: "50000.00", currency: "EUR", bank_statement_reference: "invoice 789 payment", rail: "sepa", returns: [], created_at: "2026-05-17T00:00:00Z", source: {}, destination_account_id: "acc-eur" },
        ],
        has_more: false, next_cursor: null,
      }),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "reconcile_deposits", {
      expected: [{ reference: "INVOICE-789", amount: "50000.00", currency: "EUR" }],
    }));

    // Exact amount, fuzzy reference on a large amount — matches but with warning
    expect(result.summary.matched).toBe(1);
    expect(result.matched[0].match_type).toBe("fuzzy");
    expect(result.matched[0].warning).toContain("verify manually");
  });

  it("reports all clean when everything matches", async () => {
    const banking = stubBanking({
      listDeposits: vi.fn().mockResolvedValue({
        data: [
          { id: "dep-1", status: "received", amount: "100.00", currency: "EUR", bank_statement_reference: "REF-A", rail: "sepa", returns: [], created_at: "2026-05-17T00:00:00Z", source: {}, destination_account_id: "acc-eur" },
        ],
        has_more: false, next_cursor: null,
      }),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "reconcile_deposits", {
      expected: [{ reference: "REF-A", amount: "100.00", currency: "EUR" }],
    }));

    expect(result.summary.matched).toBe(1);
    expect(result.summary.missing_payments).toBe(0);
    expect(result.summary.unexpected_deposits).toBe(0);
  });
});

describe("FX Slippage Protection", () => {
  it("warns when actual rate diverges from quoted rate", async () => {
    const banking = stubBanking({
      getQuote: vi.fn().mockResolvedValue({ rate: "1.0800", source_currency: "EUR", target_currency: "USDC", source_amount: "1000", target_amount: "1080.00" }),
      createConversion: vi.fn().mockResolvedValue({
        id: "conv-slip", status: "completed",
        source_amount: "1000", source_currency: "EUR",
        target_amount: "1070.00", target_currency: "USDC",
        created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      }),
    });

    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "execute_conversion", {
      source_account_id: "acc-eur", target_account_id: "acc-usdc", amount: "1000",
    }));

    expect(parseFloat(result.slippage_pct)).toBeGreaterThan(0.5);
    expect(result.slippage_warning).toContain("exceeds 0.5%");
  });

  it("no warning when slippage is within tolerance", async () => {
    const banking = stubBanking();
    const result = JSON.parse(await handleToolCall({ banking, payments: null }, "execute_conversion", {
      source_account_id: "acc-eur", target_account_id: "acc-usdc", amount: "1000",
    }));

    expect(result.slippage_warning).toBeUndefined();
  });
});

describe("Payment Acceptance", () => {
  it("includes Remember Me tip when email is missing", async () => {
    const payments = stubPayments();
    const result = JSON.parse(await handleToolCall({ banking: stubBanking(), payments }, "create_payment_link", {
      amount: 119, currency: "EUR", reference_id: "ORD-1",
      success_url: "https://shop.com/ok", error_url: "https://shop.com/fail",
    }));

    expect(result.payment_link).toContain("checkout.augustus.com");
    expect(result.tip).toContain("Consider adding customer_email");
  });

  it("confirms Remember Me when email is provided", async () => {
    const payments = stubPayments();
    const result = JSON.parse(await handleToolCall({ banking: stubBanking(), payments }, "create_payment_link", {
      amount: 119, currency: "EUR", reference_id: "ORD-2",
      success_url: "https://shop.com/ok", error_url: "https://shop.com/fail",
      customer_email: "test@example.com",
    }));

    expect(result.tip).toContain("Remember Me enabled");
  });
});
