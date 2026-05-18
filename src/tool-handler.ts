import type { AugustusClient } from "./augustus-client.js";

export async function handleToolCall(
  client: AugustusClient,
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case "list_accounts": {
      const result = await client.listAccounts({
        status: input.status as "pending" | "active" | "frozen" | undefined,
        limit: input.limit as number | undefined,
      });
      return JSON.stringify(result, null, 2);
    }

    case "get_account_balance": {
      const result = await client.getAccountBalance(
        input.account_id as string,
      );
      return JSON.stringify(result, null, 2);
    }

    case "list_transactions": {
      const result = await client.listTransactions({
        account_id: input.account_id as string | undefined,
        limit: input.limit as number | undefined,
      });
      return JSON.stringify(result, null, 2);
    }

    case "create_payout": {
      const destination = buildDestination(input);
      const result = await client.createPayout({
        source_account_id: input.source_account_id as string,
        amount: input.amount as string,
        currency: input.currency as string,
        destination,
        reference: input.reference as string,
      });
      return JSON.stringify(result, null, 2);
    }

    case "list_payouts": {
      const result = await client.listPayouts({
        limit: input.limit as number | undefined,
      });
      return JSON.stringify(result, null, 2);
    }

    case "get_payout_status": {
      const result = await client.getPayout(input.payout_id as string);
      return JSON.stringify(result, null, 2);
    }

    case "get_exchange_rate": {
      const result = await client.getQuote({
        source_currency: input.source_currency as string,
        target_currency: input.target_currency as string,
        source_amount: input.source_amount as string | undefined,
      });
      return JSON.stringify(result, null, 2);
    }

    case "convert_currency": {
      const result = await client.createConversion({
        source_account_id: input.source_account_id as string,
        target_account_id: input.target_account_id as string,
        source_amount: input.source_amount as string,
      });
      return JSON.stringify(result, null, 2);
    }

    case "search_customers": {
      const result = await client.searchCustomers({
        query: input.query as string | undefined,
        limit: input.limit as number | undefined,
      });
      return JSON.stringify(result, null, 2);
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

function buildDestination(input: Record<string, unknown>) {
  const type = input.destination_type as string;
  if (type === "iban") {
    return {
      type: "iban" as const,
      iban: input.iban as string,
      account_holder_name: input.account_holder_name as string,
    };
  }
  if (type === "sort_code") {
    return {
      type: "sort_code" as const,
      sort_code: input.sort_code as string,
      account_number: input.account_number as string,
      account_holder_name: input.account_holder_name as string,
    };
  }
  return {
    type: "crypto" as const,
    address: input.wallet_address as string,
    blockchain: input.blockchain as string,
  };
}
