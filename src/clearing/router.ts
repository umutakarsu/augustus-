import type { Chain, PaymentInstruction, Route } from "./types.js";
import type { GasOracle } from "./gas-oracle.js";
import type { BankingClient } from "../augustus-client.js";

const CHAINS: Chain[] = ["ethereum", "base"];
const QUOTE_TTL_MS = 60_000;

export class ClearingRouter {
  constructor(
    private gasOracle: GasOracle,
    private bankingClient: BankingClient,
  ) {}

  async findBestRoute(instruction: PaymentInstruction): Promise<Route> {
    const { source_currency, target_currency, amount } = instruction;
    const isSourceUSDC = source_currency === "USDC";
    const isTargetUSDC = target_currency === "USDC";

    const candidates = await Promise.all(
      CHAINS.map(async (chain): Promise<Route> => {
        const gasCostUsd = await this.gasOracle.estimateTransferCost(chain);
        const gasNum = parseFloat(gasCostUsd);

        let sourceToUsdcRate = "1";
        let usdcToTargetRate = "1";
        let usdcAmount: number;
        let targetAmount: number;
        let fxSpreadUsd = 0;
        const sourceAmount = parseFloat(amount);

        if (isSourceUSDC && isTargetUSDC) {
          usdcAmount = sourceAmount;
          targetAmount = sourceAmount;
        } else if (isSourceUSDC) {
          const targetQuote = await this.bankingClient.getQuote({
            source_currency: "USDC",
            target_currency,
            source_amount: amount,
          });
          usdcToTargetRate = targetQuote.rate;
          usdcAmount = sourceAmount;
          targetAmount = sourceAmount * parseFloat(usdcToTargetRate);
          // Spread estimated as deviation from midmarket (rough: 0.1-0.3% typical)
          fxSpreadUsd = usdcAmount * 0.002;
        } else if (isTargetUSDC) {
          const sourceQuote = await this.bankingClient.getQuote({
            source_currency,
            target_currency: "USDC",
            source_amount: amount,
          });
          sourceToUsdcRate = sourceQuote.rate;
          usdcAmount = sourceAmount * parseFloat(sourceToUsdcRate);
          targetAmount = usdcAmount;
          fxSpreadUsd = usdcAmount * 0.002;
        } else {
          const [sourceQuote, targetQuote] = await Promise.all([
            this.bankingClient.getQuote({
              source_currency,
              target_currency: "USDC",
              source_amount: amount,
            }),
            this.bankingClient.getQuote({
              source_currency: "USDC",
              target_currency,
            }),
          ]);
          sourceToUsdcRate = sourceQuote.rate;
          usdcToTargetRate = targetQuote.rate;
          usdcAmount = sourceAmount * parseFloat(sourceToUsdcRate);
          targetAmount = usdcAmount * parseFloat(usdcToTargetRate);
          // Two-leg FX: spread on both conversions
          fxSpreadUsd = usdcAmount * 0.004;
        }

        const now = Date.now();

        return {
          chain,
          gas_estimate_usd: gasNum.toFixed(4),
          fx_rate_source_to_usdc: sourceToUsdcRate,
          fx_rate_usdc_to_target: usdcToTargetRate,
          source_amount: amount,
          usdc_amount: usdcAmount.toFixed(2),
          target_amount: targetAmount.toFixed(2),
          total_cost_usd: (gasNum + fxSpreadUsd).toFixed(4),
          quoted_at: now,
          expires_at: now + QUOTE_TTL_MS,
        };
      }),
    );

    candidates.sort(
      (a, b) => parseFloat(a.total_cost_usd) - parseFloat(b.total_cost_usd),
    );

    return candidates[0]!;
  }
}
