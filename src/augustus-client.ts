import { randomUUID } from "node:crypto";

const BANKING_SANDBOX = "https://api.sandbox.augustus.com";
const BANKING_PROD = "https://api.augustus.com";
const PAYMENTS_SANDBOX = "https://api.sand.getivy.de";
const PAYMENTS_PROD = "https://api.getivy.de";

async function call<T>(
  base: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<T> {
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return {} as T;
}

export class BankingClient {
  private base: string;
  private token: string;

  constructor(token: string, sandbox: boolean) {
    this.token = token;
    this.base = sandbox ? BANKING_SANDBOX : BANKING_PROD;
  }

  private headers(idempotent = false): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (idempotent) h["Idempotency-Key"] = randomUUID();
    return h;
  }

  private qs(params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined);
    if (!entries.length) return "";
    return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)] as [string, string])).toString();
  }

  // Accounts
  listAccounts(opts?: { limit?: number; status?: string }) {
    return call<Paginated<Account>>(this.base, "GET", `/v1/accounts${this.qs({ ...opts })}`, this.headers());
  }

  getBalance(id: string) {
    return call<Balance>(this.base, "GET", `/v1/accounts/${id}/balance`, this.headers());
  }

  freezeAccount(id: string) {
    return call<Account>(this.base, "POST", `/v1/accounts/${id}/freeze`, this.headers(true), {});
  }

  unfreezeAccount(id: string) {
    return call<Account>(this.base, "POST", `/v1/accounts/${id}/unfreeze`, this.headers(true), {});
  }

  // Transactions
  listTransactions(opts?: { account_id?: string; limit?: number }) {
    return call<Paginated<Transaction>>(this.base, "GET", `/v1/transactions${this.qs({ ...opts })}`, this.headers());
  }

  // Payouts
  createPayout(params: {
    source_account_id: string;
    amount: string;
    currency: string;
    destination: PayoutDestination;
    reference: string;
  }) {
    return call<Payout>(this.base, "POST", "/v1/payouts", this.headers(true), params);
  }

  getPayout(id: string) {
    return call<Payout>(this.base, "GET", `/v1/payouts/${id}`, this.headers());
  }

  listPayouts(opts?: { limit?: number }) {
    return call<Paginated<Payout>>(this.base, "GET", `/v1/payouts${this.qs({ ...opts })}`, this.headers());
  }

  // FX
  getQuote(params: { source_currency: string; target_currency: string; source_amount?: string }) {
    return call<Quote>(this.base, "GET", `/v1/quotes/indicative${this.qs(params)}`, this.headers());
  }

  createConversion(params: { source_account_id: string; target_account_id: string; source_amount: string }) {
    return call<Conversion>(this.base, "POST", "/v1/conversions", this.headers(true), params);
  }

  getConversion(id: string) {
    return call<Conversion>(this.base, "GET", `/v1/conversions/${id}`, this.headers());
  }

  // Deposits
  listDeposits(opts?: { limit?: number; status?: string }) {
    return call<Paginated<Deposit>>(this.base, "GET", `/v1/deposits${this.qs({ ...opts })}`, this.headers());
  }

  getDeposit(id: string) {
    return call<Deposit>(this.base, "GET", `/v1/deposits/${id}`, this.headers());
  }

  // Returns
  createReturn(params: { deposit_id: string; rail?: string }) {
    return call<Return>(this.base, "POST", "/v1/returns", this.headers(true), params);
  }
}

export class PaymentsClient {
  private base: string;
  private key: string;

  constructor(key: string, sandbox: boolean) {
    this.key = key;
    this.base = sandbox ? PAYMENTS_SANDBOX : PAYMENTS_PROD;
  }

  private headers(idempotent = false): Record<string, string> {
    const h: Record<string, string> = { "X-Ivy-Api-Key": this.key };
    if (idempotent) h["Idempotency-Key"] = randomUUID();
    return h;
  }

  private post<T>(path: string, body: unknown, idempotent = false) {
    return call<T>(this.base, "POST", path, this.headers(idempotent), body);
  }

  // Checkout
  createCheckout(params: {
    price: { total: number; currency: string };
    referenceId: string;
    successCallbackUrl: string;
    errorCallbackUrl: string;
    paymentSchemeSelection?: string;
    market?: string;
    customer?: { email: string };
  }) {
    return this.post<CheckoutSession>("/api/service/checkout/session/create", params, true);
  }

  getCheckout(id: string) {
    return this.post<CheckoutSession>("/api/service/checkout/session/details", { id });
  }

  // Orders
  getOrder(id: string) {
    return this.post<Order>("/api/service/order/details", { id });
  }

  // Refunds
  createRefund(params: { orderId?: string; referenceId?: string; amount: number }) {
    return this.post<Refund>("/api/service/refund/create", params, true);
  }

  // VOP
  verifyPayee(iban: string, name: string, bic?: string) {
    return this.post<VopResult>("/api/service/payee/verify", {
      payee: { type: "iban", iban: { accountHolderName: name, iban, bic } },
    });
  }

  // Banks
  searchBanks(params?: { search?: string; market?: string; currency?: string }) {
    return this.post<BankSearchResult>("/api/service/banks/search", params ?? {});
  }
}

// Types — only what we actually use

export interface Paginated<T> { data: T[]; has_more: boolean; next_cursor: string | null }

export interface Account {
  id: string;
  currency: string;
  account_type: string;
  status: string;
  asset_type: string;
  label: string;
  financial_addresses: Array<{
    type: string;
    iban?: string;
    sort_code?: string;
    account_number?: string;
    address?: string;
    blockchain?: string;
  }>;
  created_at: string;
}

export interface Balance { account_id: string; amount: string; currency: string; as_of: string }

export interface Transaction {
  id: string;
  amount: string;
  currency: string;
  side: "credit" | "debit";
  balance: string;
  reference: string;
  created_at: string;
}

export type PayoutDestination =
  | { type: "iban"; iban: string; account_holder_name: string }
  | { type: "sort_code"; sort_code: string; account_number: string; account_holder_name: string }
  | { type: "crypto"; address: string; blockchain: string };

export interface Payout {
  id: string;
  status: string;
  source_account_id: string;
  amount: string;
  currency: string;
  destination: PayoutDestination;
  reference: string;
  failure: { code: string; message: string } | null;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  rate: string;
  source_currency: string;
  target_currency: string;
  source_amount?: string;
  target_amount?: string;
}

export interface Conversion {
  id: string;
  status: string;
  source_amount: string;
  source_currency: string;
  target_amount: string;
  target_currency: string;
  created_at: string;
  completed_at: string | null;
}

export interface Deposit {
  id: string;
  status: string;
  amount: string;
  currency: string;
  source: unknown;
  destination_account_id: string;
  bank_statement_reference: string;
  rail: string;
  returns: string[];
  created_at: string;
}

export interface Return {
  id: string;
  status: string;
  deposit_id: string;
  amount: string;
  currency: string;
  failure: { code: string; message: string; retry: boolean } | null;
  created_at: string;
}

export interface CheckoutSession {
  id: string;
  status: string;
  redirectUrl: string;
  referenceId: string;
  price: { total: number; currency: string };
  created: number;
  expiresAt: number;
}

export interface Order {
  id: string;
  status: string;
  referenceId: string;
  price: { total: number; currency: string };
  createdAt: string;
}

export interface Refund {
  id: string;
  amount: number;
  currency: string;
  status: string;
  orderId: string;
}

export interface VopResult {
  status: "match" | "partial_match" | "no_match" | "not_available";
  suggestedAccountHolderName?: string;
}

export interface BankSearchResult {
  banks: Array<{ id: string; name: string; logo: string; market: string; currencies: string[] }>;
  count: number;
}
