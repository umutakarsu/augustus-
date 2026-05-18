import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TreasuryAgent } from "./agent.js";

const BANNER = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ▄▀█ █ █ █▀▀ █ █ █▀ ▀█▀ █ █ █▀                            ║
║   █▀█ █▄█ █▄█ █▄█ ▄█  █  █▄█ ▄█                            ║
║                                                              ║
║   Treasury Agent — AI-powered programmable money             ║
║                                                              ║
║   Banking:  "Show me all my accounts and balances"           ║
║             "Send 500 EUR to DE89370400440532013000"          ║
║             "What's the EUR/USDC rate?"                      ║
║                                                              ║
║   Payments: "Create a checkout session for 119 EUR"          ║
║             "Search for banks in Germany"                    ║
║             "Verify this IBAN before I send money"           ║
║                                                              ║
║   Type 'exit' to quit                                        ║
╚══════════════════════════════════════════════════════════════╝
`;

async function main() {
  const bankingToken = process.env.AUGUSTUS_API_KEY;
  if (!bankingToken) {
    console.error(
      "Missing AUGUSTUS_API_KEY environment variable.\n" +
        "Get your sandbox key from the Augustus Dashboard:\n" +
        "  https://dashboard.augustus.com → Test Mode → Integration\n\n" +
        "Then run:\n" +
        "  AUGUSTUS_API_KEY=your_key npm start",
    );
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "Missing ANTHROPIC_API_KEY environment variable.\n" +
        "Get one at https://console.anthropic.com",
    );
    process.exit(1);
  }

  const paymentsKey = process.env.AUGUSTUS_PAYMENTS_API_KEY ?? null;
  const sandbox = process.env.AUGUSTUS_ENV !== "production";
  const agent = new TreasuryAgent(bankingToken, paymentsKey, sandbox);

  console.log(BANNER);
  console.log(`  Mode: ${sandbox ? "SANDBOX" : "PRODUCTION"}`);
  console.log(`  Banking API: connected`);
  console.log(`  Payments API: ${paymentsKey ? "connected" : "not configured (set AUGUSTUS_PAYMENTS_API_KEY)"}\n`);

  const rl = readline.createInterface({ input, output });

  while (true) {
    const userInput = await rl.question("\x1b[36myou >\x1b[0m ");
    const trimmed = userInput.trim();

    if (!trimmed) continue;
    if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
      console.log("\nGoodbye!");
      rl.close();
      process.exit(0);
    }

    try {
      console.log();
      const response = await agent.chat(trimmed);
      console.log(`\x1b[33maugustus >\x1b[0m ${response}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`\x1b[31mError: ${message}\x1b[0m\n`);
    }
  }
}

main();
