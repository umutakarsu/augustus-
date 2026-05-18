import type Anthropic from "@anthropic-ai/sdk";

export const tools: Anthropic.Tool[] = [
  {
    name: "list_accounts",
    description:
      "List all Augustus accounts (fiat and crypto). Returns account IDs, currencies, types, statuses, and financial addresses (IBAN, sort code, wallet address).",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["pending", "active", "frozen"],
          description: "Filter by account status",
        },
        limit: {
          type: "number",
          description: "Number of results (1-100, default 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_account_balance",
    description:
      "Get the current balance of a specific account. Returns available balance, currency, and timestamp.",
    input_schema: {
      type: "object" as const,
      properties: {
        account_id: {
          type: "string",
          description: "The UUID of the account",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "list_transactions",
    description:
      "List recent transactions. Can filter by account. Returns amount, currency, credit/debit side, running balance, and reference.",
    input_schema: {
      type: "object" as const,
      properties: {
        account_id: {
          type: "string",
          description: "Filter transactions to a specific account UUID",
        },
        limit: {
          type: "number",
          description: "Number of results (1-100, default 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "create_payout",
    description:
      "Send money from an Augustus account to an external bank account (IBAN or UK sort code) or crypto wallet. Requires confirmation of amount and destination.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_account_id: {
          type: "string",
          description: "UUID of the account to debit",
        },
        amount: {
          type: "string",
          description: 'Amount as a decimal string (e.g. "100.50")',
        },
        currency: {
          type: "string",
          enum: ["EUR", "GBP", "USD", "USDC"],
          description: "Payment currency",
        },
        destination_type: {
          type: "string",
          enum: ["iban", "sort_code", "crypto"],
          description: "Type of destination",
        },
        iban: { type: "string", description: "IBAN (for iban destination)" },
        sort_code: {
          type: "string",
          description: "UK sort code (for sort_code destination)",
        },
        account_number: {
          type: "string",
          description: "UK account number (for sort_code destination)",
        },
        wallet_address: {
          type: "string",
          description: "Crypto wallet address (for crypto destination)",
        },
        blockchain: {
          type: "string",
          enum: ["ethereum", "solana", "polygon"],
          description: "Blockchain network (for crypto destination)",
        },
        account_holder_name: {
          type: "string",
          description: "Recipient name (for bank destinations)",
        },
        reference: {
          type: "string",
          description: "Payment reference (max 140 chars)",
        },
      },
      required: [
        "source_account_id",
        "amount",
        "currency",
        "destination_type",
        "reference",
      ],
    },
  },
  {
    name: "list_payouts",
    description:
      "List recent payouts and their statuses (pending, paid, failed, returned).",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Number of results (1-100, default 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_payout_status",
    description: "Get the current status and details of a specific payout.",
    input_schema: {
      type: "object" as const,
      properties: {
        payout_id: {
          type: "string",
          description: "The UUID of the payout",
        },
      },
      required: ["payout_id"],
    },
  },
  {
    name: "get_exchange_rate",
    description:
      "Get a live indicative exchange rate between two currencies. Supports EUR, GBP, USD, and USDC.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_currency: {
          type: "string",
          enum: ["EUR", "GBP", "USD", "USDC"],
          description: "Currency to convert from",
        },
        target_currency: {
          type: "string",
          enum: ["EUR", "GBP", "USD", "USDC"],
          description: "Currency to convert to",
        },
        source_amount: {
          type: "string",
          description:
            'Optional amount to convert (e.g. "1000") to see the target amount',
        },
      },
      required: ["source_currency", "target_currency"],
    },
  },
  {
    name: "convert_currency",
    description:
      "Execute a currency conversion between two Augustus accounts (e.g. EUR to USDC). Debits the source account and credits the target account at the current rate.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_account_id: {
          type: "string",
          description: "UUID of the account to debit",
        },
        target_account_id: {
          type: "string",
          description: "UUID of the account to credit",
        },
        source_amount: {
          type: "string",
          description: 'Amount to convert as a decimal string (e.g. "500.00")',
        },
      },
      required: ["source_account_id", "target_account_id", "source_amount"],
    },
  },
  {
    name: "search_customers",
    description: "Search for customers by name or email.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search term (name or email)",
        },
        limit: {
          type: "number",
          description: "Number of results (default 10)",
        },
      },
      required: [],
    },
  },
];
