import type Anthropic from "@anthropic-ai/sdk";

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Tool {
  return { name, description, input_schema: { type: "object" as const, properties, required } };
}

export const tools: Anthropic.Tool[] = [

  // ── Workflow: Safe Payout ──────────────────────────────────────────
  // The full lifecycle: verify recipient → check funds → send → track

  tool("verify_and_send_payout",
    "Run the safe payout workflow: (1) verify the payee name matches the IBAN via VOP, (2) check the source account has sufficient balance, (3) send the payout. Reports verification result, balance check, and payout status. If VOP returns no_match, warns but still allows the user to proceed.",
    {
      source_account_id: { type: "string", description: "Account UUID to debit" },
      amount: { type: "string", description: "Decimal amount (e.g. \"500.00\")" },
      currency: { type: "string", enum: ["EUR", "GBP", "USD", "USDC"] },
      iban: { type: "string", description: "Recipient IBAN" },
      account_holder_name: { type: "string", description: "Expected recipient name" },
      reference: { type: "string", description: "Payment reference (max 140 chars)" },
    },
    ["source_account_id", "amount", "currency", "iban", "account_holder_name", "reference"]),

  tool("check_payout_status",
    "Check whether a payout has settled, failed, or is still pending. If failed, includes the failure reason and whether it's retryable.",
    { payout_id: { type: "string", description: "Payout UUID" } },
    ["payout_id"]),

  // ── Workflow: Treasury Report ──────────────────────────────────────
  // One-shot view of the full treasury position

  tool("treasury_report",
    "Generate a treasury report: all accounts with balances, recent transactions, pending payouts, and anomaly flags. Flags include: accounts with zero balance, payouts stuck in pending for >24h, and large single transactions (>10k).",
    {}),

  // ── Workflow: FX with slippage protection ──────────────────────────

  tool("fx_quote",
    "Get a live exchange rate quote between two currencies. Returns the rate, and if an amount is provided, shows the expected output. The rate is indicative and not guaranteed for execution.",
    {
      from: { type: "string", enum: ["EUR", "GBP", "USD", "USDC"], description: "Source currency" },
      to: { type: "string", enum: ["EUR", "GBP", "USD", "USDC"], description: "Target currency" },
      amount: { type: "string", description: "Amount to convert (optional, for pricing)" },
    },
    ["from", "to"]),

  tool("execute_conversion",
    "Execute a currency conversion between two accounts. Fetches a fresh quote, executes, then compares the actual rate against the quoted rate. Warns if slippage exceeds 0.5%.",
    {
      source_account_id: { type: "string", description: "Account to debit" },
      target_account_id: { type: "string", description: "Account to credit" },
      amount: { type: "string", description: "Amount to convert from source currency" },
    },
    ["source_account_id", "target_account_id", "amount"]),

  // ── Workflow: Payment Acceptance ────────────────────────────────────

  tool("create_payment_link",
    "Create an Open Banking checkout session and return a payment link. Includes best-practice defaults: instant_preferred payment scheme, customer email for Remember Me (20%+ conversion boost).",
    {
      amount: { type: "number", description: "Total amount (e.g. 119.99)" },
      currency: { type: "string", enum: ["EUR", "USD", "GBP", "PLN", "SEK", "DKK"] },
      reference_id: { type: "string", description: "Your order reference (unique, max 200 chars)" },
      success_url: { type: "string", description: "URL to redirect after successful payment" },
      error_url: { type: "string", description: "URL to redirect on failure" },
      customer_email: { type: "string", description: "Customer email (strongly recommended — enables Remember Me)" },
      market: { type: "string", description: "ISO country code to pre-select banks (e.g. DE)" },
    },
    ["amount", "currency", "reference_id", "success_url", "error_url"]),

  tool("check_payment_status",
    "Check the status of a checkout session or order. Returns current state and whether the payment is settled.",
    {
      checkout_id: { type: "string", description: "Checkout session ID" },
      order_id: { type: "string", description: "Order ID (alternative to checkout_id)" },
    }),

  // ── Workflow: Deposit → Reconciliation ─────────────────────────────

  tool("reconcile_deposits",
    "Pull recent deposits and cross-reference them against expected payments. Lists matched deposits, unmatched deposits (received but not expected), and missing payments (expected but not received). This is the core reconciliation check.",
    {
      expected: {
        type: "array",
        items: {
          type: "object",
          properties: {
            reference: { type: "string", description: "Expected bank statement reference" },
            amount: { type: "string", description: "Expected amount" },
            currency: { type: "string", description: "Expected currency" },
          },
          required: ["reference", "amount", "currency"],
        },
        description: "List of expected payments to match against deposits",
      },
      limit: { type: "number", description: "How many recent deposits to check (default 50)" },
    },
    ["expected"]),

  // ── Refunds ────────────────────────────────────────────────────────

  tool("refund_payment",
    "Refund a payment by order ID or reference ID. Supports partial refunds. Returns the refund status and warns if the refund amount exceeds the original payment.",
    {
      order_id: { type: "string", description: "Augustus order ID" },
      reference_id: { type: "string", description: "Your original reference (alternative to order_id)" },
      amount: { type: "number", description: "Refund amount (use original amount for full refund)" },
    },
    ["amount"]),

  // ── Bank Search ────────────────────────────────────────────────────

  tool("find_banks",
    "Search for banks supported by Augustus in a given country. Useful for checking availability before sending customers to checkout.",
    {
      country: { type: "string", description: "ISO country code (e.g. DE, GB, FR, NL)" },
      search: { type: "string", description: "Bank name to search for" },
    }),

  // ── Direct access (escape hatch) ───────────────────────────────────

  tool("list_accounts",
    "List all accounts with their currencies, types, and statuses.",
    { status: { type: "string", enum: ["pending", "active", "frozen"] } }),

  tool("list_transactions",
    "List recent transactions, optionally filtered by account.",
    {
      account_id: { type: "string", description: "Filter by account" },
      limit: { type: "number", description: "Results to return (default 10)" },
    }),
];
