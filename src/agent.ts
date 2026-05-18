import Anthropic from "@anthropic-ai/sdk";
import { AugustusClient } from "./augustus-client.js";
import { tools } from "./tools.js";
import { handleToolCall } from "./tool-handler.js";

const SYSTEM_PROMPT = `You are Augustus Treasury, an AI assistant for managing treasury operations on the Augustus platform — the clearing bank for the AI era.

You help users manage their accounts, monitor balances, track transactions, send payouts, convert currencies (fiat ↔ stablecoin), and check exchange rates — all through natural language.

Capabilities:
- View accounts and balances (fiat: EUR, GBP, USD / crypto: USDC)
- List and filter transactions
- Send payouts to bank accounts (IBAN, UK sort code) or crypto wallets
- Get live FX rates and execute currency conversions
- Search customers
- Track payout statuses

Guidelines:
- Always confirm before executing payouts or conversions — summarize amount, destination, and currency first
- Format monetary amounts clearly with currency symbols
- When listing accounts, show the label, currency, status, and key identifiers (IBAN, wallet address)
- For transactions, show a clean summary: date, amount, direction (in/out), and reference
- If an API call fails, explain the error clearly and suggest what to try next
- Be concise but thorough — this is a treasury tool, accuracy matters`;

export class TreasuryAgent {
  private anthropic: Anthropic;
  private augustus: AugustusClient;
  private conversationHistory: Anthropic.MessageParam[] = [];

  constructor(augustusToken: string, sandbox = true) {
    this.anthropic = new Anthropic();
    this.augustus = new AugustusClient(augustusToken, sandbox);
  }

  async chat(userMessage: string): Promise<string> {
    this.conversationHistory.push({ role: "user", content: userMessage });

    let response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: this.conversationHistory,
    });

    while (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b) => b.type === "tool_use",
      );

      this.conversationHistory.push({
        role: "assistant",
        content: response.content,
      });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        if (block.type !== "tool_use") continue;
        const name = block.name;
        const input = block.input as Record<string, unknown>;

        process.stdout.write(`  ⚡ ${formatToolName(name)}...`);

        let result: string;
        try {
          result = await handleToolCall(this.augustus, name, input);
          process.stdout.write(" done\n");
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          result = JSON.stringify({ error: message });
          process.stdout.write(` error\n`);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
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

    this.conversationHistory.push({
      role: "assistant",
      content: response.content,
    });

    return reply;
  }
}

function formatToolName(name: string): string {
  return name.replace(/_/g, " ");
}
