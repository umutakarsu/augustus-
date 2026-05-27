import { randomBytes } from "node:crypto";
import type { Chain } from "./types.js";

interface StoredTx {
  chain: Chain;
  block_number: number;
  created_at: number;
}

export class ChainClient {
  private sandbox: boolean;
  private txStore = new Map<string, StoredTx>();
  private blockCounter = 19_420_000;

  constructor(_config: { ethereumRpcUrl: string; baseRpcUrl: string; sandbox: boolean }) {
    this.sandbox = _config.sandbox;
  }

  private prodGuard(): never {
    throw new Error("Production chain client not implemented — connect ethers.js provider");
  }

  private txHash(): string {
    return "0x" + randomBytes(32).toString("hex");
  }

  private nextBlock(): number {
    return ++this.blockCounter;
  }

  async transferUSDC(
    chain: Chain,
    _from: string,
    _to: string,
    _amount: string,
  ): Promise<{ tx_hash: string; chain: Chain }> {
    if (!this.sandbox) this.prodGuard();

    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));

    const tx_hash = this.txHash();
    this.txStore.set(tx_hash, {
      chain,
      block_number: this.nextBlock(),
      created_at: Date.now(),
    });

    return { tx_hash, chain };
  }

  async getTransactionStatus(
    _chain: Chain,
    txHash: string,
  ): Promise<{ confirmed: boolean; block_number: number | null; confirmations: number }> {
    if (!this.sandbox) this.prodGuard();

    const tx = this.txStore.get(txHash);
    if (!tx) {
      return { confirmed: false, block_number: null, confirmations: 0 };
    }

    return {
      confirmed: true,
      block_number: tx.block_number,
      confirmations: this.blockCounter - tx.block_number + 1,
    };
  }

  async getUSDCBalance(_chain: Chain, _address: string): Promise<string> {
    if (!this.sandbox) this.prodGuard();
    return "1000000.00";
  }

  async postData(
    chain: Chain,
    _data: string,
  ): Promise<{ tx_hash: string; block_number: number }> {
    if (!this.sandbox) this.prodGuard();

    await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));

    const tx_hash = this.txHash();
    const block_number = this.nextBlock();
    this.txStore.set(tx_hash, { chain, block_number, created_at: Date.now() });

    return { tx_hash, block_number };
  }
}
