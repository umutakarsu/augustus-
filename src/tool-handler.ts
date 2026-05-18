import type { BankingClient, PaymentsClient } from "./augustus-client.js";

type In = Record<string, unknown>;
type Clients = { banking: BankingClient; payments: PaymentsClient | null };

const pendingPayouts = new Map<string, {
  source_account_id: string;
  amount: string;
  currency: string;
  iban: string;
  account_holder_name: string;
  reference: string;
  prepared_at: number;
}>();

export async function handleToolCall(clients: Clients, name: string, input: In): Promise<string> {
  const { banking, payments } = clients;

  switch (name) {
    case "prepare_payout":
      return preparePayout(clients, input);
    case "confirm_payout":
      return confirmPayout(clients, input.preparation_id as string);
    case "check_payout_status":
      return checkPayoutStatus(banking, input.payout_id as string);
    case "retry_failed_payout":
      return retryFailedPayout(banking, input.payout_id as string);
    case "treasury_report":
      return treasuryReport(banking);
    case "fx_quote":
      return fxQuote(banking, input);
    case "execute_conversion":
      return executeConversion(banking, input);
    case "create_payment_link":
      return createPaymentLink(payments, input);
    case "check_payment_status":
      return checkPaymentStatus(clients, input);
    case "reconcile_deposits":
      return reconcileDeposits(banking, input);
    case "refund_payment":
      return refundPayment(payments, input);
    case "find_banks":
      return findBanks(payments, input);
    case "list_accounts":
      return json(await banking.listAccounts({ status: input.status as string | undefined }));
    case "list_transactions":
      return json(await banking.listTransactions({
        account_id: input.account_id as string | undefined,
        limit: input.limit as number | undefined,
      }));
    default:
      return json({ error: `Unknown tool: ${name}` });
  }
}

// ── Two-Phase Payout Workflow ────────────────────────────────────────

async function preparePayout(clients: Clients, input: In): Promise<string> {
  const iban = input.iban as string;
  const name = input.account_holder_name as string;
  const sourceId = input.source_account_id as string;
  const amount = input.amount as string;
  const currency = input.currency as string;
  const reference = input.reference as string;

  const steps: Record<string, unknown> = {};

  // Step 1: Verify payee (if payments client available)
  if (clients.payments) {
    try {
      const vop = await clients.payments.verifyPayee(iban, name);
      steps.verification = {
        result: vop.status,
        suggestion: vop.suggestedAccountHolderName,
        safe: vop.status === "match" || vop.status === "partial_match",
      };
      if (vop.status === "no_match") {
        steps.verification_warning = `Name "${name}" does NOT match bank records for ${iban}. Suggested name: ${vop.suggestedAccountHolderName ?? "unavailable"}. Proceeding is risky.`;
      }
    } catch {
      steps.verification = { result: "skipped", reason: "VOP check failed — proceeding without verification" };
    }
  } else {
    steps.verification = { result: "skipped", reason: "Payments API not configured — cannot verify payee" };
  }

  // Step 2: Check balance
  const balance = await clients.banking.getBalance(sourceId);
  const available = parseFloat(balance.amount);
  const requested = parseFloat(amount);
  steps.balance_check = {
    available: `${balance.amount} ${balance.currency}`,
    requested: `${amount} ${currency}`,
    sufficient: available >= requested,
  };

  if (available < requested) {
    steps.blocked = `Insufficient funds: ${balance.amount} ${balance.currency} available, ${amount} ${currency} requested.`;
    return json(steps);
  }

  // Store preparation for confirm step
  const prepId = `prep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingPayouts.set(prepId, { source_account_id: sourceId, amount, currency, iban, account_holder_name: name, reference, prepared_at: Date.now() });

  steps.preparation_id = prepId;
  steps.status = "ready";
  steps.next_step = "Show the user these results. If they confirm, call confirm_payout with this preparation_id.";

  return json(steps);
}

async function confirmPayout(clients: Clients, prepId: string): Promise<string> {
  const prep = pendingPayouts.get(prepId);
  if (!prep) {
    return json({ error: "Preparation not found or expired. Run prepare_payout again." });
  }

  const ageMinutes = (Date.now() - prep.prepared_at) / 60_000;
  if (ageMinutes > 5) {
    pendingPayouts.delete(prepId);
    return json({ error: `Preparation expired (${Math.round(ageMinutes)} min old). Balance or VOP status may have changed. Run prepare_payout again.` });
  }

  const payout = await clients.banking.createPayout({
    source_account_id: prep.source_account_id,
    amount: prep.amount,
    currency: prep.currency,
    destination: { type: "iban", iban: prep.iban, account_holder_name: prep.account_holder_name },
    reference: prep.reference,
  });

  pendingPayouts.delete(prepId);

  return json({
    payout: {
      id: payout.id,
      status: payout.status,
      amount: `${payout.amount} ${payout.currency}`,
      reference: payout.reference,
      destination: prep.iban,
    },
  });
}

async function retryFailedPayout(banking: BankingClient, payoutId: string): Promise<string> {
  const original = await banking.getPayout(payoutId);

  if (original.status !== "failed") {
    return json({ error: `Payout ${payoutId} has status "${original.status}" — only failed payouts can be retried.` });
  }

  const retried = await banking.createPayout({
    source_account_id: original.source_account_id,
    amount: original.amount,
    currency: original.currency,
    destination: original.destination,
    reference: original.reference,
  });

  return json({
    original_payout: { id: original.id, status: original.status, failure: original.failure?.message },
    retried_payout: {
      id: retried.id,
      status: retried.status,
      amount: `${retried.amount} ${retried.currency}`,
      reference: retried.reference,
    },
  });
}

async function checkPayoutStatus(banking: BankingClient, id: string): Promise<string> {
  const payout = await banking.getPayout(id);
  const result: Record<string, unknown> = {
    id: payout.id,
    status: payout.status,
    amount: `${payout.amount} ${payout.currency}`,
    created: payout.created_at,
    updated: payout.updated_at,
  };

  if (payout.failure) {
    result.failure_reason = payout.failure.message;
    result.failure_code = payout.failure.code;
  }

  const created = new Date(payout.created_at).getTime();
  const age_hours = (Date.now() - created) / (1000 * 60 * 60);
  if (payout.status === "pending" && age_hours > 24) {
    result.warning = `Payout has been pending for ${Math.round(age_hours)} hours — this is unusually long.`;
  }

  return json(result);
}

// ── Treasury Report ──────────────────────────────────────────────────

async function treasuryReport(banking: BankingClient): Promise<string> {
  const [accountsRes, payoutsRes, txRes] = await Promise.all([
    banking.listAccounts({ limit: 100 }),
    banking.listPayouts({ limit: 20 }),
    banking.listTransactions({ limit: 30 }),
  ]);

  // Fetch balances in parallel
  const balances = await Promise.all(
    accountsRes.data.map(async (a) => {
      try {
        const b = await banking.getBalance(a.id);
        return { account_id: a.id, label: a.label, currency: a.currency, amount: b.amount, status: a.status };
      } catch {
        return { account_id: a.id, label: a.label, currency: a.currency, amount: "error", status: a.status };
      }
    }),
  );

  // Anomaly detection
  const anomalies: string[] = [];

  for (const b of balances) {
    if (b.amount === "0" || b.amount === "0.00") {
      anomalies.push(`Zero balance: ${b.label} (${b.currency})`);
    }
  }

  for (const p of payoutsRes.data) {
    if (p.status === "pending") {
      const age = (Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60);
      if (age > 24) {
        anomalies.push(`Stale payout: ${p.id} — pending for ${Math.round(age)}h (${p.amount} ${p.currency})`);
      }
    }
    if (p.status === "failed") {
      anomalies.push(`Failed payout: ${p.id} — ${p.failure?.message ?? "unknown reason"} (${p.amount} ${p.currency})`);
    }
  }

  for (const tx of txRes.data) {
    const amt = parseFloat(tx.amount);
    if (amt > 10000) {
      anomalies.push(`Large transaction: ${tx.side} ${tx.amount} ${tx.currency} on ${tx.created_at.split("T")[0]}`);
    }
  }

  return json({
    balances,
    recent_payouts: payoutsRes.data.map((p) => ({
      id: p.id, status: p.status, amount: `${p.amount} ${p.currency}`, created: p.created_at,
    })),
    recent_transactions: txRes.data.slice(0, 10).map((tx) => ({
      id: tx.id, side: tx.side, amount: `${tx.amount} ${tx.currency}`, ref: tx.reference, date: tx.created_at,
    })),
    anomalies: anomalies.length ? anomalies : ["No anomalies detected"],
    generated_at: new Date().toISOString(),
  });
}

// ── FX with Slippage Protection ──────────────────────────────────────

async function fxQuote(banking: BankingClient, input: In): Promise<string> {
  const quote = await banking.getQuote({
    source_currency: input.from as string,
    target_currency: input.to as string,
    source_amount: input.amount as string | undefined,
  });
  return json({
    rate: quote.rate,
    from: quote.source_currency,
    to: quote.target_currency,
    source_amount: quote.source_amount,
    target_amount: quote.target_amount,
    warning: "This rate is indicative and not guaranteed. Actual rate may differ at execution.",
  });
}

async function executeConversion(banking: BankingClient, input: In): Promise<string> {
  const sourceId = input.source_account_id as string;
  const targetId = input.target_account_id as string;
  const amount = input.amount as string;

  // Get pre-trade quote
  const sourceBalance = await banking.getBalance(sourceId);
  const targetBalance = await banking.getBalance(targetId);

  const quote = await banking.getQuote({
    source_currency: sourceBalance.currency,
    target_currency: targetBalance.currency,
    source_amount: amount,
  });

  // Execute
  const conversion = await banking.createConversion({
    source_account_id: sourceId,
    target_account_id: targetId,
    source_amount: amount,
  });

  // Check slippage
  const quotedRate = parseFloat(quote.rate);
  const actualRate = conversion.target_amount && conversion.source_amount
    ? parseFloat(conversion.target_amount) / parseFloat(conversion.source_amount)
    : null;

  const result: Record<string, unknown> = {
    conversion_id: conversion.id,
    status: conversion.status,
    source: `${conversion.source_amount} ${conversion.source_currency}`,
    target: `${conversion.target_amount} ${conversion.target_currency}`,
    quoted_rate: quote.rate,
    actual_rate: actualRate?.toFixed(6) ?? "pending",
  };

  if (actualRate !== null) {
    const slippage = Math.abs(actualRate - quotedRate) / quotedRate;
    result.slippage_pct = (slippage * 100).toFixed(3);
    if (slippage > 0.005) {
      result.slippage_warning = `Rate slippage of ${(slippage * 100).toFixed(2)}% exceeds 0.5% threshold. Quoted ${quote.rate}, got ${actualRate.toFixed(6)}.`;
    }
  }

  return json(result);
}

// ── Payment Acceptance ───────────────────────────────────────────────

async function createPaymentLink(payments: PaymentsClient | null, input: In): Promise<string> {
  if (!payments) return json({ error: "Set AUGUSTUS_PAYMENTS_API_KEY to create payment links" });

  const session = await payments.createCheckout({
    price: { total: input.amount as number, currency: input.currency as string },
    referenceId: input.reference_id as string,
    successCallbackUrl: input.success_url as string,
    errorCallbackUrl: input.error_url as string,
    paymentSchemeSelection: "instant_preferred",
    market: input.market as string | undefined,
    customer: input.customer_email ? { email: input.customer_email as string } : undefined,
  });

  return json({
    session_id: session.id,
    payment_link: session.redirectUrl,
    status: session.status,
    amount: `${session.price.total} ${session.price.currency}`,
    reference: session.referenceId,
    expires_at: new Date(session.expiresAt * 1000).toISOString(),
    tip: input.customer_email
      ? "Remember Me enabled — returning customers will check out faster."
      : "Consider adding customer_email to enable Remember Me (20%+ conversion boost).",
  });
}

async function checkPaymentStatus(clients: Clients, input: In): Promise<string> {
  if (input.checkout_id && clients.payments) {
    const session = await clients.payments.getCheckout(input.checkout_id as string);
    return json({
      type: "checkout_session",
      id: session.id,
      status: session.status,
      amount: `${session.price.total} ${session.price.currency}`,
      reference: session.referenceId,
    });
  }
  if (input.order_id && clients.payments) {
    const order = await clients.payments.getOrder(input.order_id as string);
    return json({
      type: "order",
      id: order.id,
      status: order.status,
      settled: order.status === "paid",
      amount: `${order.price.total} ${order.price.currency}`,
      reference: order.referenceId,
    });
  }
  return json({ error: "Provide checkout_id or order_id. Payments API must be configured." });
}

// ── Reconciliation (fuzzy matching) ──────────────────────────────────

interface ExpectedPayment { reference: string; amount: string; currency: string }

function refsMatch(expected: string, actual: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_/]+/g, "");
  const a = norm(expected);
  const b = norm(actual);
  return a === b || b.includes(a) || a.includes(b);
}

function amountsMatch(expected: string, actual: string, tolerance: number): boolean {
  return Math.abs(parseFloat(expected) - parseFloat(actual)) <= tolerance;
}

async function reconcileDeposits(banking: BankingClient, input: In): Promise<string> {
  const expected = input.expected as ExpectedPayment[];
  const limit = (input.limit as number) ?? 50;
  const tolerance = (input.tolerance as number) ?? 0.02;

  const depositsRes = await banking.listDeposits({ limit });
  const deposits = depositsRes.data;

  const matched: Array<{ expected: ExpectedPayment; deposit_id: string; deposit_amount: string; match_type: string }> = [];
  const unmatchedDeposits: typeof deposits = [];
  const unmatchedExpected: ExpectedPayment[] = [];
  const usedDeposits = new Set<string>();

  for (const exp of expected) {
    // Try exact match first
    let match = deposits.find(
      (d) =>
        !usedDeposits.has(d.id) &&
        d.bank_statement_reference === exp.reference &&
        d.amount === exp.amount &&
        d.currency === exp.currency,
    );
    let matchType = "exact";

    // Fall back to fuzzy match
    if (!match) {
      match = deposits.find(
        (d) =>
          !usedDeposits.has(d.id) &&
          d.currency === exp.currency &&
          refsMatch(exp.reference, d.bank_statement_reference) &&
          amountsMatch(exp.amount, d.amount, tolerance),
      );
      matchType = "fuzzy";
    }

    if (match) {
      matched.push({
        expected: exp,
        deposit_id: match.id,
        deposit_amount: `${match.amount} ${match.currency}`,
        match_type: matchType,
      });
      usedDeposits.add(match.id);
    } else {
      unmatchedExpected.push(exp);
    }
  }

  for (const d of deposits) {
    if (!usedDeposits.has(d.id)) {
      unmatchedDeposits.push(d);
    }
  }

  return json({
    summary: {
      total_expected: expected.length,
      matched: matched.length,
      matched_exact: matched.filter((m) => m.match_type === "exact").length,
      matched_fuzzy: matched.filter((m) => m.match_type === "fuzzy").length,
      missing_payments: unmatchedExpected.length,
      unexpected_deposits: unmatchedDeposits.length,
      tolerance_used: tolerance,
    },
    matched,
    missing_payments: unmatchedExpected.length
      ? { items: unmatchedExpected, note: "These expected payments have not been received yet." }
      : null,
    unexpected_deposits: unmatchedDeposits.length
      ? {
          items: unmatchedDeposits.map((d) => ({
            id: d.id, amount: `${d.amount} ${d.currency}`, ref: d.bank_statement_reference, received: d.created_at,
          })),
          note: "These deposits were received but don't match any expected payment.",
        }
      : null,
  });
}

// ── Refunds ──────────────────────────────────────────────────────────

async function refundPayment(payments: PaymentsClient | null, input: In): Promise<string> {
  if (!payments) return json({ error: "Set AUGUSTUS_PAYMENTS_API_KEY to issue refunds" });

  const refund = await payments.createRefund({
    orderId: input.order_id as string | undefined,
    referenceId: input.reference_id as string | undefined,
    amount: input.amount as number,
  });

  return json({
    refund_id: refund.id,
    status: refund.status,
    amount: `${refund.amount} ${refund.currency}`,
    order_id: refund.orderId,
  });
}

// ── Bank Search ──────────────────────────────────────────────────────

async function findBanks(payments: PaymentsClient | null, input: In): Promise<string> {
  if (!payments) return json({ error: "Set AUGUSTUS_PAYMENTS_API_KEY to search banks" });

  const result = await payments.searchBanks({
    market: input.country as string | undefined,
    search: input.search as string | undefined,
  });

  return json({
    count: result.count,
    banks: result.banks.slice(0, 20).map((b) => ({
      name: b.name,
      market: b.market,
      currencies: b.currencies,
    })),
    note: result.count > 20 ? `Showing 20 of ${result.count}. Use a more specific search to narrow results.` : undefined,
  });
}

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
