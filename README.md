# Market Intel — Live Crypto Market Intelligence, Answered in Widgets Not Words

A chat agent for live crypto markets where every response is a rendered, explorable visual — an annotated candlestick, a cross-exchange spread heatmap, a correlation network, a volatility band overlay — never a paragraph. Built on real, continuously-ingested public exchange data, with a durable agent orchestration layer that watches the market and proactively surfaces what it finds, gated behind human approval before it acts.

Built for the ClickHouse × Trigger.dev Virtual Summer Hackathon.

---

## Why this, not a chart site

Ask a market a question and you get a paragraph, or a chart you have to know to go find. This doesn't ask you to already know the right question — `detect-events` runs continuously against live ClickHouse data, and when something genuinely deviates from baseline, the agent proactively surfaces it, with the reasoning that led there, and proposes an action gated on your approval before anything executes.

The reactive path (ask a question, get a widget) exists too, and every widget is explorable, not static: drag a candlestick to zoom into a window, click a spread-heatmap cell to see the trade tape around that reading, hover a correlation edge to see the rolling series.

---

## Architecture

- **`chat.agent("market-intel")`** — [Trigger.dev v4.5+](https://trigger.dev/), the required orchestration primitive. A durable, long-running chat task built on Vercel AI SDK's `streamText`, currently running on **GPT-5.6 Terra** via `@ai-sdk/openai` (see [Model note](#model-note) below).
- **ClickHouse Cloud** — primary analytics database. Tick-level trade and order-book data ingested continuously from Coinbase Exchange and Kraken's public WebSocket feeds, aggregated via materialized views for fast agent recall.
- **Neon (Postgres)** — OLTP layer: users, watchlists, saved investigations, alert subscriptions, human-in-the-loop approvals.
- **Long-running Trigger.dev tasks** — persistent WebSocket ingestion, a heartbeat-driven watchdog, continuous anomaly detection, and event fanout to the OLTP layer.

### The 13 tools

| Tool | Reads | Does |
|---|---|---|
| `query_recent_events` | `events` | Recent anomalies for a symbol |
| `query_price_series` | `ohlc_1m_mv` | OHLCV for a window |
| `query_spread_series` | bounded `book_snapshots` join | Cross-venue spread history |
| `query_orderbook_at` | `book_snapshots` | Point-in-time depth |
| `query_correlations` | `ohlc_1m_mv` (multi-symbol) | Rolling Pearson correlation between symbols |
| `query_trades_around` | `trades` | Drill-down: trade tape around a specific reading |
| `render_candlestick` | — | Annotated candlestick, draggable to re-query a window |
| `render_spread_heatmap` | — | Symbol × time spread heatmap, clickable cells |
| `render_volatility_bands` | — | Rolling volatility overlay |
| `render_correlation_network` | — | Symbol correlation graph with hoverable rolling-series sparklines |
| `render_verdict_card` | — | Single-answer fallback, always used when no other widget fits — never plain text |
| `save_investigation` | writes Postgres | Saves the current widget snapshot |
| `set_alert` | writes Postgres | Uses AI SDK `needsApproval`, gating on a real human-in-the-loop approval before the subscription is created |

Every terminal response is a `render_*` tool call, enforced two ways: a system prompt instruction, and a structural UI filter that suppresses any stray text part following a completed render call — so the "no walls of text" constraint holds even if a given model occasionally tries to narrate its own tool output. (This distinction mattered in practice — see [Model note](#model-note).)

### Data pipeline

- `ingest-trades-ws` / `ingest-book-ws` — long-running Trigger.dev tasks holding persistent WebSocket connections to Coinbase Exchange (`matches`, `ticker`) and Kraken (`trade`, `book` depth-25). Reconnect with backoff, batched ClickHouse inserts, heartbeat rows on every flush.
- `ingestion-watchdog` — scheduled task checking heartbeat freshness in ClickHouse, re-triggering any ingestion task that's gone stale.
- `detect-events` — scheduled anomaly detection (volatility ≥3σ, volume ≥5× trailing average) against live ClickHouse data, writing real events and triggering `alert-fanout`.
- `alert-fanout` — matches new events against Postgres `alert_subscriptions`, writes a pending `hitl_approvals` row, and the frontend surfaces it as an unprompted card — the agent reaching the user, not a silent database row.

### Cross-exchange spread — a real, debugged metric

`cross_exchange_spread` matches Coinbase and Kraken order-book snapshots within a **250ms window** (tightened from an initial, less-validated 2-second window after live testing showed it produced misleading directional readings on fast-moving BTC). Every matched row carries `time_delta_ms`, so staleness is inspectable, not assumed. The view was validated against real captured order-book state, including catching and fixing a crossed-book bug that only appeared after a WebSocket reconnect during a live price move.

The heatmap tool uses the same 250ms matching logic, but bounds both `book_snapshots` sides to the recent window before joining so the demo path doesn't scan the full historical view.

We're explicit about what this metric is and isn't: it reflects real, small, time-bounded venue divergence — a genuine microstructure signal, not a claim about future price direction. Markets are broadly efficient; the value here is attention and cross-venue coverage a human can't sustain 24/7, not predictive edge.

---

## Model note

The system prompt and tool-selection contract were originally designed against Claude-style tool behavior, then hardened during GPT-5.6 Terra evaluation. Mid-build testing surfaced a real, worth-documenting finding: after completing a `render_*` call, the model could occasionally take an additional turn and emit the tool's raw JSON output as narrated text — a two-turn behavior the original single-clause system prompt ("no prose *between* tool calls") didn't explicitly forbid.

The fix is provider-agnostic and remains in the GPT-5.6 Terra runtime: an explicit "output nothing after a render call" instruction, a structural stream-control guard that stops after the first render tool and forces render continuation after non-render tools, context compaction for older tool payloads, and a UI filter that suppresses any text part following a completed render result.

---

## Evaluation

The schema includes an `eval_runs` Postgres table for runtime/OLTP audit evidence inside the product. The repo also includes a development-time Braintrust runner (`npm run eval:braintrust`) and a cheap structural regression check (`npm run eval:stream-controls`) for render-continuation and context-compaction behavior.

---

## Running it

Requires accounts (free tiers work): [Trigger.dev](https://trigger.dev/), [ClickHouse Cloud](https://clickhouse.com/cloud), [Neon](https://neon.tech/), and an OpenAI API key.

```bash
npm install
cp .env.example .env   # fill in TRIGGER_*, CLICKHOUSE_*, POSTGRES_URL, OPENAI_API_KEY
```

Apply schemas: `db/clickhouse_schema.sql` in ClickHouse's SQL console, `db/postgres_schema.sql` against Neon.

```bash
npx trigger.dev@latest login
npm run trigger:dev   # starts ingestion, watchdog, event detection
npm run trigger:kickoff # explicitly restarts the long-lived ingestion runs for local demos
npm run dev           # chat UI at localhost:3000
```

Data starts flowing within seconds; give it a minute or two before asking about "the last hour" so there's something in the window.

For a deterministic proactive-card demo beat, run:

```bash
npm run demo:health # verifies live Trigger + ClickHouse + deployed app state
npm run demo:hitl
```

That inserts one run-less pending `hitl_approvals` notification for the seeded demo user. The normal in-session `set_alert` path still uses AI SDK `needsApproval` and must be resolved through the chat approval UI.

For the final recording checklist, see [docs/SUBMISSION_RUNBOOK.md](docs/SUBMISSION_RUNBOOK.md).

---

## What's real vs. what's a hackathon simplification

We'd rather say this plainly than have it discovered:

- Market data is **real, live, public exchange data** — not synthetic or scripted. This was a deliberate choice over a fabricated-incident demo.
- The correlation network computes **real rolling Pearson correlation** from live `ohlc_1m_mv` data — not decorative lines between nodes (an earlier iteration was; caught in review, fixed).
- `set_alert`'s human-in-the-loop approval **genuinely gates** subscription creation via AI SDK's `needsApproval` — it doesn't fake a pending state.
- The earliest retained live ingestion heartbeat is `2026-07-20 17:09:49.681 UTC`; `ingest_heartbeats` has a 3-day TTL, so this is the oldest currently retained proof row, not a synthetic start marker.

---

## License

MIT. See `LICENSE`.
