import { tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { chQuery } from "@/lib/clickhouse";
import { db } from "@/lib/postgres";
import { savedInvestigations, alertSubscriptions, hitlApprovals } from "@/lib/schema";

// Single source of truth for the agent's model. To switch back to Anthropic:
//   import { anthropic } from "@ai-sdk/anthropic";
//   export const model = anthropic("claude-sonnet-4-5");
export const model = openai("gpt-5.1");

// Identity comes from the server session, never from the LLM. This demo user
// is seeded by db/postgres_schema.sql; a real app would resolve it from auth.
export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

const SYMBOLS = z.enum(["BTC-USD", "ETH-USD", "SOL-USD"]);

// ClickHouse DateTime64 query params parse most reliably as "YYYY-MM-DD HH:MM:SS.mmm"
function toChDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 23).replace("T", " ");
}

async function fetchPriceSeries(symbol: string, window_start: string, window_end: string) {
  return chQuery(
    `SELECT minute,
      argMinMerge(open) AS open,
      maxMerge(high) AS high,
      minMerge(low) AS low,
      argMaxMerge(close) AS close,
      sumMerge(volume) AS volume
     FROM ohlc_1m_mv
     WHERE symbol = {symbol:String}
       AND minute >= {window_start:DateTime64(3)}
       AND minute <= {window_end:DateTime64(3)}
     GROUP BY minute
     ORDER BY minute`,
    { symbol, window_start: toChDateTime(window_start), window_end: toChDateTime(window_end) }
  );
}

async function fetchSpreadSeries(symbol: string, minutes: number) {
  return chQuery(
    `SELECT * FROM cross_exchange_spread
     WHERE symbol = {symbol:String}
       AND timestamp > now() - INTERVAL {minutes:UInt16} MINUTE
     ORDER BY timestamp`,
    { symbol, minutes }
  );
}

async function fetchCorrelations(symbols: string[]) {
  return chQuery(
    `SELECT symbol, minute, argMaxMerge(close) AS close
     FROM ohlc_1m_mv
     WHERE symbol IN ({symbols:Array(String)})
     GROUP BY symbol, minute
     ORDER BY symbol, minute`,
    { symbols }
  );
}

// Built per turn: the model has no clock, so relative windows ("last hour")
// must be computed from a current timestamp we provide.
export function systemPrompt(): string {
  return `You are a market intelligence assistant. Every response to the user must end with exactly one render_* tool call. Do not respond with prose or markdown between tool calls.

The current UTC time is ${new Date().toISOString()}. Compute all relative time windows ("last hour", "past 15 minutes") from this timestamp. Never guess dates.

Process:
1. Call one or more query_* tools to fetch data from ClickHouse.
2. Reason about the results.
3. Emit exactly one render_* tool call as the final answer.

If a query returns no rows, retry once with a shorter, more recent window before concluding data is unavailable — ingestion may have started recently.

Framing must be structural, not directive. You are not a financial advisor.`;
}

// chatId and userId come from the server (per-turn tools factory or headStart
// session), never from the model — the OLTP tools record which conversation
// and which user they acted for without trusting LLM-supplied identity.
export function buildMarketIntelTools(chatId: string, userId: string = DEMO_USER_ID) {
  const query_recent_events = tool({
    description: "Fetch recent anomaly events from ClickHouse.",
    inputSchema: z.object({ symbol: SYMBOLS, limit: z.number().max(50).default(10) }),
    execute: async ({ symbol, limit }) => {
      return chQuery(
        "SELECT event_type, window_start, window_end, severity, detail FROM events WHERE symbol = {symbol:String} ORDER BY window_end DESC LIMIT {limit:UInt8}",
        { symbol, limit }
      );
    },
  });

  const query_price_series = tool({
    description: "Fetch OHLCV price series from ClickHouse.",
    inputSchema: z.object({
      symbol: SYMBOLS,
      window_start: z.string().datetime(),
      window_end: z.string().datetime(),
    }),
    execute: async ({ symbol, window_start, window_end }) =>
      fetchPriceSeries(symbol, window_start, window_end),
  });

  const query_spread_series = tool({
    description: "Fetch cross-exchange spread series from ClickHouse.",
    inputSchema: z.object({ symbol: SYMBOLS, minutes: z.number().max(120).default(30) }),
    execute: async ({ symbol, minutes }) => fetchSpreadSeries(symbol, minutes),
  });

  const query_orderbook_at = tool({
    description: "Fetch orderbook snapshot for a symbol/exchange at a time.",
    inputSchema: z.object({
      symbol: SYMBOLS,
      exchange: z.enum(["coinbase", "kraken"]),
      at: z.string().datetime(),
    }),
    execute: async ({ symbol, exchange, at }) => {
      return chQuery(
        `SELECT * FROM book_snapshots
         WHERE symbol = {symbol:String} AND exchange = {exchange:String}
           AND timestamp <= {at:DateTime64(3)}
         ORDER BY timestamp DESC LIMIT 1`,
        { symbol, exchange, at: toChDateTime(at) }
      );
    },
  });

  const query_correlations = tool({
    description: "Fetch close prices for multiple symbols to compute correlations.",
    inputSchema: z.object({ symbols: z.array(SYMBOLS).max(3) }),
    execute: async ({ symbols }) => fetchCorrelations(symbols),
  });

  const render_candlestick = tool({
    description: "Render an annotated candlestick chart. Call this for price/direction questions.",
    inputSchema: z.object({
      symbol: SYMBOLS,
      window_start: z.string().datetime(),
      window_end: z.string().datetime(),
      interval: z.enum(["1m", "5m", "15m", "1h"]),
      annotations: z.array(z.object({
        timestamp: z.string().datetime(),
        label: z.string().max(60),
        kind: z.enum(["event", "volume_spike", "spread_anomaly"]),
      })).max(10),
      caption: z.string().max(160),
    }),
    execute: async (input) => {
      const ohlc = await fetchPriceSeries(input.symbol, input.window_start, input.window_end);
      return { input, ohlc };
    },
  });

  const render_spread_heatmap = tool({
    description: "Render a cross-exchange spread heatmap.",
    inputSchema: z.object({
      symbol: SYMBOLS,
      minutes: z.number().max(120).default(30),
      caption: z.string().max(160),
    }),
    execute: async (input) => {
      const rows = await fetchSpreadSeries(input.symbol, input.minutes);
      return { input, rows };
    },
  });

  const render_volatility_bands = tool({
    description: "Render price with rolling volatility band overlay.",
    inputSchema: z.object({
      symbol: SYMBOLS,
      window_start: z.string().datetime(),
      window_end: z.string().datetime(),
      caption: z.string().max(160),
    }),
    execute: async (input) => {
      const ohlc = await fetchPriceSeries(input.symbol, input.window_start, input.window_end);
      return { input, ohlc };
    },
  });

  const render_correlation_network = tool({
    description: "Render a correlation network of the requested symbols.",
    inputSchema: z.object({
      symbols: z.array(SYMBOLS).max(3),
      hours: z.number().max(48).default(24),
      caption: z.string().max(160),
    }),
    execute: async (input) => {
      const rows = await fetchCorrelations(input.symbols);
      return { input, rows };
    },
  });

  const render_verdict_card = tool({
    description: "Render a single-line answer with confidence and optional stats.",
    inputSchema: z.object({
      verdict: z.string().max(200),
      confidence: z.number().min(0).max(1),
      stats: z.array(z.object({ label: z.string(), value: z.string() })).max(4).optional(),
      caption: z.string().max(160),
    }),
    execute: async (input) => input,
  });

  const save_investigation = tool({
    description: "Save the current widget snapshot to Postgres.",
    inputSchema: z.object({
      turn_index: z.number().int(),
      question: z.string(),
      widget_snapshot: z.record(z.unknown()),
    }),
    execute: async (input) => {
      await db.insert(savedInvestigations).values({
        userId,
        chatId,
        turnIndex: input.turn_index,
        question: input.question,
        widgetSnapshot: input.widget_snapshot,
      });
      return { saved: true };
    },
  });

  const set_alert = tool({
    description:
      "Create an alert subscription in Postgres. Requires explicit user approval before it executes.",
    inputSchema: z.object({
      symbol: SYMBOLS,
      event_type: z.enum(["volatility_spike", "spread_anomaly", "volume_spike"]),
      min_severity: z.number().min(0),
    }),
    // Gate: record the pending request, then require frontend approval.
    // The AI SDK loop will not run `execute` until the user approves.
    // Idempotent on tool_call_id so a re-evaluated predicate can't duplicate rows.
    needsApproval: async (input, { toolCallId }) => {
      await db
        .insert(hitlApprovals)
        .values({
          userId,
          chatId,
          toolCallId,
          toolName: "set_alert",
          toolInput: input,
          status: "pending",
        })
        .onConflictDoNothing({ target: hitlApprovals.toolCallId });
      return true;
    },
    execute: async (input, { toolCallId }) => {
      await db.insert(alertSubscriptions).values({
        userId,
        symbol: input.symbol,
        eventType: input.event_type,
        minSeverity: input.min_severity,
      });
      await db
        .update(hitlApprovals)
        .set({ status: "approved", resolvedAt: new Date() })
        .where(eq(hitlApprovals.toolCallId, toolCallId));
      return { subscribed: true };
    },
  });

  return {
    query_recent_events,
    query_price_series,
    query_spread_series,
    query_orderbook_at,
    query_correlations,
    render_candlestick,
    render_spread_heatmap,
    render_volatility_bands,
    render_correlation_network,
    render_verdict_card,
    save_investigation,
    set_alert,
  };
}

export type MarketIntelTools = ReturnType<typeof buildMarketIntelTools>;
