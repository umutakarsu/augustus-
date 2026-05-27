import Anthropic from "@anthropic-ai/sdk";
import { BankingClient, PaymentsClient } from "./augustus-client.js";
import { tools } from "./tools.js";
import { handleToolCall } from "./tool-handler.js";

const SYSTEM_PROMPT = `You manage treasury operations on the Augustus platform. You have tools for the full payment lifecycle — not just individual API calls.

Your tools are organized as workflows:

SENDING MONEY (two-phase):
- prepare_payout: Pre-flight checks — VOP verification + balance check. Does NOT send money. Returns a preparation_id.
- confirm_payout: Actually sends the payout. Requires the preparation_id from prepare_payout.
- check_payout_status: Tracks settlement. Warns if a payout is stuck.
- retry_failed_payout: Re-sends a failed payout with a fresh idempotency key.

IMPORTANT: Always use the two-phase flow. Call prepare_payout first, show the user the VOP result and balance check, and only call confirm_payout after they explicitly confirm. Never skip the confirmation step.

TREASURY OVERVIEW:
- treasury_report: One-shot view of all accounts, balances, payouts, and anomalies.

CURRENCY CONVERSION:
- fx_quote: Get indicative rate. Always mention rates aren't guaranteed.
- execute_conversion: Converts and checks for slippage against the quoted rate.

ACCEPTING PAYMENTS:
- create_payment_link: Creates a checkout session with sensible defaults. Always show the redirect URL.
- check_payment_status: Checks if a payment has settled.

RECONCILIATION:
- reconcile_deposits: Cross-references deposits against expected payments. Uses fuzzy matching for references and amounts.

REFUNDS:
- refund_payment: Full or partial refunds by order ID.

LOOKUP:
- find_banks: Bank availability by country.
- list_accounts / list_transactions: Direct data access.

Rules:
- For payouts: ALWAYS prepare first, show results, wait for user confirmation, then confirm. This is non-negotiable.
- For conversions: summarize what you're about to do and get confirmation before calling the tool.
- For VOP no_match results: explain the risk clearly but let the user decide whether to proceed.
- For treasury reports: highlight anomalies first, then show the details.
- For slippage warnings: explain what happened and whether the conversion still went through.
- Don't add filler. Be direct.`;

const MAX_HISTORY = 40;

export type Emit = (type: "text" | "tool_start" | "tool_done" | "tool_error" | "done", data: string) => void;

const cliEmit: Emit = (type, data) => {
  switch (type) {
    case "text": process.stdout.write(data); break;
    case "tool_start": process.stdout.write(`  ⚡ ${data}...`); break;
    case "tool_done": process.stdout.write(" done\n"); break;
    case "tool_error": process.stdout.write(" error\n"); break;
    case "done": process.stdout.write("\n"); break;
  }
};

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

  async chat(message: string, emit: Emit = cliEmit): Promise<string> {
    this.history.push({ role: "user", content: message });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(this.history.length - MAX_HISTORY);
      if (this.history[0]?.role === "assistant") this.history.shift();
    }

    let res = await this.streamResponse(emit);

    while (res.stop_reason === "tool_use") {
      this.history.push({ role: "assistant", content: res.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;

        const label = block.name.replace(/_/g, " ");
        emit("tool_start", label);
        let output: string;
        try {
          output = await handleToolCall(this.clients, block.name, block.input as Record<string, unknown>);
          emit("tool_done", label);
        } catch (err) {
          output = JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" });
          emit("tool_error", label);
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: output });
      }

      this.history.push({ role: "user", content: results });
      res = await this.streamResponse(emit);
    }

    this.history.push({ role: "assistant", content: res.content });
    emit("done", "");

    return res.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n");
  }

  private async streamResponse(emit: Emit): Promise<Anthropic.Message> {
    const stream = this.anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: this.history,
    });

    stream.on("text", (text) => emit("text", text));

    return stream.finalMessage();
  }
}
