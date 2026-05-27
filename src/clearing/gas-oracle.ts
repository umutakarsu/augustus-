import type { Chain } from "./types.js";

const ETH_PRICE_USD = 3200;
const USDC_TRANSFER_GAS = 65_000;

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class GasOracle {
  private sandbox: boolean;

  constructor(_config: { ethereumRpcUrl: string; baseRpcUrl: string; sandbox: boolean }) {
    this.sandbox = _config.sandbox;
  }

  private prodGuard(): never {
    throw new Error("Production gas oracle not implemented — connect ethers.js provider");
  }

  async getGasPrice(chain: Chain): Promise<{ gwei: string; usd_per_transfer: string }> {
    if (!this.sandbox) this.prodGuard();

    let gweiValue: number;

    if (chain === "ethereum") {
      gweiValue = randomInRange(25, 45);
    } else {
      gweiValue = randomInRange(0.01, 0.05);
    }

    // cost = gas_used * gas_price_gwei * 1e-9 * ETH_PRICE_USD
    const usdCost = USDC_TRANSFER_GAS * gweiValue * 1e-9 * ETH_PRICE_USD;

    return {
      gwei: gweiValue.toFixed(4),
      usd_per_transfer: usdCost.toFixed(4),
    };
  }

  async estimateTransferCost(chain: Chain): Promise<string> {
    const { usd_per_transfer } = await this.getGasPrice(chain);
    return usd_per_transfer;
  }
}
