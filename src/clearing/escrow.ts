import { randomBytes } from "node:crypto";
import { ChainClient } from "./chain-client.js";
import type { Chain, EscrowRecord, EscrowState } from "./types.js";

function address(): string {
  return "0x" + randomBytes(20).toString("hex");
}

export class EscrowManager {
  private records = new Map<string, EscrowRecord>();

  constructor(
    private chainClient: ChainClient,
    private sandbox: boolean,
  ) {}

  private get(contractAddress: string): EscrowRecord {
    const rec = this.records.get(contractAddress);
    if (!rec) throw new Error(`unknown escrow: ${contractAddress}`);
    return rec;
  }

  private assertState(rec: EscrowRecord, ...allowed: EscrowState[]): void {
    if (!allowed.includes(rec.state)) {
      throw new Error(`escrow ${rec.contract_address} is ${rec.state}, expected ${allowed.join(" | ")}`);
    }
  }

  async deployEscrow(params: {
    bankA: string;
    bankB: string;
    chain: Chain;
    usdcAmount: string;
    deadline: number;
  }): Promise<EscrowRecord> {
    const contractAddress = address();
    const { tx_hash } = await this.chainClient.transferUSDC(
      params.chain,
      params.bankA,
      contractAddress,
    "0", // deploy tx, no USDC moved yet
    );

    const rec: EscrowRecord = {
      contract_address: contractAddress,
      chain: params.chain,
      usdc_amount: params.usdcAmount,
      bank_a_signed: false,
      bank_b_signed: false,
      state: "awaiting_funding",
      deploy_tx: tx_hash,
      fund_tx: null,
      sign_a_tx: null,
      sign_b_tx: null,
      release_tx: null,
      deadline: params.deadline,
    };

    this.records.set(contractAddress, rec);
    return { ...rec };
  }

  async fundEscrow(contractAddress: string, chain: Chain, amount: string): Promise<EscrowRecord> {
    const rec = this.get(contractAddress);
    this.assertState(rec, "awaiting_funding");

    if (amount !== rec.usdc_amount) {
      throw new Error(`fund amount ${amount} does not match escrow amount ${rec.usdc_amount}`);
    }

    const { tx_hash } = await this.chainClient.transferUSDC(
      chain,
      "bank_a_wallet",
      contractAddress,
      amount,
    );

    rec.state = "funded";
    rec.fund_tx = tx_hash;
    return { ...rec };
  }

  async sign(contractAddress: string, chain: Chain, signer: "bank_a" | "bank_b"): Promise<EscrowRecord> {
    const rec = this.get(contractAddress);
    this.assertState(rec, "funded", "dual_signed");

    if (signer === "bank_a") {
      if (rec.bank_a_signed) throw new Error("bank A already signed");
      rec.bank_a_signed = true;
      const { tx_hash } = await this.chainClient.transferUSDC(chain, contractAddress, contractAddress, "0");
      rec.sign_a_tx = tx_hash;
    } else {
      if (rec.bank_b_signed) throw new Error("bank B already signed");
      rec.bank_b_signed = true;
      const { tx_hash } = await this.chainClient.transferUSDC(chain, contractAddress, contractAddress, "0");
      rec.sign_b_tx = tx_hash;
    }

    if (rec.bank_a_signed && rec.bank_b_signed) {
      rec.state = "dual_signed";

      const { tx_hash } = await this.chainClient.transferUSDC(
        chain,
        contractAddress,
        "bank_b_wallet",
        rec.usdc_amount,
      );
      rec.release_tx = tx_hash;
      rec.state = "released";
    }

    return { ...rec };
  }

  async getState(contractAddress: string): Promise<EscrowRecord> {
    const rec = this.get(contractAddress);

    if (
      rec.state !== "released" &&
      rec.state !== "refunded" &&
      rec.state !== "expired" &&
      Date.now() / 1000 >= rec.deadline
    ) {
      rec.state = "expired";
    }

    return { ...rec };
  }

  async refund(contractAddress: string, chain: Chain): Promise<EscrowRecord> {
    const rec = this.get(contractAddress);

    if (Date.now() / 1000 < rec.deadline) {
      throw new Error("deadline has not passed");
    }
    this.assertState(rec, "funded", "dual_signed", "expired");

    const { tx_hash } = await this.chainClient.transferUSDC(
      chain,
      contractAddress,
      "bank_a_wallet",
      rec.usdc_amount,
    );

    rec.state = "refunded";
    rec.fund_tx = rec.fund_tx; // unchanged, but release_tx stays as refund reference
    rec.release_tx = tx_hash;
    return { ...rec };
  }
}
