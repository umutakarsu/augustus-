import { ChainClient } from "./chain-client.js";
import { EscrowManager } from "./escrow.js";
import type { Chain, ClearingEvent, EscrowRecord, EscrowState } from "./types.js";

const TERMINAL_STATES: Set<EscrowState> = new Set(["released", "refunded", "expired"]);
const POLL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export class SettlementMonitor {
  constructor(
    private chainClient: ChainClient,
    private escrowManager: EscrowManager,
  ) {}

  async waitForConfirmation(
    chain: Chain,
    txHash: string,
    maxWaitMs = DEFAULT_TIMEOUT_MS,
  ): Promise<{ confirmed: boolean; block_number: number }> {
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const status = await this.chainClient.getTransactionStatus(chain, txHash);
      if (status.confirmed && status.block_number !== null) {
        return { confirmed: true, block_number: status.block_number };
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    return { confirmed: false, block_number: 0 };
  }

  async watchEscrow(
    record: EscrowRecord,
    onEvent: (event: ClearingEvent) => void,
  ): Promise<EscrowRecord> {
    let prev = record.state;

    while (true) {
      const current = await this.escrowManager.getState(record.contract_address);

      if (current.state !== prev) {
        onEvent(this.stateEvent(current.state));
        prev = current.state;
      }

      if (TERMINAL_STATES.has(current.state)) {
        return current;
      }

      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  private stateEvent(state: EscrowState): ClearingEvent {
    const stepMap: Record<EscrowState, ClearingEvent["step"]> = {
      deploying: "escrow_deploy",
      awaiting_funding: "escrow_fund",
      funded: "escrow_fund",
      dual_signed: "sign_b",
      released: "release",
      refunded: "release",
      expired: "release",
    };

    const terminal = TERMINAL_STATES.has(state);

    return {
      step: stepMap[state],
      status: terminal ? (state === "released" ? "completed" : "failed") : "started",
      detail: state,
      timestamp: Date.now(),
    };
  }
}
