import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TreasuryAgent } from "./agent.js";

async function main() {
  const bankingToken = process.env.AUGUSTUS_API_KEY;
  if (!bankingToken) {
    console.error("Set AUGUSTUS_API_KEY (sandbox key from dashboard.augustus.com)");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY (from console.anthropic.com)");
    process.exit(1);
  }

  const paymentsKey = process.env.AUGUSTUS_PAYMENTS_API_KEY ?? null;
  const sandbox = process.env.AUGUSTUS_ENV !== "production";
  const agent = new TreasuryAgent(bankingToken, paymentsKey, sandbox);

  console.log(`\nAugustus Treasury Agent`);
  console.log(`${sandbox ? "sandbox" : "production"} · banking: yes · payments: ${paymentsKey ? "yes" : "no"}\n`);

  const rl = readline.createInterface({ input, output });

  process.on("SIGINT", () => {
    console.log("\n");
    rl.close();
    process.exit(0);
  });

  while (true) {
    const line = await rl.question("you > ");
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit") break;

    try {
      console.log();
      await agent.chat(trimmed);
      console.log();
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  rl.close();
}

main();
