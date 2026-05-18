import { randomUUID } from "node:crypto";

const BANKING_SANDBOX = "https://api.sandbox.augustus.com";
const BANKING_PRODUCTION = "https://api.augustus.com";
const PAYMENTS_SANDBOX = "https://api.sand.getivy.de";
const PAYMENTS_PRODUCTION = "https://api.getivy.de";

// --- Banking API Client (new Augustus v1 REST API) ---

export class BankingClient {
  private baseUrl: string;
  private token: string;

  constructor(token: string, sandbox = true) {
    this.token = token;
    this.baseUrl = sandbox ? BANKING_SANDBOX : BANKING_PRODUCTION;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    if (body) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Banking API ${method} ${path} → ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `?${s}` : "";
  }

  // Accounts
  async listAccounts(params?: { limit?: number; status?: string }) {
    const q = this.buildQuery({ limit: params?.limit, status: params?.status });
    return this.request<PaginatedResponse<Account>>("GET", `/v1/accounts${q}`);
  }

  async getAccountBalance(accountId: string) {
    return this.request<AccountBalance>("GET", `/v1/accounts/${accountId}/balance`);
  }

  async createAccount(params: {
    account_program_id: string;
    account_type: string;
    beneficiary_data: BeneficiaryData;
  }) {
    return this.request<Account>("POST", "/v1/accounts", params, randomUUID());
  }

  async freezeAccount(accountId: string) {
    return this.request<Account>("POST", `/v1/accounts/${accountId}/freeze`, {}, randomUUID());
  }

  async unfreezeAccount(accountId: string) {
    return this.request<Account>("POST", `/v1/accounts/${accountId}/unfreeze`, {}, randomUUID());
  }

  async closeAccount(accountId: string) {
    return this.request<Account>("POST", `/v1/accounts/${accountId}/close`, {}, randomUUID());
  }

  // Account Programs
  async listAccountPrograms(params?: { limit?: number }) {
    const q = this.buildQuery({ limit: params?.limit });
    return this.request<PaginatedResponse<AccountProgram>>("GET", `/v1/account_programs${q}`);
  }

  // Transactions
  async listTransactions(params?: { limit?: number; account_id?: string }) {
    const q = this.buildQuery({ limit: params?.limit, account_id: params?.account_id });
    return this.request<PaginatedResponse<Transaction>>("GET", `/v1/transactions${q}`);
  }

  // Payouts
  async createPayout(params: {
    source_account_id: string;
    amount: string;
    currency: string;
    destination: PayoutDestination;
    reference: string;
  }) {
    return this.request<Payout>("POST", "/v1/payouts", params, randomUUID());
  }

  async listPayouts(params?: { limit?: number }) {
    const q = this.buildQuery({ limit: params?.limit });
    return this.request<PaginatedResponse<Payout>>("GET", `/v1/payouts${q}`);
  }

  async getPayout(payoutId: string) {
    return this.request<Payout>("GET", `/v1/payouts/${payoutId}`);
  }

  // Conversions
  async createConversion(params: {
    source_account_id: string;
    target_account_id: string;
    source_amount: string;
  }) {
    return this.request<Conversion>("POST", "/v1/conversions", params, randomUUID());
  }

  async listConversions(params?: { limit?: number }) {
    const q = this.buildQuery({ limit: params?.limit });
    return this.request<PaginatedResponse<Conversion>>("GET", `/v1/conversions${q}`);
  }

  // Deposits
  async listDeposits(params?: { limit?: number; status?: string }) {
    const q = this.buildQuery({ limit: params?.limit, status: params?.status });
    return this.request<PaginatedResponse<Deposit>>("GET", `/v1/deposits${q}`);
  }

  async getDeposit(depositId: string) {
    return this.request<Deposit>("GET", `/v1/deposits/${depositId}`);
  }

  // Returns
  async createReturn(params: { deposit_id: string; rail?: string }) {
    return this.request<Return>("POST", "/v1/returns", params, randomUUID());
  }

  async listReturns(params?: { limit?: number }) {
    const q = this.buildQuery({ limit: params?.limit });
    return this.request<PaginatedResponse<Return>>("GET", `/v1/returns${q}`);
  }

  // Quotes
  async getQuote(params: {
    source_currency: string;
    target_currency: string;
    source_amount?: string;
  }) {
    const q = this.buildQuery(params);
    return this.request<Quote>("GET", `/v1/quotes/indicative${q}`);
  }

  // Customers
  async searchCustomers(params?: { query?: string; limit?: number }) {
    const q = this.buildQuery({ query: params?.query, limit: params?.limit });
    return this.request<PaginatedResponse<Customer>>("GET", `/v1/customers${q}`);
  }

  // Webhook Subscriptions
  async createWebhookSubscription(params: { url: string; events: string[] }) {
    return this.request<WebhookSubscription>("POST", "/v1/webhook_subscriptions", params, randomUUID());
  }

  async listWebhookSubscriptions() {
    return this.request<PaginatedResponse<WebhookSubscription>>("GET", "/v1/webhook_subscriptions");
  }

  async deleteWebhookSubscription(id: string) {
    return this.request<void>("DELETE", `/v1/webhook_subscriptions/${id}`);
  }
}

// --- Payments API Client (legacy Ivy API) ---

export class PaymentsClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, sandbox = true) {
    this.apiKey = apiKey;
    this.baseUrl = sandbox ? PAYMENTS_SANDBOX : PAYMENTS_PRODUCTION;
  }

  private async request<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      "X-Ivy-Api-Key": this.apiKey,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Payments API ${path} → ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // Checkout Sessions
  async createCheckoutSession(params: {
    price: { total: number; currency: string };
    referenceId: string;
    successCallbackUrl: string;
    errorCallbackUrl: string;
    paymentSchemeSelection?: string;
    market?: string;
    customer?: { email?: string };
    metadata?: Record<string, string>;
  }) {
    return this.request<CheckoutSession>(
      "/api/service/checkout/session/create",
      params,
      randomUUID(),
    );
  }

  async retrieveCheckoutSession(id: string) {
    return this.request<CheckoutSession>("/api/service/checkout/session/details", { id });
  }

  async expireCheckoutSession(id: string) {
    return this.request<CheckoutSession>("/api/service/checkout/session/expire", { id });
  }

  // Orders
  async createOrder(params: {
    amount: number;
    currency: string;
    referenceId: string;
    customer?: { email?: string };
  }) {
    return this.request<Order>("/api/service/order/create", params, randomUUID());
  }

  async retrieveOrder(id: string) {
    return this.request<Order>("/api/service/order/details", { id });
  }

  async expireOrder(id: string) {
    return this.request<Order>("/api/service/order/expire", { id });
  }

  // Refunds
  async createRefund(params: {
    orderId?: string;
    referenceId?: string;
    amount: number;
  }) {
    return this.request<Refund>("/api/service/refund/create", params, randomUUID());
  }

  async retrieveRefund(id: string) {
    return this.request<Refund>("/api/service/refund/retrieve", { id });
  }

  // FX
  async getExchangeRate(params: {
    sourceCurrency: string;
    targetCurrency: string;
    sourceAmount?: string;
  }) {
    return this.request<FxRate>("/api/service/fx/retrieve-rate", params);
  }

  async executeFx(params: {
    sourceAccountId: string;
    targetAccountId: string;
    sourceAmount: string;
  }) {
    return this.request<FxExecution>("/api/service/fx/execute", params, randomUUID());
  }

  // Bank Search
  async searchBanks(params?: { search?: string; market?: string; currency?: string }) {
    return this.request<BankSearchResponse>("/api/service/banks/search", params ?? {});
  }

  // Verification of Payee
  async verifyPayee(params: {
    payee: {
      type: "iban";
      iban: { accountHolderName: string; iban: string; bic?: string };
    };
  }) {
    return this.request<VopResult>("/api/service/payee/verify", params);
  }

  // Capabilities
  async getCapabilities(market: string) {
    return this.request<CapabilitiesResponse>("/api/service/merchant/capabilities/details", { market });
  }
}

// --- Banking API Types ---

export interface PaginatedResponse<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

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

interface BeneficiaryData {
  legal_name: string;
  date_of_birth: string;
  country_of_citizenship: string;
  residential_address: {
    street_line_1: string;
    city: string;
    postal_code: string;
    country: string;
  };
  identification: { type: string; value: string };
}

interface AccountProgram {
  id: string;
  type: string;
  label: string;
  account_program_type: string;
  status: string;
  created_at: string;
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

export type PayoutDestination =
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

interface Deposit {
  id: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  source: unknown;
  destination_account_id: string;
  bank_statement_reference: string;
  rail: string;
  tx_hash?: string;
  returns: string[];
  created_at: string;
  updated_at: string;
}

interface Return {
  id: string;
  type: string;
  status: string;
  deposit_id: string;
  amount: string;
  currency: string;
  failure: { code: string; message: string; retry: boolean } | null;
  created_at: string;
  updated_at: string;
}

interface Quote {
  source_currency: string;
  target_currency: string;
  rate: string;
  source_amount?: string;
  target_amount?: string;
}

interface Customer {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

interface WebhookSubscription {
  id: string;
  type: string;
  url: string;
  events: string[];
  created_at: string;
  updated_at: string;
}

// --- Payments API Types ---

interface CheckoutSession {
  id: string;
  status: string;
  redirectUrl: string;
  referenceId: string;
  price: { total: number; currency: string };
  merchant: { legalName: string };
  market: string;
  created: number;
  expiresAt: number;
}

interface Order {
  id: string;
  status: string;
  referenceId: string;
  price: { total: number; currency: string };
  destination?: { bankStatementReference: string };
  createdAt: string;
  updatedAt: string;
}

interface Refund {
  id: string;
  amount: number;
  currency: string;
  status: string;
  orderId: string;
  transactionId: string;
}

interface FxRate {
  rate: string;
  sourceAmount?: string;
  targetAmount?: string;
}

interface FxExecution {
  id: string;
  rate: string;
  sourceAmount: string;
  targetAmount: string;
  sourceCurrency: string;
  targetCurrency: string;
  status: string;
}

interface BankSearchResponse {
  banks: Array<{
    id: string;
    name: string;
    logo: string;
    market: string;
    currencies: string[];
  }>;
  count: number;
  hasNext: boolean;
}

interface VopResult {
  status: "match" | "partial_match" | "no_match" | "not_available";
  suggestedAccountHolderName?: string;
}

interface CapabilitiesResponse {
  capabilities: string[];
}
