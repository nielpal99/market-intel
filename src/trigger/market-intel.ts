import { chat } from "@trigger.dev/sdk/ai";
import { streamText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { chQuery } from "@/lib/clickhouse";
import { db } from "@/lib/postgres";
import { savedInvestigations, alertSubscriptions } from "@/lib/schema";

const SYMBOLS = z.enum(["BTC-USD", "ETH-USD", "SOL-USD"]);

const query_recent_events = tool({
  description: "Fetch recent anomaly events from ClickHouse.",
  parameters: z.object({ symbol: SYMBOLS, limit: z.number().max(50).default(10) }),
  execute: async ({ symbol, limit }) => {
    return chQuery(
      "SELECT event_type, window_start, window_end, severity, detail FROM events WHERE symbol = {symbol:String} ORDER BY window_end DESC LIMIT {limit:UInt8}",
      { symbol, limit }
    );
  },
});

const query_price_series = tool({
  description: "Fetch OHLCV price series from ClickHouse.",
  parameters: z.object({
    symbol: SYMBOLS,
    window_start: z.string().datetime(),
    window_end: z.string().datetime(),
  }),
  execute: async ({ symbol, window_start, window_end }) => {
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
       GROUP BY symbol, exchange, minute
       ORDER BY minute`,
      { symbol, window_start, window_end }
    );
  },
});

const query_spread_series = tool({
  description: "Fetch cross-exchange spread series from ClickHouse.",
  parameters: z.object({ symbol: SYMBOLS, minutes: z.number().max(120).default(30) }),
  execute: async ({ symbol, minutes }) => {
    return chQuery(
      `SELECT * FROM cross_exchange_spread
       WHERE symbol = {symbol:String}
         AND timestamp > now() - INTERVAL {minutes:UInt16} MINUTE
       ORDER BY timestamp`,
      { symbol, minutes }
    );
  },
});

const query_orderbook_at = tool({
  description: "Fetch orderbook snapshot for a symbol/exchange at a time.",
  parameters: z.object({
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
      { symbol, exchange, at }
    );
  },
});

const query_correlations = tool({
  description: "Fetch close prices for multiple symbols to compute correlations.",
  parameters: z.object({ symbols: z.array(SYMBOLS).max(3) }),
  execute: async ({ symbols }) => {
    return chQuery(
      `SELECT symbol, minute, argMaxMerge(close) AS close
       FROM ohlc_1m_mv
       WHERE symbol IN ({symbols:Array(String)})
       GROUP BY symbol, minute
       ORDER BY symbol, minute`,
      { symbols }
    );
  },
});

const render_candlestick = tool({
  description: "Render an annotated candlestick chart. Call this for price/direction questions.",
  parameters: z.object({
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
    const ohlc = await chQuery(
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
       GROUP BY symbol, exchange, minute
       ORDER BY minute`,
      { symbol: input.symbol, window_start: input.window_start, window_end: input.window_end }
    );
    return { input, ohlc };
  },
});

const render_spread_heatmap = tool({
  description: "Render a cross-exchange spread heatmap.",
  parameters: z.object({
    symbol: SYMBOLS,
    minutes: z.number().max(120).default(30),
    caption: z.string().max(160),
  }),
  execute: async (input) => {
    const rows = await query_spread_series.execute({ symbol: input.symbol, minutes: input.minutes });
    return { input, rows };
  },
});

const render_volatility_bands = tool({
  description: "Render price with rolling volatility band overlay.",
  parameters: z.object({
    symbol: SYMBOLS,
    window_start: z.string().datetime(),
    window_end: z.string().datetime(),
    caption: z.string().max(160),
  }),
  execute: async (input) => {
    const ohlc = await chQuery(
      `SELECT minute, argMaxMerge(close) AS close FROM ohlc_1m_mv
       WHERE symbol = {symbol:String}
         AND minute >= {window_start:DateTime64(3)}
         AND minute <= {window_end:DateTime64(3)}
       GROUP BY minute ORDER BY minute`,
      { symbol: input.symbol, window_start: input.window_start, window_end: input.window_end }
    );
    return { input, ohlc };
  },
});

const render_correlation_network = tool({
  description: "Render a correlation network of the requested symbols.",
  parameters: z.object({
    symbols: z.array(SYMBOLS).max(3),
    hours: z.number().max(48).default(24),
    caption: z.string().max(160),
  }),
  execute: async (input) => {
    const rows = await query_correlations.execute({ symbols: input.symbols });
    return { input, rows };
  },
});

const render_verdict_card = tool({
  description: "Render a single-line answer with confidence and optional stats.",
  parameters: z.object({
    verdict: z.string().max(200),
    confidence: z.number().min(0).max(1),
    stats: z.array(z.object({ label: z.string(), value: z.string() })).max(4).optional(),
    caption: z.string().max(160).optional(),
  }),
  execute: async (input) => input,
});

const save_investigation = tool({
  description: "Save the current widget snapshot to Postgres.",
  parameters: z.object({
    user_id: z.string().uuid(),
    chat_id: z.string(),
    turn_index: z.number().int(),
    question: z.string(),
    widget_snapshot: z.record(z.unknown()),
  }),
  execute: async (input) => {
    await db.insert(savedInvestigations).values({
      userId: input.user_id,
      chatId: input.chat_id,
      turnIndex: input.turn_index,
      question: input.question,
      widgetSnapshot: input.widget_snapshot as any,
    });
    return { saved: true };
  },
});

const set_alert = tool({
  description: "Create an alert subscription in Postgres.",
  parameters: z.object({
    user_id: z.string().uuid(),
    symbol: SYMBOLS,
    event_type: z.enum(["volatility_spike", "spread_anomaly", "volume_spike"]),
    min_severity: z.number().min(0),
  }),
  execute: async (input) => {
    await db.insert(alertSubscriptions).values({
      userId: input.user_id,
      symbol: input.symbol,
      eventType: input.event_type,
      minSeverity: input.min_severity,
    });
    return { pending_approval: true };
  },
});

const SYSTEM_PROMPT = `You are a market intelligence assistant. Every response to the user must end with exactly one render_* tool call. Do not respond with prose or markdown between tool calls.

Process:
1. Call one or more query_* tools to fetch data from ClickHouse.
2. Reason about the results.
3. Emit exactly one render_* tool call as the final answer.

Framing must be structural, not directive. You are not a financial advisor.`;

export const marketIntel = chat.agent({
  id: "market-intel",
  headStart: true,
  run: async ({ messages, signal }) =>
    streamText({
      model: anthropic("claude-sonnet-4-5"),
      messages,
      abortSignal: signal,
      maxSteps: 15,
      system: SYSTEM_PROMPT,
      tools: {
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
      },
    }),
});
