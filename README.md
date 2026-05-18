# Augustus Treasury Agent

An AI agent that covers the **entire Augustus platform** — both the Banking API and the Payments API — through natural language. Built to prove the "clearing bank for the AI era" thesis.

## What it does

33 tools across two APIs, all accessible through conversation:

```
you > Create a checkout session for 119 EUR, order ref SHOP-4821

  ⚡ create checkout session... done

augustus > Checkout session created:
  ID:        cs_8f3a2b...
  Amount:    €119.00
  Status:    open
  Redirect:  https://checkout.augustus.com/cs_8f3a2b...

  Send this redirect URL to your customer to complete payment.
```

```
you > Verify that Hans Mueller owns DE89370400440532013000 before I send the payout

  ⚡ verify payee... done

augustus > VOP result: ✓ match
  The account holder name "Hans Mueller" matches the bank records
  for IBAN DE89370400440532013000. Safe to proceed with the payout.
```

### Banking API (Augustus v1)

| Tool | Description |
|------|-------------|
| `list_accounts` | View all fiat and crypto accounts |
| `get_account_balance` | Real-time balance for any account |
| `create_account` | Create virtual accounts under programs |
| `freeze_account` / `unfreeze_account` / `close_account` | Account lifecycle management |
| `list_account_programs` | View FBO programs |
| `list_transactions` | Transaction history with filtering |
| `create_payout` | Send to IBAN, UK sort code, or crypto wallet |
| `list_payouts` / `get_payout_status` | Track payout lifecycle |
| `get_exchange_rate` | Live FX quotes (EUR, GBP, USD, USDC) |
| `convert_currency` / `list_conversions` | Execute and track FX conversions |
| `list_deposits` / `get_deposit` | Monitor incoming deposits |
| `create_return` / `list_returns` | Return deposits to senders |
| `search_customers` | Find customers by name or email |
| `create_webhook_subscription` / `list_webhook_subscriptions` / `delete_webhook_subscription` | Manage real-time event notifications |

### Payments API (Ivy legacy)

| Tool | Description |
|------|-------------|
| `create_checkout_session` / `get_checkout_session` / `expire_checkout_session` | Open Banking checkout with redirect flow |
| `create_order` / `get_order` / `expire_order` | Manual bank transfer orders |
| `create_refund` / `get_refund` | Full or partial refunds |
| `search_banks` | Find supported banks by country/currency |
| `verify_payee` | SEPA Verification of Payee (VOP) |
| `get_capabilities` | Check AIS/PIS support per market |

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
│   Terminal   │────▶│  Claude Sonnet   │────▶│  Augustus Banking API    │
│   (you)      │◀────│  + 33 Tools      │────▶│  Augustus Payments API   │
└─────────────┘     └──────────────────┘     └──────────────────────────┘
```

- **Claude Sonnet** maps natural language to the right API calls
- **33 tool definitions** cover both APIs end to end
- **Idempotency keys** on all write operations (payouts, conversions, returns, refunds, checkouts, orders)
- **Confirmation loop** — always confirms before moving money
- **Conversation memory** with sliding window (40 messages)

## Setup

```bash
npm install
npm run build

# Banking API only
ANTHROPIC_API_KEY=sk-ant-... AUGUSTUS_API_KEY=your_key npm start

# Full platform (Banking + Payments)
ANTHROPIC_API_KEY=sk-ant-... AUGUSTUS_API_KEY=your_key AUGUSTUS_PAYMENTS_API_KEY=your_key npm start
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `AUGUSTUS_API_KEY` | Yes | Banking API key (Bearer token) |
| `AUGUSTUS_PAYMENTS_API_KEY` | No | Payments API key (enables checkout, orders, refunds, VOP) |
| `AUGUSTUS_ENV` | No | Set to `production` for live APIs (default: `sandbox`) |

## Why this exists

Augustus is "the clearing bank for the AI era." This agent makes that real: an AI that understands the full platform — treasury management, payment acceptance, FX, compliance checks — and operates it through natural language.

Built with the Augustus Banking API (v1, `2026-05-01`), Augustus Payments API, and Claude tool use.
