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
║   Talk naturally to manage your treasury:                    ║
║   "Show me all my accounts"                                  ║
║   "What's the EUR/USDC rate for 10,000 euros?"               ║
║   "Send 500 EUR to DE89370400440532013000"                   ║
║   "List my recent transactions"                              ║
║                                                              ║
║   Type 'exit' to quit                                        ║
╚══════════════════════════════════════════════════════════════╝
`;

async function main() {
  const augustusToken = process.env.AUGUSTUS_API_KEY;
  if (!augustusToken) {
    console.error(
      "Missing AUGUSTUS_API_KEY environment variable.\n" +
        "Get your sandbox API key from the Augustus Dashboard:\n" +
        "  https://dashboard.augustus.com → Test Mode → Integration\n\n" +
        "Then run:\n" +
        "  AUGUSTUS_API_KEY=your_key npm start",
    );
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "Missing ANTHROPIC_API_KEY environment variable.\n" +
        "Get one at https://console.anthropic.com\n\n" +
        "Then run:\n" +
        "  ANTHROPIC_API_KEY=your_key AUGUSTUS_API_KEY=your_key npm start",
    );
    process.exit(1);
  }

  const sandbox = process.env.AUGUSTUS_ENV !== "production";
  const agent = new TreasuryAgent(augustusToken, sandbox);

  console.log(BANNER);
  if (sandbox) {
    console.log("  📋 Running in SANDBOX mode\n");
  }

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
