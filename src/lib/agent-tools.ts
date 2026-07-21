import { hasToolCall, stepCountIs, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { chQuery, chQueryWithStats } from "@/lib/clickhouse";
import { db } from "@/lib/postgres";
import { savedInvestigations, alertSubscriptions, hitlApprovals } from "@/lib/schema";

// Single source of truth for the agent's model. To switch back to Anthropic:
//   import { anthropic } from "@ai-sdk/anthropic";
//   export const model = anthropic("claude-sonnet-4-5");
export const model = openai("gpt-5.5");

// Identity comes from the server session, never from the LLM. This demo user
// is seeded by db/postgres_schema.sql; a real app would resolve it from auth.
export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

const SYMBOLS = z.enum(["BTC-USD", "ETH-USD", "SOL-USD"]);
const SPREAD_SERIES_LIMIT = 300;
const VERDICT_MAX_CHARS = 200;
const COMPACT_ARRAY_LIMIT = 12;
const RENDER_TOOL_NAMES = [
  "render_candlestick",
  "render_spread_heatmap",
  "render_volatility_bands",
  "render_correlation_network",
  "render_verdict_card",
] as const;

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
    spreadSeriesSql(),
    { symbol, minutes, limit: SPREAD_SERIES_LIMIT }
  );
}

async function fetchTradesAround(symbol: string, at: string, seconds: number) {
  return chQuery(
    `SELECT exchange, symbol, trade_id, price, size, side, timestamp
     FROM trades
     WHERE symbol = {symbol:String}
       AND timestamp >= {at:DateTime64(3)} - INTERVAL {seconds:UInt16} SECOND
       AND timestamp <= {at:DateTime64(3)} + INTERVAL {seconds:UInt16} SECOND
     ORDER BY timestamp, exchange
     LIMIT 300`,
    { symbol, at: toChDateTime(at), seconds }
  );
}

async function fetchPriceSeriesWithStats(symbol: string, window_start: string, window_end: string) {
  return chQueryWithStats(
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

async function fetchSpreadSeriesWithStats(symbol: string, minutes: number) {
  return chQueryWithStats(
    spreadSeriesSql(),
    { symbol, minutes, limit: SPREAD_SERIES_LIMIT }
  );
}

function spreadSeriesSql() {
  return `SELECT * FROM (
      SELECT
        a.symbol,
        a.timestamp AS timestamp,
        a.exchange AS exchange_a, a.best_bid AS bid_a, a.best_ask AS ask_a,
        b.exchange AS exchange_b, b.best_bid AS bid_b, b.best_ask AS ask_b,
        abs(dateDiff('millisecond', a.timestamp, b.timestamp)) AS time_delta_ms,
        (a.best_bid - b.best_ask) AS spread_a_over_b
      FROM
        (SELECT * FROM book_snapshots
         WHERE symbol = {symbol:String}
           AND timestamp > now() - INTERVAL {minutes:UInt16} MINUTE) a
      INNER JOIN
        (SELECT * FROM book_snapshots
         WHERE symbol = {symbol:String}
           AND timestamp > now() - INTERVAL {minutes:UInt16} MINUTE) b
      ON a.symbol = b.symbol
       AND a.exchange != b.exchange
       AND abs(dateDiff('millisecond', a.timestamp, b.timestamp)) <= 250
      ORDER BY timestamp DESC
      LIMIT {limit:UInt16}
    )
    ORDER BY timestamp`;
}

async function fetchCorrelationsWithStats(symbols: string[], minutes: number) {
  return chQueryWithStats<CorrelationRow>(
    `SELECT symbol, minute, argMaxMerge(close) AS close
     FROM ohlc_1m_mv
     WHERE symbol IN ({symbols:Array(String)})
       AND minute > now() - INTERVAL {minutes:UInt16} MINUTE
     GROUP BY symbol, minute
     ORDER BY symbol, minute`,
    { symbols, minutes }
  );
}

async function fetchCorrelations(symbols: string[], minutes: number = 720) {
  return chQuery(
    `SELECT symbol, minute, argMaxMerge(close) AS close
     FROM ohlc_1m_mv
     WHERE symbol IN ({symbols:Array(String)})
       AND minute > now() - INTERVAL {minutes:UInt16} MINUTE
     GROUP BY symbol, minute
     ORDER BY symbol, minute`,
    { symbols, minutes }
  );
}

type CorrelationRow = {
  symbol: string;
  minute: string;
  close: number;
};

function noDataVerdict(verdict: string, caption: string, stats: Array<{ label: string; value: string }> = []) {
  return {
    __renderAs: "verdict_card",
    verdict: sanitizeVerdict(verdict),
    confidence: 0.99,
    stats,
    caption,
  };
}

function completeSentence(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function trimDanglingConnector(text: string) {
  const withoutTrailingClause = text.replace(
    /\s+\b(?:because|while|although|though|whereas|with|without|when|where|if|instead of)\b[^.!?;:,]*$/i,
    ""
  );
  const candidate = withoutTrailingClause.length >= 60 ? withoutTrailingClause : text;
  return candidate
    .replace(/[,;:\s]+$/g, "")
    .replace(/\s+\b(?:and|but|or|while|with|without|because|as|at|to|from|by|had|has|was|were|is|are|a|an|the)\b$/i, "")
    .trim();
}

function sanitizeVerdict(verdict: string) {
  const normalized = verdict.replace(/\s+/g, " ").trim();
  if (normalized.length <= VERDICT_MAX_CHARS) return completeSentence(normalized);

  const withinLimit = normalized.slice(0, VERDICT_MAX_CHARS);
  const sentenceEnd = Math.max(withinLimit.lastIndexOf("."), withinLimit.lastIndexOf("!"), withinLimit.lastIndexOf("?"));
  if (sentenceEnd >= 60) return withinLimit.slice(0, sentenceEnd + 1).trim();

  const clauseEnd = Math.max(withinLimit.lastIndexOf(";"), withinLimit.lastIndexOf(":"), withinLimit.lastIndexOf(","));
  if (clauseEnd >= 60) return completeSentence(trimDanglingConnector(withinLimit.slice(0, clauseEnd)));

  const wordEnd = withinLimit.search(/\s+\S*$/);
  const clean = wordEnd >= 60 ? withinLimit.slice(0, wordEnd) : withinLimit;
  return completeSentence(trimDanglingConnector(clean));
}

function compactArray(value: unknown[]) {
  if (value.length <= COMPACT_ARRAY_LIMIT) return value.map(compactLargePayload);
  return {
    __compacted: true,
    rowCount: value.length,
    first: compactLargePayload(value[0]),
    last: compactLargePayload(value[value.length - 1]),
  };
}

function compactLargePayload(value: unknown): unknown {
  if (Array.isArray(value)) return compactArray(value);
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if ((key === "rows" || key === "ohlc") && Array.isArray(child) && child.length > COMPACT_ARRAY_LIMIT) {
      output[key] = compactArray(child);
      continue;
    }
    output[key] = compactLargePayload(child);
  }
  return output;
}

export function compactMarketIntelMessages<T extends { role?: string }>(messages: T[]): T[] {
  const latestUserIndex = messages.map((message) => message.role).lastIndexOf("user");
  if (latestUserIndex <= 0) return messages;

  return messages.map((message, index) => {
    if (index >= latestUserIndex) return message;
    return compactLargePayload(message) as T;
  });
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  const denom = Math.sqrt(varianceX * varianceY);
  return denom > 0 ? covariance / denom : null;
}

function computeCorrelationNetwork(rows: CorrelationRow[], symbols: string[], rollingSamples: number = 60) {
  const closesBySymbol = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const close = Number(row.close);
    if (!Number.isFinite(close) || close <= 0) continue;
    if (!closesBySymbol.has(row.symbol)) closesBySymbol.set(row.symbol, new Map());
    closesBySymbol.get(row.symbol)!.set(row.minute, close);
  }

  const returnsBySymbol = new Map<string, Map<string, number>>();
  for (const symbol of symbols) {
    const points = Array.from(closesBySymbol.get(symbol)?.entries() ?? [])
      .sort(([a], [b]) => a.localeCompare(b));
    const returns = new Map<string, number>();
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1][1];
      const current = points[i][1];
      if (previous > 0 && current > 0) {
        returns.set(points[i][0], Math.log(current / previous));
      }
    }
    returnsBySymbol.set(symbol, returns);
  }

  const correlations: Array<{
    source: string;
    target: string;
    correlation: number;
    samples: number;
    series: Array<{ minute: string; correlation: number; samples: number }>;
  }> = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const source = symbols[i];
      const target = symbols[j];
      const sourceReturns = returnsBySymbol.get(source) ?? new Map();
      const targetReturns = returnsBySymbol.get(target) ?? new Map();
      const aligned: Array<{ minute: string; sourceReturn: number; targetReturn: number }> = [];
      Array.from(sourceReturns.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([minute, sourceReturn]) => {
          const targetReturn = targetReturns.get(minute);
          if (targetReturn !== undefined) {
            aligned.push({ minute, sourceReturn, targetReturn });
          }
        });
      const xs = aligned.map((point) => point.sourceReturn);
      const ys = aligned.map((point) => point.targetReturn);
      const start = Math.max(0, xs.length - rollingSamples);
      const rollingXs = xs.slice(start);
      const rollingYs = ys.slice(start);
      const correlation = pearson(rollingXs, rollingYs);
      if (correlation !== null) {
        const series = aligned
          .map((point, index) => {
            const seriesStart = Math.max(0, index + 1 - rollingSamples);
            const seriesXs = xs.slice(seriesStart, index + 1);
            const seriesYs = ys.slice(seriesStart, index + 1);
            const value = pearson(seriesXs, seriesYs);
            return value === null ? null : { minute: point.minute, correlation: value, samples: seriesXs.length };
          })
          .filter((point): point is { minute: string; correlation: number; samples: number } => point !== null)
          .slice(-80);
        correlations.push({ source, target, correlation, samples: rollingXs.length, series });
      }
    }
  }

  return {
    symbols,
    rows,
    correlations,
    rollingSamples,
    pointsBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, closesBySymbol.get(symbol)?.size ?? 0])),
  };
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

If a query returns no rows, retry once with a shorter, more recent window before concluding data is unavailable — ingestion may have started recently. If the retry also returns no rows, do not render the underlying chart or network; render_verdict_card with an honest no-data verdict.

When the user asks to save an investigation, call save_investigation even if you must create a minimal widget_snapshot from the current request context, then render_verdict_card confirming the save. Do not ask for prose clarification and do not render the underlying investigation widget, chart, heatmap, or network in the same response.

When the user asks to create or set an alert, call set_alert directly. Do not ask for approval yourself with render_verdict_card first; set_alert.needsApproval is the approval mechanism. After set_alert resolves, render_verdict_card confirming the alert status only.

For user requests that ask what trades produced a spread reading, call query_trades_around for the supplied symbol and timestamp before rendering a verdict card.

For render_verdict_card, keep verdict to one complete, short sentence. Put supporting detail in stats and caption; never use verdict as a long explanation.

After a render_* tool call completes, output nothing — the render call is the complete response.

Framing must be structural, not directive. You are not a financial advisor.`;
}

function stepHasNonRenderTool(step: { toolCalls?: Array<{ toolName?: string }> }) {
  return step.toolCalls?.some((call) => {
    const toolName = call.toolName ?? "";
    return toolName.length > 0 && !RENDER_TOOL_NAMES.includes(toolName as (typeof RENDER_TOOL_NAMES)[number]);
  }) ?? false;
}

export function marketIntelStreamControls() {
  return {
    stopWhen: [hasToolCall(...RENDER_TOOL_NAMES), stepCountIs(15)],
    prepareStep: ({ steps }: { steps: Array<{ toolCalls?: Array<{ toolName?: string }> }> }) => {
      const lastStep = steps.at(-1);
      if (!lastStep || !stepHasNonRenderTool(lastStep)) return undefined;
      return {
        activeTools: RENDER_TOOL_NAMES,
        toolChoice: "required" as const,
      };
    },
  };
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
    inputSchema: z.object({ symbol: SYMBOLS, minutes: z.number().max(120).default(20) }),
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

  const query_trades_around = tool({
    description: "Fetch a recent trade tape around a specific timestamp when drilling into a spread or price move.",
    inputSchema: z.object({
      symbol: SYMBOLS,
      at: z.string().datetime(),
      seconds: z.number().int().min(10).max(600).default(60),
    }),
    execute: async ({ symbol, at, seconds }) => fetchTradesAround(symbol, at, seconds),
  });

  const query_correlations = tool({
    description: "Fetch close prices for multiple symbols to compute correlations.",
    inputSchema: z.object({ symbols: z.array(SYMBOLS).max(3), minutes: z.number().max(1440).default(720) }),
    execute: async ({ symbols, minutes }) => fetchCorrelations(symbols, minutes),
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
      const { rows: ohlc, queryStats } = await fetchPriceSeriesWithStats(input.symbol, input.window_start, input.window_end);
      if (ohlc.length === 0) {
        return noDataVerdict(
          `No OHLC data is available for ${input.symbol} in the requested window.`,
          "No chart rendered because ClickHouse returned zero rows.",
          [
            { label: "Symbol", value: input.symbol },
            { label: "Rows", value: "0" },
          ]
        );
      }
      return { input, ohlc, queryStats };
    },
  });

  const render_spread_heatmap = tool({
    description: "Render a cross-exchange spread heatmap.",
    inputSchema: z.object({
      symbol: SYMBOLS,
      minutes: z.number().max(120).default(20),
      caption: z.string().max(160),
    }),
    execute: async (input) => {
      const { rows, queryStats } = await fetchSpreadSeriesWithStats(input.symbol, input.minutes);
      if (rows.length === 0) {
        return noDataVerdict(
          `No cross-exchange spread data is available for ${input.symbol} in the requested window.`,
          "No heatmap rendered because ClickHouse returned zero rows.",
          [
            { label: "Symbol", value: input.symbol },
            { label: "Rows", value: "0" },
          ]
        );
      }
      return { input, rows, queryStats };
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
      const { rows: ohlc, queryStats } = await fetchPriceSeriesWithStats(input.symbol, input.window_start, input.window_end);
      return { input, ohlc, queryStats };
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
      const lookbackMinutes = Math.min(Math.max(Math.round(input.hours * 60), 60), 1440);
      const rollingSamples = 60;
      const { rows, queryStats } = await fetchCorrelationsWithStats(input.symbols, lookbackMinutes);
      if (rows.length === 0) {
        return noDataVerdict(
          `No close series are available for ${input.symbols.join(", ")} in the requested window.`,
          "No correlation network rendered because ClickHouse returned zero rows.",
          [
            { label: "Symbols", value: input.symbols.join(", ") },
            { label: "Rows", value: "0" },
          ]
        );
      }
      return { input: { ...input, lookbackMinutes, rollingSamples }, ...computeCorrelationNetwork(rows, input.symbols, rollingSamples), queryStats };
    },
  });

  const render_verdict_card = tool({
    description: "Render a single-line answer with confidence and optional stats.",
    inputSchema: z.object({
      verdict: z.string().max(500),
      confidence: z.number().min(0).max(1),
      stats: z.array(z.object({ label: z.string(), value: z.string() })).max(4).optional(),
      caption: z.string().max(160),
    }),
    execute: async (input) => ({ ...input, verdict: sanitizeVerdict(input.verdict) }),
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
    query_trades_around,
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
