const SANDBOX_BASE = "https://api.sandbox.augustus.com";
const PRODUCTION_BASE = "https://api.augustus.com";

export class AugustusClient {
  private baseUrl: string;
  private token: string;

  constructor(token: string, sandbox = true) {
    this.token = token;
    this.baseUrl = sandbox ? SANDBOX_BASE : PRODUCTION_BASE;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Augustus API ${method} ${path} returned ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // --- Accounts ---

  async listAccounts(params?: {
    limit?: number;
    cursor?: string;
    status?: "pending" | "active" | "frozen";
  }) {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.cursor) qs.set("cursor", params.cursor);
    if (params?.status) qs.set("status", params.status);
    const query = qs.toString();
    return this.request<AccountListResponse>("GET", `/v1/accounts${query ? `?${query}` : ""}`);
  }

  async getAccountBalance(accountId: string) {
    return this.request<AccountBalance>("GET", `/v1/accounts/${accountId}/balance`);
  }

  // --- Transactions ---

  async listTransactions(params?: {
    limit?: number;
    cursor?: string;
    account_id?: string;
  }) {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.cursor) qs.set("cursor", params.cursor);
    if (params?.account_id) qs.set("account_id", params.account_id);
    const query = qs.toString();
    return this.request<TransactionListResponse>("GET", `/v1/transactions${query ? `?${query}` : ""}`);
  }

  // --- Payouts ---

  async createPayout(params: {
    source_account_id: string;
    amount: string;
    currency: string;
    destination: PayoutDestination;
    reference: string;
    metadata?: Record<string, string>;
  }) {
    return this.request<Payout>("POST", "/v1/payouts", params);
  }

  async listPayouts(params?: { limit?: number; cursor?: string }) {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.cursor) qs.set("cursor", params.cursor);
    const query = qs.toString();
    return this.request<PayoutListResponse>("GET", `/v1/payouts${query ? `?${query}` : ""}`);
  }

  async getPayout(payoutId: string) {
    return this.request<Payout>("GET", `/v1/payouts/${payoutId}`);
  }

  // --- Conversions (FX) ---

  async createConversion(params: {
    source_account_id: string;
    target_account_id: string;
    source_amount: string;
    metadata?: Record<string, string>;
  }) {
    return this.request<Conversion>("POST", "/v1/conversions", params);
  }

  async listConversions(params?: { limit?: number; cursor?: string }) {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.cursor) qs.set("cursor", params.cursor);
    const query = qs.toString();
    return this.request<ConversionListResponse>("GET", `/v1/conversions${query ? `?${query}` : ""}`);
  }

  // --- Customers ---

  async searchCustomers(params?: { query?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.query) qs.set("query", params.query);
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return this.request<CustomerListResponse>("GET", `/v1/customers${query ? `?${query}` : ""}`);
  }

  // --- Quotes ---

  async getQuote(params: {
    source_currency: string;
    target_currency: string;
    source_amount?: string;
  }) {
    const qs = new URLSearchParams();
    qs.set("source_currency", params.source_currency);
    qs.set("target_currency", params.target_currency);
    if (params.source_amount) qs.set("source_amount", params.source_amount);
    return this.request<Quote>("GET", `/v1/quotes/indicative?${qs.toString()}`);
  }
}

// --- Types ---

export interface Account {
  id: string;
  type: string;
  currency: string;
  account_type: string;
  status: string;
  asset_type: string;
  label: string;
  financial_addresses: FinancialAddress[];
  created_at: string;
  updated_at: string;
}

interface FinancialAddress {
  type: string;
  iban?: string;
  bic?: string;
  sort_code?: string;
  account_number?: string;
  address?: string;
  blockchain?: string;
}

export interface AccountBalance {
  type: string;
  account_id: string;
  amount: string;
  currency: string;
  as_of: string;
}

interface AccountListResponse {
  data: Account[];
  has_more: boolean;
  next_cursor: string | null;
}

interface Transaction {
  id: string;
  amount: string;
  currency: string;
  side: "credit" | "debit";
  balance: string;
  reference: string;
  created_at: string;
}

interface TransactionListResponse {
  data: Transaction[];
  has_more: boolean;
  next_cursor: string | null;
}

type PayoutDestination =
  | { type: "iban"; iban: string; account_holder_name: string; bic?: string }
  | { type: "sort_code"; sort_code: string; account_number: string; account_holder_name: string }
  | { type: "crypto"; address: string; blockchain: string };

export interface Payout {
  id: string;
  status: string;
  amount: string;
  currency: string;
  destination: PayoutDestination;
  reference: string;
  failure: { code: string; message: string } | null;
  metadata: Record<string, string>;
  created_at: string;
  updated_at: string;
}

interface PayoutListResponse {
  data: Payout[];
  has_more: boolean;
  next_cursor: string | null;
}

interface Conversion {
  id: string;
  status: string;
  source_amount: string;
  source_currency: string;
  target_amount: string;
  target_currency: string;
  source_account_id: string;
  target_account_id: string;
  created_at: string;
  completed_at: string | null;
}

interface ConversionListResponse {
  data: Conversion[];
  has_more: boolean;
  next_cursor: string | null;
}

interface Customer {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

interface CustomerListResponse {
  data: Customer[];
  has_more: boolean;
  next_cursor: string | null;
}

interface Quote {
  source_currency: string;
  target_currency: string;
  rate: string;
  source_amount?: string;
  target_amount?: string;
}
