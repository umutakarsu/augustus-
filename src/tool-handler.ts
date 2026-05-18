import type { BankingClient, PaymentsClient, PayoutDestination } from "./augustus-client.js";

type Input = Record<string, unknown>;

export async function handleToolCall(
  banking: BankingClient,
  payments: PaymentsClient | null,
  toolName: string,
  input: Input,
): Promise<string> {
  // Banking API tools
  switch (toolName) {
    case "list_accounts":
      return json(await banking.listAccounts({
        status: input.status as string | undefined,
        limit: input.limit as number | undefined,
      }));

    case "get_account_balance":
      return json(await banking.getAccountBalance(input.account_id as string));

    case "create_account":
      return json(await banking.createAccount({
        account_program_id: input.account_program_id as string,
        account_type: "virtual_account",
        beneficiary_data: {
          legal_name: input.legal_name as string,
          date_of_birth: input.date_of_birth as string,
          country_of_citizenship: (input.country_of_citizenship as string) ?? (input.country as string),
          residential_address: {
            street_line_1: input.street as string,
            city: input.city as string,
            postal_code: input.postal_code as string,
            country: input.country as string,
          },
          identification: {
            type: input.id_type as string,
            value: input.id_value as string,
          },
        },
      }));

    case "freeze_account":
      return json(await banking.freezeAccount(input.account_id as string));

    case "unfreeze_account":
      return json(await banking.unfreezeAccount(input.account_id as string));

    case "close_account":
      return json(await banking.closeAccount(input.account_id as string));

    case "list_account_programs":
      return json(await banking.listAccountPrograms({ limit: input.limit as number | undefined }));

    case "list_transactions":
      return json(await banking.listTransactions({
        account_id: input.account_id as string | undefined,
        limit: input.limit as number | undefined,
      }));

    case "create_payout":
      return json(await banking.createPayout({
        source_account_id: input.source_account_id as string,
        amount: input.amount as string,
        currency: input.currency as string,
        destination: buildPayoutDestination(input),
        reference: input.reference as string,
      }));

    case "list_payouts":
      return json(await banking.listPayouts({ limit: input.limit as number | undefined }));

    case "get_payout_status":
      return json(await banking.getPayout(input.payout_id as string));

    case "get_exchange_rate":
      return json(await banking.getQuote({
        source_currency: input.source_currency as string,
        target_currency: input.target_currency as string,
        source_amount: input.source_amount as string | undefined,
      }));

    case "convert_currency":
      return json(await banking.createConversion({
        source_account_id: input.source_account_id as string,
        target_account_id: input.target_account_id as string,
        source_amount: input.source_amount as string,
      }));

    case "list_conversions":
      return json(await banking.listConversions({ limit: input.limit as number | undefined }));

    case "list_deposits":
      return json(await banking.listDeposits({
        status: input.status as string | undefined,
        limit: input.limit as number | undefined,
      }));

    case "get_deposit":
      return json(await banking.getDeposit(input.deposit_id as string));

    case "create_return":
      return json(await banking.createReturn({
        deposit_id: input.deposit_id as string,
        rail: input.rail as string | undefined,
      }));

    case "list_returns":
      return json(await banking.listReturns({ limit: input.limit as number | undefined }));

    case "search_customers":
      return json(await banking.searchCustomers({
        query: input.query as string | undefined,
        limit: input.limit as number | undefined,
      }));

    case "create_webhook_subscription":
      return json(await banking.createWebhookSubscription({
        url: input.url as string,
        events: input.events as string[],
      }));

    case "list_webhook_subscriptions":
      return json(await banking.listWebhookSubscriptions());

    case "delete_webhook_subscription":
      return json(await banking.deleteWebhookSubscription(input.subscription_id as string));
  }

  // Payments API tools — require payments client
  if (!payments) {
    return json({
      error: "Payments API not configured. Set AUGUSTUS_PAYMENTS_API_KEY to use checkout, orders, refunds, bank search, and VOP.",
    });
  }

  switch (toolName) {
    case "create_checkout_session":
      return json(await payments.createCheckoutSession({
        price: { total: input.amount as number, currency: input.currency as string },
        referenceId: input.reference_id as string,
        successCallbackUrl: input.success_url as string,
        errorCallbackUrl: input.error_url as string,
        paymentSchemeSelection: input.payment_scheme as string | undefined,
        market: input.market as string | undefined,
        customer: input.customer_email ? { email: input.customer_email as string } : undefined,
      }));

    case "get_checkout_session":
      return json(await payments.retrieveCheckoutSession(input.session_id as string));

    case "expire_checkout_session":
      return json(await payments.expireCheckoutSession(input.session_id as string));

    case "create_order":
      return json(await payments.createOrder({
        amount: input.amount as number,
        currency: input.currency as string,
        referenceId: input.reference_id as string,
        customer: input.customer_email ? { email: input.customer_email as string } : undefined,
      }));

    case "get_order":
      return json(await payments.retrieveOrder(input.order_id as string));

    case "expire_order":
      return json(await payments.expireOrder(input.order_id as string));

    case "create_refund":
      return json(await payments.createRefund({
        orderId: input.order_id as string | undefined,
        referenceId: input.reference_id as string | undefined,
        amount: input.amount as number,
      }));

    case "get_refund":
      return json(await payments.retrieveRefund(input.refund_id as string));

    case "search_banks":
      return json(await payments.searchBanks({
        search: input.search as string | undefined,
        market: input.market as string | undefined,
        currency: input.currency as string | undefined,
      }));

    case "verify_payee":
      return json(await payments.verifyPayee({
        payee: {
          type: "iban",
          iban: {
            accountHolderName: input.account_holder_name as string,
            iban: input.iban as string,
            bic: input.bic as string | undefined,
          },
        },
      }));

    case "get_capabilities":
      return json(await payments.getCapabilities(input.market as string));

    default:
      return json({ error: `Unknown tool: ${toolName}` });
  }
}

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function buildPayoutDestination(input: Input): PayoutDestination {
  const type = input.destination_type as string;
  if (type === "iban") {
    return { type: "iban", iban: input.iban as string, account_holder_name: input.account_holder_name as string };
  }
  if (type === "sort_code") {
    return { type: "sort_code", sort_code: input.sort_code as string, account_number: input.account_number as string, account_holder_name: input.account_holder_name as string };
  }
  if (type === "crypto") {
    return { type: "crypto", address: input.wallet_address as string, blockchain: input.blockchain as string };
  }
  throw new Error(`Unknown destination type: ${type}`);
}
