# Augustus Treasury Agent

AI agent that operates the Augustus platform through natural language. Not a thin wrapper — it runs multi-step payment workflows, catches anomalies, and handles the failure cases that matter in payments.

## What's different about this

Most API demos just wrap each endpoint in a function. This agent thinks in **workflows**:

- **Safe Payout**: verifies the payee name via VOP → checks your balance → sends the payout. If the name doesn't match, it warns you. If you're short on funds, it stops. One command, three safety checks.
- **Treasury Report**: pulls all accounts, balances, recent transactions, and pending payouts. Then flags problems — zero-balance accounts, payouts stuck pending for >24h, transactions over 10k.
- **FX with slippage protection**: gets a quote, executes the conversion, then compares what you got vs what was quoted. Warns if slippage exceeds 0.5%.
- **Reconciliation**: takes a list of expected payments and cross-references them against actual deposits. Tells you what matched, what's missing, and what showed up unexpectedly.

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

12 tests covering the things that actually go wrong in payments: insufficient funds blocking a payout, VOP mismatches, stale pending payouts, FX slippage detection, reconciliation with missing and unexpected deposits.

## How it works

Claude picks the right workflow based on what you ask, runs it against the Augustus API, and presents the results. All write operations use idempotency keys. Conversation history is capped at 40 messages.

Covers both the Banking API (v1, `api.augustus.com`) and the Payments API (`api.getivy.de`).
