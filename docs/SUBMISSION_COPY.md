# Submission Copy

## Project Name

Market Intel

## Short Description

Market Intel is a live crypto market intelligence chat agent where answers render as explorable widgets instead of paragraphs. It continuously ingests Coinbase and Kraken market data into ClickHouse, uses Trigger.dev for durable ingestion, watchdogs, event detection, fanout, and chat orchestration, and lets users drill from a visual signal into the underlying trades.

## What It Does

Market Intel watches BTC-USD, ETH-USD, and SOL-USD across Coinbase and Kraken in real time. A user can ask about spreads, price action, correlations, volatility, order-book state, or trade tape context, and the agent responds with an interactive component: heatmaps, candlesticks, volatility bands, correlation networks, or short verdict cards.

The key product idea is "beyond the wall of text": the response itself is the interface. Users can drag-select a candlestick range to ask a scoped follow-up, click a spread heatmap cell to inspect matched trades around that timestamp, and hover correlation edges to see the rolling relationship over time.

It also supports action, not just analysis. Alert creation is gated through human-in-the-loop approval, so the agent can propose a real subscription without silently taking an operational action.

## How ClickHouse Is Used

ClickHouse is the real-time analytical layer. The app continuously writes live public exchange data into:

- `trades` for tick-level Coinbase/Kraken trade flow
- `book_snapshots` for best bid/ask snapshots
- `ingest_heartbeats` for ingestion freshness proof
- `events` for detected market anomalies

It also uses:

- `ohlc_1m_mv`, an aggregating materialized view for fast OHLCV queries
- `cross_exchange_spread`, a 250ms-matched Coinbase/Kraken spread view with `time_delta_ms` exposed so staleness is inspectable

The widgets query ClickHouse directly for live rows and show the resulting data, not mocked fixtures.

## How Trigger.dev Is Used

Trigger.dev orchestrates the durable runtime:

- `market-intel` chat agent wraps the Vercel AI SDK stream and tool calls
- `ingest-trades-ws` holds long-running Coinbase/Kraken trade WebSocket connections
- `ingest-book-ws` holds long-running Coinbase/Kraken book/ticker WebSocket connections
- `ingestion-watchdog` checks ClickHouse heartbeat freshness and restarts stale ingestion tasks
- `detect-events` runs scheduled anomaly detection against live ClickHouse data
- `alert-fanout` turns matching events into pending human approvals

This is not just a frontend demo calling an API route; Trigger.dev runs the background market-watching system.

## Demo Prompts

Use these in order for a reliable five-minute recording:

1. `Show me the current BTC-USD cross-exchange spread heatmap.`
2. `Show me the rolling correlation network for BTC-USD, ETH-USD, and SOL-USD.`
3. `Show me a BTC-USD candlestick for the last hour.`
4. Drag-select a narrower range on the candlestick.
5. Click a spread heatmap cell to drill into trades around that reading.
6. `Alert me if BTC-USD spread anomaly exceeds severity 10.`
7. Approve the alert card.

For a deterministic proactive approval card, run `npm run demo:hitl` before recording.

## Live Health Check

Before recording:

```bash
npm run demo:health
```

This verifies the deployed app, ClickHouse freshness, recent live rows, the 250ms spread view, and Trigger run status when a production Trigger key is available locally.
