# Augustus Treasury Agent

An AI-powered treasury management agent built on the [Augustus](https://augustus.com) Banking API. Talk naturally to manage accounts, send payouts, convert currencies, and monitor transactions — proving the "clearing bank for the AI era" thesis.

## What it does

The agent connects Claude to the Augustus API through tool use, enabling natural-language treasury operations:

```
you > Show me all my accounts and their balances

  ⚡ list accounts... done
  ⚡ get account balance... done
  ⚡ get account balance... done

augustus > Here's your account overview:

  Account               Currency   Balance      Status
  ─────────────────────────────────────────────────────
  EUR Operating          EUR       €24,500.00   active
  USDC Wallet            USDC      $12,340.50   active
  GBP Settlements        GBP       £3,200.00    active
```

```
you > Convert 5,000 EUR to USDC

  ⚡ get exchange rate... done

augustus > Current rate: 1 EUR = 1.0847 USDC
  Converting €5,000.00 → ~5,423.50 USDC
  Shall I proceed with this conversion?
```

### Supported operations

| Command | What it does |
|---------|-------------|
| List accounts | View all fiat and crypto accounts with status |
| Check balances | Real-time balance for any account |
| List transactions | Transaction history with filtering |
| Send payouts | IBAN, UK sort code, or crypto wallet transfers |
| Exchange rates | Live FX quotes (EUR, GBP, USD, USDC) |
| Convert currency | Execute fiat ↔ stablecoin conversions |
| Track payouts | Monitor payout status (pending → paid) |
| Search customers | Find customers by name or email |

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   User       │────▶│  Claude (Sonnet)  │────▶│  Augustus API    │
│   Terminal   │◀────│  + Tool Use       │◀────│  Banking v1      │
└─────────────┘     └──────────────────┘     └──────────────────┘
                           │
                    Maps natural language
                    to API operations with
                    confirmation for writes
```

- **Claude Sonnet** interprets user intent and selects the right API calls
- **Tool definitions** map 1:1 to Augustus Banking API endpoints
- **Confirmation loop** — the agent always confirms before executing payouts or conversions
- **Conversation memory** — multi-turn context for follow-up questions

## Setup

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (sandbox mode by default)
ANTHROPIC_API_KEY=sk-ant-... AUGUSTUS_API_KEY=your_key npm start
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key from [console.anthropic.com](https://console.anthropic.com) |
| `AUGUSTUS_API_KEY` | Yes | Augustus API key from Dashboard → Test Mode → Integration |
| `AUGUSTUS_ENV` | No | Set to `production` for live API (default: `sandbox`) |

## Why this exists

Augustus positions itself as "the clearing bank for the AI era" — purpose-built around programmable money and AI. This agent is a concrete demonstration of that thesis: an AI that can reason about treasury operations and execute them through the Augustus API, turning natural language into programmable money flows.

Built with the Augustus Banking API (v1, `2026-05-01`) and Claude tool use.
