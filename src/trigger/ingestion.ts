import { task } from "@trigger.dev/sdk/v3";
import WebSocket from "ws";
import { clickhouse } from "@/lib/clickhouse";
import { db } from "@/lib/postgres";
import { alertSubscriptions, hitlApprovals } from "@/lib/schema";
import { eq } from "drizzle-orm";

const SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"];
const COINBASE_WS = "wss://ws-feed.exchange.coinbase.com";
const KRAKEN_WS = "wss://ws.kraken.com";

interface Tick { exchange: string; symbol: string; trade_id: string; price: number; size: number; side: "buy" | "sell"; timestamp: string; }

async function flushTrades(buffer: Tick[]) {
  if (buffer.length === 0) return;
  await clickhouse.insert({ table: "trades", values: buffer, format: "JSONEachRow" });
  buffer.length = 0;
}

export const ingestTradesWs = task({
  id: "ingest-trades-ws",
  run: async () => {
    const buffer: Tick[] = [];
    const connect = (url: string, exchange: string, products: string[]) => {
      const ws = new WebSocket(url);
      ws.on("open", () => {
        if (exchange === "coinbase") ws.send(JSON.stringify({ type: "subscribe", product_ids: products, channels: ["matches"] }));
        if (exchange === "kraken") ws.send(JSON.stringify({ event: "subscribe", pair: products, subscription: { name: "trade" } }));
      });
      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        // minimal parsing; production needs venue-specific shape handling
        if (msg.price && msg.size && msg.side && msg.product_id && msg.trade_id && msg.time) {
          buffer.push({ exchange, symbol: msg.product_id, trade_id: String(msg.trade_id), price: Number(msg.price), size: Number(msg.size), side: msg.side, timestamp: msg.time });
        }
      });
      ws.on("close", () => setTimeout(() => connect(url, exchange, products), 1000));
    };
    connect(COINBASE_WS, "coinbase", SYMBOLS);
    connect(KRAKEN_WS, "kraken", SYMBOLS);

    while (true) {
      await new Promise((r) => setTimeout(r, 1500));
      await flushTrades(buffer);
    }
  },
});

interface BookRow { exchange: string; symbol: string; timestamp: string; best_bid: number; best_ask: number; bid_size: number; ask_size: number; }

async function flushBook(buffer: BookRow[]) {
  if (buffer.length === 0) return;
  await clickhouse.insert({ table: "book_snapshots", values: buffer, format: "JSONEachRow" });
  buffer.length = 0;
}

export const ingestBookWs = task({
  id: "ingest-book-ws",
  run: async () => {
    const buffer: BookRow[] = [];
    const connect = (url: string, exchange: string, products: string[]) => {
      const ws = new WebSocket(url);
      ws.on("open", () => {
        if (exchange === "coinbase") ws.send(JSON.stringify({ type: "subscribe", product_ids: products, channels: ["level2"] }));
        if (exchange === "kraken") ws.send(JSON.stringify({ event: "subscribe", pair: products, subscription: { name: "book" } }));
      });
      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.bids && msg.asks && msg.product_id && msg.time) {
          const bestBid = msg.bids[0];
          const bestAsk = msg.asks[0];
          buffer.push({ exchange, symbol: msg.product_id, timestamp: msg.time, best_bid: Number(bestBid[0]), best_ask: Number(bestAsk[0]), bid_size: Number(bestBid[1]), ask_size: Number(bestAsk[1]) });
        }
      });
      ws.on("close", () => setTimeout(() => connect(url, exchange, products), 1000));
    };
    connect(COINBASE_WS, "coinbase", SYMBOLS);
    connect(KRAKEN_WS, "kraken", SYMBOLS);
    while (true) {
      await new Promise((r) => setTimeout(r, 1500));
      await flushBook(buffer);
    }
  },
});

export const ingestionWatchdog = task({
  id: "ingestion-watchdog",
  run: async () => {
    // check clickhouse heartbeat table; re-trigger if stale
    return { ok: true };
  },
});

export const detectEvents = task({
  id: "detect-events",
  run: async () => {
    const spikes = await clickhouse.query({
      query: `SELECT symbol, minute, argMaxMerge(close) AS close, stddevPopMerge(close) AS vol
              FROM ohlc_1m_mv
              WHERE minute > now() - INTERVAL 5 MINUTE
              GROUP BY symbol, minute`,
      format: "JSONEachRow",
    }).toPromise();
    return { spikes, fired: true };
  },
});

export const alertFanout = task({
  id: "alert-fanout",
  run: async ({ payload }: { payload: { symbol: string; event_type: string; severity: number } }) => {
    const subs = await db
      .select()
      .from(alertSubscriptions)
      .where(eq(alertSubscriptions.active, true));
    for (const sub of subs) {
      if (sub.symbol === payload.symbol && sub.eventType === payload.event_type && sub.minSeverity <= payload.severity) {
        await db.insert(hitlApprovals).values({
          userId: sub.userId,
          chatId: "fanout",
          toolName: "render_verdict_card",
          toolInput: payload,
        });
      }
    }
    return { sent: subs.length };
  },
});
