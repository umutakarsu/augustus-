import Anthropic from "@anthropic-ai/sdk";
import { BankingClient, PaymentsClient } from "./augustus-client.js";
import { tools } from "./tools.js";
import { handleToolCall } from "./tool-handler.js";

const SYSTEM_PROMPT = `You are Augustus Treasury, an AI assistant for the Augustus platform — the clearing bank for the AI era.

You have access to BOTH of Augustus's APIs:

**Banking API** (accounts, treasury, FX):
- View and manage accounts (fiat: EUR, GBP, USD / crypto: USDC)
- Create virtual accounts under account programs
- Freeze, unfreeze, and close accounts
- List and filter transactions
- Send payouts to IBAN, UK sort code, or crypto wallets
- Get live FX rates and execute currency conversions
- Monitor incoming deposits and process returns
- Manage webhook subscriptions

**Payments API** (checkout, orders, refunds):
- Create Open Banking checkout sessions with redirect URLs
- Create manual bank transfer orders
- Track order lifecycle (waiting_for_payment → processing → paid)
- Issue full or partial refunds
- Search supported banks by country and currency
- Verify payee identity (VOP) before sending payments
- Check market capabilities (AIS/PIS)

Guidelines:
- Always confirm before executing writes (payouts, conversions, returns, refunds, account changes)
- Format monetary amounts with currency symbols
- For checkout sessions, always show the redirect URL prominently
- When verifying payees, explain what match/partial_match/no_match means
- If an API call fails, explain the error and suggest what to try next
- Be concise but thorough — this is a payments tool, accuracy matters`;

const MAX_HISTORY_MESSAGES = 40;

export class TreasuryAgent {
  private anthropic: Anthropic;
  private banking: BankingClient;
  private payments: PaymentsClient | null;
  private conversationHistory: Anthropic.MessageParam[] = [];

  constructor(bankingToken: string, paymentsKey: string | null, sandbox = true) {
    this.anthropic = new Anthropic();
    this.banking = new BankingClient(bankingToken, sandbox);
    this.payments = paymentsKey ? new PaymentsClient(paymentsKey, sandbox) : null;
  }

  private trimHistory() {
    if (this.conversationHistory.length <= MAX_HISTORY_MESSAGES) return;
    const excess = this.conversationHistory.length - MAX_HISTORY_MESSAGES;
    this.conversationHistory = this.conversationHistory.slice(excess);
    if (this.conversationHistory[0]?.role === "assistant") {
      this.conversationHistory.shift();
    }
  }

  async chat(userMessage: string): Promise<string> {
    this.conversationHistory.push({ role: "user", content: userMessage });
    this.trimHistory();

    let response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: this.conversationHistory,
    });

    while (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

      this.conversationHistory.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        if (block.type !== "tool_use") continue;

        process.stdout.write(`  ⚡ ${block.name.replace(/_/g, " ")}...`);

        let result: string;
        try {
          result = await handleToolCall(this.banking, this.payments, block.name, block.input as Record<string, unknown>);
          process.stdout.write(" done\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          result = JSON.stringify({ error: message });
          process.stdout.write(" error\n");
        }

        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      this.conversationHistory.push({ role: "user", content: toolResults });

      response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages: this.conversationHistory,
      });
    }

    const textBlocks = response.content.filter((b) => b.type === "text");
    const reply = textBlocks.map((b) => ("text" in b ? b.text : "")).join("\n");

    this.conversationHistory.push({ role: "assistant", content: response.content });

    return reply;
  }
}
