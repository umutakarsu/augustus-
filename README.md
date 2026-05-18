# Augustus Treasury Agent

AI agent that operates the Augustus platform through natural language. Not a thin wrapper — it runs multi-step payment workflows, catches anomalies, and handles the failure cases that matter in payments.

## What's different about this

Most API demos just wrap each endpoint in a function. This agent thinks in **workflows**:

- **Two-Phase Payout**: `prepare_payout` runs VOP verification and balance check without sending money. You see the results, decide whether to proceed, and only then call `confirm_payout`. Name mismatch? You choose. Low balance? Blocked. No auto-firing transfers on ambiguous verification.
- **Treasury Report**: pulls all accounts, balances, recent transactions, and pending payouts. Then flags problems — zero-balance accounts, payouts stuck pending for >24h, transactions over 10k.
- **FX with slippage protection**: gets a quote, executes the conversion, then compares what you got vs what was quoted. Warns if slippage exceeds 0.5%.
- **Reconciliation**: takes a list of expected payments and cross-references them against actual deposits. Uses fuzzy matching — case-insensitive partial references and ±0.02 amount tolerance — because bank statement references get mangled in transit. Tells you what matched (exact vs fuzzy), what's missing, and what showed up unexpectedly.

## Quick start

```bash
npm install && npm run build
ANTHROPIC_API_KEY=... AUGUSTUS_API_KEY=... npm start
```

Add `AUGUSTUS_PAYMENTS_API_KEY` for checkout sessions, refunds, VOP, and bank search.

## Tests

```bash
npm test
```

17 tests covering the things that actually go wrong in payments: two-phase payout flow (prepare then confirm), VOP mismatches that don't auto-fire, insufficient funds blocking, expired preparation IDs, retrying failed payouts, fuzzy reconciliation matching mangled references, FX slippage detection.

## How it works

Claude picks the right workflow based on what you ask, runs it against the Augustus API, and streams the results as they generate. Payouts use a two-phase flow (prepare → confirm) so you always see pre-flight checks before money moves. All write operations use idempotency keys. Conversation history is capped at 40 messages.

Covers both the Banking API (v1, `api.augustus.com`) and the Payments API (`api.getivy.de`).
