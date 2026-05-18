import Anthropic from "@anthropic-ai/sdk";
import { BankingClient, PaymentsClient } from "./augustus-client.js";
import { tools } from "./tools.js";
import { handleToolCall } from "./tool-handler.js";

const SYSTEM_PROMPT = `You manage treasury operations on the Augustus platform. You have tools for the full payment lifecycle — not just individual API calls.

Your tools are organized as workflows:

SENDING MONEY:
- verify_and_send_payout: Checks VOP, verifies balance, then sends. Use this instead of raw payout calls.
- check_payout_status: Tracks settlement. Warns if a payout is stuck.

TREASURY OVERVIEW:
- treasury_report: One-shot view of all accounts, balances, payouts, and anomalies.

CURRENCY CONVERSION:
- fx_quote: Get indicative rate. Always mention rates aren't guaranteed.
- execute_conversion: Converts and checks for slippage against the quoted rate.

ACCEPTING PAYMENTS:
- create_payment_link: Creates a checkout session with sensible defaults. Always show the redirect URL.
- check_payment_status: Checks if a payment has settled.

RECONCILIATION:
- reconcile_deposits: Cross-references deposits against expected payments. Flags mismatches.

REFUNDS:
- refund_payment: Full or partial refunds by order ID.

LOOKUP:
- find_banks: Bank availability by country.
- list_accounts / list_transactions: Direct data access.

Rules:
- For payouts and conversions: summarize what you're about to do and get confirmation before calling the tool.
- For VOP no_match results: explain the risk clearly but let the user decide.
- For treasury reports: highlight anomalies first, then show the details.
- For slippage warnings: explain what happened and whether the conversion still went through.
- Don't add filler. Be direct.`;

const MAX_HISTORY = 40;

export class TreasuryAgent {
  private anthropic: Anthropic;
  private clients: { banking: BankingClient; payments: PaymentsClient | null };
  private history: Anthropic.MessageParam[] = [];

  constructor(bankingToken: string, paymentsKey: string | null, sandbox: boolean) {
    this.anthropic = new Anthropic();
    this.clients = {
      banking: new BankingClient(bankingToken, sandbox),
      payments: paymentsKey ? new PaymentsClient(paymentsKey, sandbox) : null,
    };
  }

  async chat(message: string): Promise<string> {
    this.history.push({ role: "user", content: message });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(this.history.length - MAX_HISTORY);
      if (this.history[0]?.role === "assistant") this.history.shift();
    }

    let res = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: this.history,
    });

    while (res.stop_reason === "tool_use") {
      this.history.push({ role: "assistant", content: res.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;

        process.stdout.write(`  ⚡ ${block.name.replace(/_/g, " ")}...`);
        let output: string;
        try {
          output = await handleToolCall(this.clients, block.name, block.input as Record<string, unknown>);
          process.stdout.write(" done\n");
        } catch (err) {
          output = JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" });
          process.stdout.write(" error\n");
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: output });
      }

      this.history.push({ role: "user", content: results });
      res = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages: this.history,
      });
    }

    const reply = res.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n");

    this.history.push({ role: "assistant", content: res.content });
    return reply;
  }
}
