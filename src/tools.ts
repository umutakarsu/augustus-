import type Anthropic from "@anthropic-ai/sdk";

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Tool {
  return { name, description, input_schema: { type: "object" as const, properties, required } };
}

// ========================
// BANKING API TOOLS (Augustus v1)
// ========================

const bankingTools: Anthropic.Tool[] = [
  tool("list_accounts",
    "List all Augustus accounts (fiat and crypto). Returns IDs, currencies, types, statuses, and financial addresses.",
    {
      status: { type: "string", enum: ["pending", "active", "frozen"], description: "Filter by status" },
      limit: { type: "number", description: "Results per page (1-100)" },
    }),

  tool("get_account_balance",
    "Get the current balance of a specific account.",
    { account_id: { type: "string", description: "Account UUID" } },
    ["account_id"]),

  tool("create_account",
    "Create a new virtual account under an account program. Requires beneficiary identity data.",
    {
      account_program_id: { type: "string", description: "Account program UUID" },
      legal_name: { type: "string", description: "Full legal name" },
      date_of_birth: { type: "string", description: "YYYY-MM-DD" },
      country_of_citizenship: { type: "string", description: "ISO 3166-1 alpha-2 code" },
      street: { type: "string", description: "Street address" },
      city: { type: "string", description: "City" },
      postal_code: { type: "string", description: "Postal code" },
      country: { type: "string", description: "Address country (ISO alpha-2)" },
      id_type: { type: "string", enum: ["id", "ssn", "itin"], description: "Identification type" },
      id_value: { type: "string", description: "Identification value" },
    },
    ["account_program_id", "legal_name", "date_of_birth", "street", "city", "postal_code", "country", "id_type", "id_value"]),

  tool("freeze_account",
    "Freeze an account to block all transactions.",
    { account_id: { type: "string", description: "Account UUID to freeze" } },
    ["account_id"]),

  tool("unfreeze_account",
    "Unfreeze a previously frozen account.",
    { account_id: { type: "string", description: "Account UUID to unfreeze" } },
    ["account_id"]),

  tool("close_account",
    "Permanently close an account. This cannot be undone.",
    { account_id: { type: "string", description: "Account UUID to close" } },
    ["account_id"]),

  tool("list_account_programs",
    "List account programs (FBO programs) available to the merchant.",
    { limit: { type: "number", description: "Results per page" } }),

  tool("list_transactions",
    "List transactions. Can filter by account. Returns amount, currency, direction, balance, and reference.",
    {
      account_id: { type: "string", description: "Filter by account UUID" },
      limit: { type: "number", description: "Results per page (1-100)" },
    }),

  tool("create_payout",
    "Send money to an external bank account (IBAN/sort code) or crypto wallet. Always confirm with user first.",
    {
      source_account_id: { type: "string", description: "Account UUID to debit" },
      amount: { type: "string", description: "Decimal amount (e.g. \"100.50\")" },
      currency: { type: "string", enum: ["EUR", "GBP", "USD", "USDC"] },
      destination_type: { type: "string", enum: ["iban", "sort_code", "crypto"] },
      iban: { type: "string", description: "IBAN (for iban type)" },
      sort_code: { type: "string", description: "UK sort code" },
      account_number: { type: "string", description: "UK account number" },
      wallet_address: { type: "string", description: "Crypto wallet address" },
      blockchain: { type: "string", enum: ["ethereum", "solana", "polygon"] },
      account_holder_name: { type: "string", description: "Recipient name" },
      reference: { type: "string", description: "Payment reference (max 140 chars)" },
    },
    ["source_account_id", "amount", "currency", "destination_type", "reference"]),

  tool("list_payouts",
    "List recent payouts and their statuses.",
    { limit: { type: "number", description: "Results per page" } }),

  tool("get_payout_status",
    "Get status and details of a specific payout.",
    { payout_id: { type: "string", description: "Payout UUID" } },
    ["payout_id"]),

  tool("get_exchange_rate",
    "Get a live indicative exchange rate between two currencies.",
    {
      source_currency: { type: "string", enum: ["EUR", "GBP", "USD", "USDC"] },
      target_currency: { type: "string", enum: ["EUR", "GBP", "USD", "USDC"] },
      source_amount: { type: "string", description: "Optional amount to price" },
    },
    ["source_currency", "target_currency"]),

  tool("convert_currency",
    "Execute a currency conversion between two accounts. Always confirm with user first.",
    {
      source_account_id: { type: "string", description: "Account to debit" },
      target_account_id: { type: "string", description: "Account to credit" },
      source_amount: { type: "string", description: "Decimal amount to convert" },
    },
    ["source_account_id", "target_account_id", "source_amount"]),

  tool("list_conversions",
    "List recent currency conversions and their statuses.",
    { limit: { type: "number", description: "Results per page" } }),

  tool("list_deposits",
    "List incoming deposits received into Augustus accounts.",
    {
      status: { type: "string", enum: ["received", "in_return", "returned", "return_failed"], description: "Filter by status" },
      limit: { type: "number", description: "Results per page" },
    }),

  tool("get_deposit",
    "Get details of a specific deposit.",
    { deposit_id: { type: "string", description: "Deposit UUID" } },
    ["deposit_id"]),

  tool("create_return",
    "Return funds from a deposit back to the original sender. Always confirm with user first.",
    {
      deposit_id: { type: "string", description: "Deposit UUID to return" },
      rail: { type: "string", enum: ["sepa_instant", "sepa", "faster_payments"], description: "Payment rail" },
    },
    ["deposit_id"]),

  tool("list_returns",
    "List deposit returns and their statuses.",
    { limit: { type: "number", description: "Results per page" } }),

  tool("search_customers",
    "Search for customers by name or email.",
    {
      query: { type: "string", description: "Search term" },
      limit: { type: "number", description: "Results per page" },
    }),

  tool("create_webhook_subscription",
    "Create a webhook subscription to receive real-time event notifications.",
    {
      url: { type: "string", description: "HTTPS endpoint URL" },
      events: {
        type: "array",
        items: { type: "string" },
        description: "Event types (e.g. payout.paid, deposit.received, conversion.completed) or [\"*\"] for all",
      },
    },
    ["url", "events"]),

  tool("list_webhook_subscriptions",
    "List all active webhook subscriptions.",
    {}),

  tool("delete_webhook_subscription",
    "Delete a webhook subscription.",
    { subscription_id: { type: "string", description: "Subscription UUID" } },
    ["subscription_id"]),
];

// ========================
// PAYMENTS API TOOLS (Ivy legacy)
// ========================

const paymentsTools: Anthropic.Tool[] = [
  tool("create_checkout_session",
    "Create an Open Banking checkout session. Returns a redirect URL where the customer authorizes the payment at their bank.",
    {
      amount: { type: "number", description: "Total amount (e.g. 119.99)" },
      currency: { type: "string", enum: ["EUR", "USD", "GBP", "PLN", "SEK", "DKK"] },
      reference_id: { type: "string", description: "Your unique order reference (max 200 chars)" },
      success_url: { type: "string", description: "Redirect URL on success" },
      error_url: { type: "string", description: "Redirect URL on failure" },
      payment_scheme: { type: "string", enum: ["instant_preferred", "instant_only", "standard"], description: "Payment speed preference" },
      market: { type: "string", description: "ISO country code (e.g. DE, GB, FR)" },
      customer_email: { type: "string", description: "Customer email (enables Remember Me for 20%+ conversion)" },
    },
    ["amount", "currency", "reference_id", "success_url", "error_url"]),

  tool("get_checkout_session",
    "Retrieve details and status of a checkout session.",
    { session_id: { type: "string", description: "Checkout session ID" } },
    ["session_id"]),

  tool("expire_checkout_session",
    "Expire/cancel an open checkout session.",
    { session_id: { type: "string", description: "Checkout session ID" } },
    ["session_id"]),

  tool("create_order",
    "Create a manual bank transfer order. Generates a settlement destination for the customer to send funds to.",
    {
      amount: { type: "number", description: "Order amount" },
      currency: { type: "string", enum: ["EUR", "USD", "GBP", "PLN", "SEK", "DKK"] },
      reference_id: { type: "string", description: "Your unique reference" },
      customer_email: { type: "string", description: "Customer email" },
    },
    ["amount", "currency", "reference_id"]),

  tool("get_order",
    "Retrieve order details and payment status (waiting_for_payment, processing, paid, failed, refunded).",
    { order_id: { type: "string", description: "Order ID or your referenceId" } },
    ["order_id"]),

  tool("expire_order",
    "Expire a pending order.",
    { order_id: { type: "string", description: "Order ID" } },
    ["order_id"]),

  tool("create_refund",
    "Refund a paid order (full or partial). Provide either the order ID or your reference ID.",
    {
      order_id: { type: "string", description: "Augustus order ID" },
      reference_id: { type: "string", description: "Your original reference ID" },
      amount: { type: "number", description: "Refund amount" },
    },
    ["amount"]),

  tool("get_refund",
    "Get the status of a refund (initiated, pending, succeeded, failed).",
    { refund_id: { type: "string", description: "Refund ID" } },
    ["refund_id"]),

  tool("search_banks",
    "Search supported banks by name, country, or currency. Useful for checking bank availability before initiating payments.",
    {
      search: { type: "string", description: "Bank name search" },
      market: { type: "string", description: "ISO country code" },
      currency: { type: "string", enum: ["EUR", "USD", "GBP", "PLN", "SEK", "DKK"] },
    }),

  tool("verify_payee",
    "Verify that an account holder name matches a bank account (SEPA Verification of Payee). Reduces payment fraud.",
    {
      iban: { type: "string", description: "IBAN to verify" },
      account_holder_name: { type: "string", description: "Expected account holder name" },
      bic: { type: "string", description: "Optional BIC/SWIFT code" },
    },
    ["iban", "account_holder_name"]),

  tool("get_capabilities",
    "Check which payment capabilities (AIS, PIS) are available in a specific market.",
    { market: { type: "string", description: "ISO country code (e.g. DE, GB, FR)" } },
    ["market"]),
];

export const tools: Anthropic.Tool[] = [...bankingTools, ...paymentsTools];
