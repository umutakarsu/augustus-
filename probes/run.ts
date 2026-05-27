// Security probes for Augustus sandbox API.
// Run: AUGUSTUS_API_KEY=... npx tsx probes/run.ts
//
// Each probe hits the sandbox, reports what happened, and flags concerns.
// Not a framework. Just direct HTTP calls and observations.

const BASE = "https://api.sandbox.augustus.com";
const TOKEN = process.env.AUGUSTUS_API_KEY;

if (!TOKEN) {
  console.error("Set AUGUSTUS_API_KEY to a sandbox token.");
  process.exit(1);
}

function auth(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...extra };
}

async function raw(method: string, path: string, body?: unknown): Promise<{ status: number; headers: Headers; body: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: auth(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text };
}

function parse(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

type Finding = { probe: string; severity: "critical" | "high" | "medium" | "low" | "info"; detail: string };
const findings: Finding[] = [];

function finding(probe: string, severity: Finding["severity"], detail: string) {
  findings.push({ probe, severity, detail });
  const color = { critical: "\x1b[31m", high: "\x1b[31m", medium: "\x1b[33m", low: "\x1b[36m", info: "\x1b[90m" }[severity];
  console.log(`  ${color}[${severity}]\x1b[0m ${detail}`);
}

// ─── Helpers ───────────────────────────────────────────────────────

async function getFirstAccount(): Promise<{ id: string; currency: string }> {
  const res = await raw("GET", "/v1/accounts?limit=1");
  const data = JSON.parse(res.body);
  return data.data[0];
}

async function getBalance(id: string): Promise<string> {
  const res = await raw("GET", `/v1/accounts/${id}/balance`);
  return JSON.parse(res.body).amount;
}

// ─── Probe 1: Race condition on balance ────────────────────────────
// Fire N payouts simultaneously, each for the full balance.
// If more than one succeeds, the API doesn't lock on balance checks.

async function probeRaceCondition() {
  console.log("\n1. Race condition — concurrent payouts for full balance");

  const account = await getFirstAccount();
  const balance = await getBalance(account.id);

  if (parseFloat(balance) === 0) {
    finding("race", "info", `Account ${account.id} has zero balance, can't test race. Fund it first.`);
    return;
  }

  console.log(`  Account ${account.id}: ${balance} ${account.currency}`);
  console.log(`  Firing 5 concurrent payouts for ${balance} ${account.currency}...`);

  const payout = (i: number) => raw("POST", "/v1/payouts", {
    source_account_id: account.id,
    amount: balance,
    currency: account.currency,
    destination: { type: "iban", iban: "DE89370400440532013000", account_holder_name: `Race Test ${i}` },
    reference: `race-probe-${Date.now()}-${i}`,
  });

  const results = await Promise.all([payout(0), payout(1), payout(2), payout(3), payout(4)]);
  const succeeded = results.filter(r => r.status >= 200 && r.status < 300);
  const failed = results.filter(r => r.status >= 400);

  console.log(`  ${succeeded.length} succeeded, ${failed.length} rejected`);

  if (succeeded.length > 1) {
    finding("race", "critical", `${succeeded.length} of 5 concurrent full-balance payouts succeeded. Balance was ${balance}. No atomic balance lock.`);
  } else if (succeeded.length === 1) {
    finding("race", "info", "Only 1 payout succeeded. Balance appears to be locked atomically.");
  } else {
    finding("race", "info", `All payouts rejected (${failed[0]?.status}). Might need a funded account.`);
  }
}

// ─── Probe 2: BOLA — accessing other users' resources ──────────────
// Try to read accounts/payouts/deposits with fabricated UUIDs.
// A secure API returns 404 (not found), not 403 (forbidden).
// 403 leaks that the resource exists but belongs to someone else.

async function probeBOLA() {
  console.log("\n2. BOLA — broken object-level authorization");

  const fakeIds = [
    "00000000-0000-0000-0000-000000000001",
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  ];

  for (const id of fakeIds) {
    const endpoints = [
      `/v1/accounts/${id}`,
      `/v1/accounts/${id}/balance`,
      `/v1/payouts/${id}`,
      `/v1/deposits/${id}`,
      `/v1/conversions/${id}`,
    ];

    for (const ep of endpoints) {
      const res = await raw("GET", ep);
      if (res.status === 200) {
        finding("bola", "critical", `GET ${ep} returned 200 with someone else's data.`);
      } else if (res.status === 403) {
        finding("bola", "medium", `GET ${ep} returned 403 — confirms resource exists. Should be 404.`);
      } else if (res.status === 404) {
        // correct behavior
      } else {
        finding("bola", "low", `GET ${ep} returned unexpected ${res.status}.`);
      }
    }
  }

  finding("bola", "info", "Checked fabricated UUIDs across 5 endpoint types.");
}

// ─── Probe 3: Amount manipulation ──────────────────────────────────
// Negative amounts, zero, extreme precision, scientific notation.

async function probeAmountManipulation() {
  console.log("\n3. Amount manipulation — edge cases");

  const account = await getFirstAccount();

  const cases: Array<{ label: string; amount: string | number }> = [
    { label: "negative", amount: "-100.00" },
    { label: "zero", amount: "0.00" },
    { label: "sub-cent precision", amount: "0.001" },
    { label: "extreme precision", amount: "100.123456789012345" },
    { label: "scientific notation", amount: "1e5" },
    { label: "very large", amount: "999999999999999.99" },
    { label: "string injection", amount: "100.00; DROP TABLE payouts" },
  ];

  for (const { label, amount } of cases) {
    const res = await raw("POST", "/v1/payouts", {
      source_account_id: account.id,
      amount: String(amount),
      currency: account.currency,
      destination: { type: "iban", iban: "DE89370400440532013000", account_holder_name: "Amount Test" },
      reference: `amount-probe-${label}`,
    });

    const accepted = res.status >= 200 && res.status < 300;
    if (accepted && (label === "negative" || label === "zero" || label === "string injection")) {
      finding("amount", "critical", `"${label}" amount (${amount}) was ACCEPTED (${res.status}).`);
    } else if (accepted && label === "scientific notation") {
      finding("amount", "high", `Scientific notation "${amount}" was accepted — could bypass display-layer amount checks.`);
    } else if (accepted && label === "sub-cent precision") {
      finding("amount", "medium", `Sub-cent amount "${amount}" was accepted. Rounding behavior matters for reconciliation.`);
    } else if (!accepted) {
      finding("amount", "info", `"${label}" (${amount}) correctly rejected: ${res.status}.`);
    } else {
      finding("amount", "info", `"${label}" (${amount}): ${res.status}.`);
    }
  }
}

// ─── Probe 4: Idempotency key reuse with different params ──────────
// Send the same idempotency key twice with different amounts.
// Correct: return the original result. Dangerous: execute a second payout.

async function probeIdempotencyAbuse() {
  console.log("\n4. Idempotency key — reuse with different parameters");

  const account = await getFirstAccount();
  const sharedKey = crypto.randomUUID();

  const base = {
    source_account_id: account.id,
    currency: account.currency,
    destination: { type: "iban", iban: "DE89370400440532013000", account_holder_name: "Idemp Test" },
    reference: `idemp-probe-${Date.now()}`,
  };

  const res1 = await fetch(`${BASE}/v1/payouts`, {
    method: "POST",
    headers: { ...auth(), "Idempotency-Key": sharedKey },
    body: JSON.stringify({ ...base, amount: "1.00" }),
  });
  const body1 = await res1.text();

  const res2 = await fetch(`${BASE}/v1/payouts`, {
    method: "POST",
    headers: { ...auth(), "Idempotency-Key": sharedKey },
    body: JSON.stringify({ ...base, amount: "999.00" }),
  });
  const body2 = await res2.text();

  console.log(`  First call (1.00):  ${res1.status}`);
  console.log(`  Second call (999.00, same key): ${res2.status}`);

  if (res2.status >= 200 && res2.status < 300) {
    const p1 = parse(body1) as Record<string, unknown>;
    const p2 = parse(body2) as Record<string, unknown>;

    if (p1.id === p2.id) {
      finding("idempotency", "medium", "Same key + different amount returned the original response. Safe, but should ideally reject with 409/422 to signal the mismatch.");
    } else {
      finding("idempotency", "critical", "Same idempotency key with different amount created TWO payouts.");
    }
  } else if (res2.status === 409 || res2.status === 422) {
    finding("idempotency", "info", `Correctly rejected with ${res2.status} when params changed.`);
  } else {
    finding("idempotency", "low", `Unexpected second response: ${res2.status}.`);
  }
}

// ─── Probe 5: Reference field injection ────────────────────────────
// SEPA references end up in bank systems. Control characters, newlines,
// and field separators could break downstream parsing.

async function probeReferenceInjection() {
  console.log("\n5. Reference field injection — SEPA/SWIFT control chars");

  const account = await getFirstAccount();

  const payloads = [
    { label: "newline", ref: "LEGIT\nINJECTED-SECOND-LINE" },
    { label: "null byte", ref: "LEGIT\x00HIDDEN" },
    { label: "SWIFT field sep", ref: "LEGIT{4:INJECT}" },
    { label: "XML entity", ref: "LEGIT&amp;<script>alert(1)</script>" },
    { label: "overlength (200 chars)", ref: "A".repeat(200) },
    { label: "unicode RTL override", ref: "LEGIT‮DILIH" },
  ];

  for (const { label, ref } of payloads) {
    const res = await raw("POST", "/v1/payouts", {
      source_account_id: account.id,
      amount: "0.01",
      currency: account.currency,
      destination: { type: "iban", iban: "DE89370400440532013000", account_holder_name: "Ref Test" },
      reference: ref,
    });

    if (res.status >= 200 && res.status < 300) {
      const data = parse(res.body) as Record<string, unknown>;
      const stored = (data as { reference?: string }).reference;

      if (stored === ref) {
        finding("reference", "high", `"${label}" payload stored verbatim. Downstream systems may not handle this.`);
      } else {
        finding("reference", "low", `"${label}" accepted but sanitized (stored as "${stored?.slice(0, 40)}...").`);
      }
    } else {
      finding("reference", "info", `"${label}" rejected: ${res.status}.`);
    }
  }
}

// ─── Probe 6: Currency mismatch ────────────────────────────────────
// Send a payout in a currency that doesn't match the source account.

async function probeCurrencyMismatch() {
  console.log("\n6. Currency mismatch — payout from EUR account in GBP");

  const account = await getFirstAccount();
  const wrongCurrency = account.currency === "EUR" ? "GBP" : "EUR";

  const res = await raw("POST", "/v1/payouts", {
    source_account_id: account.id,
    amount: "1.00",
    currency: wrongCurrency,
    destination: { type: "iban", iban: "DE89370400440532013000", account_holder_name: "Currency Test" },
    reference: `currency-probe-${Date.now()}`,
  });

  if (res.status >= 200 && res.status < 300) {
    finding("currency", "high", `Payout in ${wrongCurrency} from ${account.currency} account was accepted. Implicit conversion or accounting error.`);
  } else {
    finding("currency", "info", `Correctly rejected (${res.status}): can't pay ${wrongCurrency} from ${account.currency} account.`);
  }
}

// ─── Probe 7: Auth token in error responses ────────────────────────
// Bad requests sometimes leak internal details in error bodies.

async function probeErrorLeakage() {
  console.log("\n7. Error response leakage — checking for internal details");

  const cases = [
    { label: "invalid JSON body", method: "POST", path: "/v1/payouts", body: "not json" },
    { label: "missing required fields", method: "POST", path: "/v1/payouts", body: "{}" },
    { label: "nonexistent endpoint", method: "GET", path: "/v1/admin/users", body: undefined },
    { label: "SQL-ish param", method: "GET", path: "/v1/accounts?status=active'%20OR%201=1--", body: undefined },
  ];

  for (const { label, method, path, body } of cases) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body === "not json" ? auth() : auth(),
      body: body ?? undefined,
    });
    const text = await res.text();

    const leaky = /stack|trace|at\s+\w+\s*\(|node_modules|internal\/|\.ts:|\.js:|sequelize|prisma|postgres|mysql|mongo/i.test(text);
    if (leaky) {
      finding("error-leak", "high", `"${label}" error response contains stack trace or internal paths.`);
    } else if (text.length > 2000) {
      finding("error-leak", "medium", `"${label}" error response is unusually long (${text.length} chars). May contain excess detail.`);
    } else {
      finding("error-leak", "info", `"${label}": clean error response (${res.status}, ${text.length} chars).`);
    }
  }
}

// ─── Probe 8: Rate limiting ────────────────────────────────────────
// Hammer a read endpoint to see if there's rate limiting.

async function probeRateLimit() {
  console.log("\n8. Rate limiting — 50 rapid-fire requests to /v1/accounts");

  const results = await Promise.all(
    Array.from({ length: 50 }, () => raw("GET", "/v1/accounts?limit=1")),
  );

  const statuses = new Map<number, number>();
  for (const r of results) {
    statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
  }

  console.log(`  Status breakdown: ${[...statuses.entries()].map(([s, c]) => `${s}×${c}`).join(", ")}`);

  const rateLimited = results.some(r => r.status === 429);
  const hasRateLimitHeaders = results.some(r =>
    r.headers.has("x-ratelimit-limit") || r.headers.has("ratelimit-limit") || r.headers.has("retry-after"),
  );

  if (!rateLimited && !hasRateLimitHeaders) {
    finding("rate-limit", "medium", "50 concurrent requests all succeeded with no rate limit headers. API may be vulnerable to abuse.");
  } else if (rateLimited) {
    finding("rate-limit", "info", "Rate limiting is active (got 429).");
  } else {
    finding("rate-limit", "low", "Rate limit headers present but no 429 at 50 concurrent. Threshold may be higher.");
  }
}

// ─── Run all probes ────────────────────────────────────────────────

async function main() {
  console.log("Augustus Sandbox Security Probes");
  console.log(`Target: ${BASE}`);
  console.log(`Token: ${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}`);

  await probeRaceCondition();
  await probeBOLA();
  await probeAmountManipulation();
  await probeIdempotencyAbuse();
  await probeReferenceInjection();
  await probeCurrencyMismatch();
  await probeErrorLeakage();
  await probeRateLimit();

  // Summary
  console.log("\n═══════════════════════════════════════════════");
  console.log("Summary");
  console.log("═══════════════════════════════════════════════");

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  console.log(`  Critical: ${bySeverity.critical}`);
  console.log(`  High:     ${bySeverity.high}`);
  console.log(`  Medium:   ${bySeverity.medium}`);
  console.log(`  Low:      ${bySeverity.low}`);
  console.log(`  Info:     ${bySeverity.info}`);

  if (bySeverity.critical || bySeverity.high) {
    console.log("\nFindings that matter:");
    for (const f of findings) {
      if (f.severity === "critical" || f.severity === "high") {
        console.log(`  [${f.severity}] ${f.probe}: ${f.detail}`);
      }
    }
  }
}

main().catch(console.error);
