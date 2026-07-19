# Market Intel — Live Market Intelligence Chat Agent

Built for the ClickHouse × Trigger.dev Virtual Summer Hackathon.

A chat agent for live crypto markets where every answer is a rendered visual component: annotated candlesticks, cross-exchange spread heatmaps, volatility bands, and correlation networks.

## Stack

- **Next.js** frontend (`src/app`, `src/components`)
- **Trigger.dev v4.5** tasks (`src/trigger`)
  - `chat.agent("market-intel")` orchestrates `streamText` + tools
  - `ingest-trades-ws`, `ingest-book-ws`, `ingestion-watchdog`, `detect-events`, `alert-fanout`
- **ClickHouse** as primary analytics/OLAP store (`db/clickhouse_schema.sql`)
- **Postgres** for OLTP state: users, watchlists, saved investigations, alerts, HITL approvals (`db/postgres_schema.sql`)
- **Vercel AI SDK** + **Anthropic** for the LLM layer
- **lightweight-charts** for candlestick rendering

## Quick start

1. Copy `.env.example` to `.env` and fill in:
   - `ANTHROPIC_API_KEY`
   - `TRIGGER_API_KEY`, `TRIGGER_API_URL`
   - `CLICKHOUSE_*` and `POSTGRES_URL`
2. Run the ClickHouse and Postgres schema files.
3. Install deps: `npm install`
4. Dev server: `npm run dev`
5. Trigger dev: `npm run trigger:dev`

## Trigger.dev tasks

| Task | File | Purpose |
|------|------|---------|
| `market-intel` | `src/trigger/market-intel.ts` | `chat.agent()` with all query/render/OLTP tools |
| `ingest-trades-ws` | `src/trigger/ingestion.ts` | Coinbase + Kraken trade WebSocket ingestion |
| `ingest-book-ws` | `src/trigger/ingestion.ts` | Orderbook WebSocket ingestion |
| `ingestion-watchdog` | `src/trigger/ingestion.ts` | Cron (2 min): re-triggers ingestion when heartbeats go stale |
| `detect-events` | `src/trigger/ingestion.ts` | Cron (1 min): volatility/volume anomalies → `events` + fanout |
| `alert-fanout` | `src/trigger/ingestion.ts` | Matches Postgres subscriptions → HITL approvals |

## OLTP + OLAP flow

1. `detect-events` scans ClickHouse (`ohlc_1m_mv`, `cross_exchange_spread`).
2. On a hit, it triggers `alert-fanout`.
3. `alert-fanout` reads `alert_subscriptions` from Postgres.
4. For each match, it inserts a `hitl_approvals` row.
5. User approves in the chat UI; `chat.agent()` resumes the investigation and streams a widget back.

## Frontend

`useChat` from `@ai-sdk/react` + `useTriggerChatTransport` from `@trigger.dev/sdk/chat/react`.
Server routes: `/api/chat/token` mints the transport access token; `/api/chat` is the
`chat.headStart` warm first-turn handler.
Messages are rendered by `part.type`:
- `text` → caption
- `tool-render_*` → typed widget component
- `tool-set_alert` in `approval-requested` state → approve/deny HITL buttons

## License

MIT. See `LICENSE`.
