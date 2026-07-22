import { task, schedules, timeout, runs } from "@trigger.dev/sdk/v3";
import { and, eq, lte } from "drizzle-orm";
import { clickhouse, chQuery } from "@/lib/clickhouse";
import { db } from "@/lib/postgres";
import { alertSubscriptions, hitlApprovals } from "@/lib/schema";
import { WsConnection } from "@/lib/ws-connection";
import {
  parseCoinbaseMatch,
  parseCoinbaseBook,
  parseKrakenTrade,
  parseKrakenBook,
  type TradeRow,
  type BookRow,
} from "@/lib/exchange-parsers";

const COINBASE_PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD"];
const KRAKEN_PAIRS = ["XBT/USD", "ETH/USD", "SOL/USD"];
const COINBASE_WS = "wss://ws-feed.exchange.coinbase.com";
const KRAKEN_WS = "wss://ws.kraken.com";

const HEARTBEAT_STALE_SECONDS = 120;
const ACTIVE_RUN_STATUSES = ["PENDING_VERSION", "QUEUED", "DEQUEUED", "EXECUTING", "WAITING", "DELAYED"] as const;

function nowDateTime64(): string {
  return new Date().toISOString().slice(0, 23).replace("T", " ");
}

async function flush<T extends TradeRow | BookRow>(taskId: string, exchange: string, table: string, rows: T[]) {
  await clickhouse.insert({ table, values: rows, format: "JSONEachRow" });
  await clickhouse.insert({
    table: "ingest_heartbeats",
    values: [{ task: taskId, exchange, flushed_rows: rows.length, flushed_at: nowDateTime64() }],
    format: "JSONEachRow",
  });
}

async function cancelActiveRuns(taskId: string) {
  const page = await runs.list({
    taskIdentifier: taskId,
    status: [...ACTIVE_RUN_STATUSES],
    period: "1d",
  });
  const cancelled: string[] = [];
  for (const run of page.data) {
    await runs.cancel(run.id);
    cancelled.push(run.id);
  }
  return cancelled;
}

export const ingestTradesWs = task({
  id: "ingest-trades-ws",
  maxDuration: timeout.None,
  queue: { concurrencyLimit: 1 },
  run: async (_payload: unknown, { signal }) => {
    const connections = [
      new WsConnection<TradeRow>({
        name: "coinbase-trades",
        url: COINBASE_WS,
        subscribe: () => ({ type: "subscribe", product_ids: COINBASE_PRODUCTS, channels: ["matches"] }),
        parser: parseCoinbaseMatch,
        onBatch: (rows) => flush("ingest-trades-ws", "coinbase", "trades", rows),
      }),
      new WsConnection<TradeRow>({
        name: "kraken-trades",
        url: KRAKEN_WS,
        subscribe: () => ({ event: "subscribe", pair: KRAKEN_PAIRS, subscription: { name: "trade" } }),
        parser: parseKrakenTrade,
        onBatch: (rows) => flush("ingest-trades-ws", "kraken", "trades", rows),
      }),
    ];
    for (const conn of connections) conn.connect();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    for (const conn of connections) conn.close();
  },
});

export const ingestBookWs = task({
  id: "ingest-book-ws",
  maxDuration: timeout.None,
  queue: { concurrencyLimit: 1 },
  run: async (_payload: unknown, { signal }) => {
    const connections = [
      new WsConnection<BookRow>({
        name: "coinbase-book",
        url: COINBASE_WS,
        // level2 requires auth; the public ticker channel carries best bid/ask
        subscribe: () => ({ type: "subscribe", product_ids: COINBASE_PRODUCTS, channels: ["ticker"] }),
        parser: parseCoinbaseBook,
        onBatch: (rows) => flush("ingest-book-ws", "coinbase", "book_snapshots", rows),
      }),
      new WsConnection<BookRow>({
        name: "kraken-book",
        url: KRAKEN_WS,
        subscribe: () => ({ event: "subscribe", pair: KRAKEN_PAIRS, subscription: { name: "book", depth: 25 } }),
        parser: parseKrakenBook,
        onBatch: (rows) => flush("ingest-book-ws", "kraken", "book_snapshots", rows),
      }),
    ];
    for (const conn of connections) conn.connect();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    for (const conn of connections) conn.close();
  },
});

export const ingestionWatchdog = schedules.task({
  id: "ingestion-watchdog",
  cron: "*/2 * * * *",
  run: async () => {
    const heartbeats = await chQuery<{ task: string; last_flush: string }>(
      `SELECT task, max(flushed_at) AS last_flush
       FROM ingest_heartbeats
       WHERE flushed_at > now() - INTERVAL 1 DAY
       GROUP BY task`
    );
    const lastByTask = new Map(heartbeats.map((h) => [h.task, new Date(h.last_flush.replace(" ", "T") + "Z")]));

    const restarted: string[] = [];
    const taskStatuses: Array<{ id: string; last_flush?: string; age_seconds?: number; stale: boolean; runId?: string }> = [];
    const ingestTasks = [
      { id: "ingest-trades-ws", handle: ingestTradesWs },
      { id: "ingest-book-ws", handle: ingestBookWs },
    ] as const;

    for (const { id, handle } of ingestTasks) {
      const last = lastByTask.get(id);
      const ageMs = last ? Date.now() - last.getTime() : undefined;
      const stale = !last || ageMs! > HEARTBEAT_STALE_SECONDS * 1000;
      const status = {
        id,
        last_flush: last?.toISOString(),
        age_seconds: ageMs === undefined ? undefined : Math.round(ageMs / 1000),
        stale,
        runId: undefined as string | undefined,
      };
      if (stale) {
        const cancelled = await cancelActiveRuns(id);
        const run = await handle.trigger({});
        status.runId = run.id;
        if (cancelled.length > 0) status.runId = `${run.id} after cancelling ${cancelled.length}`;
        restarted.push(id);
      }
      taskStatuses.push(status);
    }
    console.log("ingestion-watchdog", { restarted, taskStatuses });
    return { restarted, heartbeats, taskStatuses };
  },
});

type DetectedEvent = {
  symbol: string;
  event_type: "volatility_spike" | "volume_spike";
  window_start: string;
  window_end: string;
  severity: number;
  detail: string;
};

export const detectEvents = schedules.task({
  id: "detect-events",
  cron: "* * * * *",
  run: async () => {
    const rows = await chQuery<{
      symbol: string;
      last_ret: number;
      vol: number;
      last_volume: number;
      avg_volume: number;
      window_end: string;
    }>(
      `WITH closes AS (
        SELECT symbol, minute, argMaxMerge(close) AS close, sumMerge(volume) AS volume
        FROM ohlc_1m_mv
        WHERE minute > now() - INTERVAL 60 MINUTE
        GROUP BY symbol, minute
      ),
      rets AS (
        SELECT symbol, minute, volume,
          close / lagInFrame(close, 1) OVER (
            PARTITION BY symbol ORDER BY minute ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) - 1 AS ret
        FROM closes
      )
      SELECT symbol,
        argMax(ret, minute) AS last_ret,
        stddevPop(ret) AS vol,
        argMax(volume, minute) AS last_volume,
        avg(volume) AS avg_volume,
        max(minute) AS window_end
      FROM rets
      WHERE isFinite(ret)
      GROUP BY symbol`
    );

    const events: DetectedEvent[] = [];
    for (const r of rows) {
      const windowStart = new Date(new Date(r.window_end.replace(" ", "T") + "Z").getTime() - 60_000)
        .toISOString().slice(0, 23).replace("T", " ");
      if (r.vol > 0) {
        const severity = Math.abs(r.last_ret) / r.vol;
        if (severity >= 3) {
          events.push({
            symbol: r.symbol,
            event_type: "volatility_spike",
            window_start: windowStart,
            window_end: r.window_end,
            severity,
            detail: JSON.stringify({ last_ret: r.last_ret, trailing_stddev: r.vol }),
          });
        }
      }
      if (r.avg_volume > 0) {
        const severity = r.last_volume / r.avg_volume;
        if (severity >= 5) {
          events.push({
            symbol: r.symbol,
            event_type: "volume_spike",
            window_start: windowStart,
            window_end: r.window_end,
            severity,
            detail: JSON.stringify({ last_volume: r.last_volume, avg_volume: r.avg_volume }),
          });
        }
      }
    }

    if (events.length > 0) {
      await clickhouse.insert({ table: "events", values: events, format: "JSONEachRow" });
      for (const event of events) {
        await alertFanout.trigger({
          symbol: event.symbol,
          event_type: event.event_type,
          severity: event.severity,
        });
      }
    }
    return { scanned: rows.length, fired: events.length };
  },
});

export const alertFanout = task({
  id: "alert-fanout",
  run: async (payload: { symbol: string; event_type: string; severity: number }) => {
    const subs = await db
      .select()
      .from(alertSubscriptions)
      .where(
        and(
          eq(alertSubscriptions.active, true),
          eq(alertSubscriptions.symbol, payload.symbol),
          eq(alertSubscriptions.eventType, payload.event_type),
          lte(alertSubscriptions.minSeverity, payload.severity)
        )
      );
    for (const sub of subs) {
      await db.insert(hitlApprovals).values({
        userId: sub.userId,
        chatId: `alert:${sub.id}`,
        toolName: "alert_notification",
        toolInput: payload,
        status: "pending",
      });
    }
    return { matched: subs.length };
  },
});
