import { WsConnection } from "../../src/lib/ws-connection.ts";
import {
  parseCoinbaseMatch,
  parseCoinbaseBook,
  parseKrakenTrade,
  parseKrakenBook,
  TradeRow,
  BookRow,
} from "../../src/lib/exchange-parsers.ts";

type Row = TradeRow | BookRow;

function parseCoinbaseMessage(msg: unknown): Row | Row[] | null {
  const match = parseCoinbaseMatch(msg);
  if (match) return match;
  const book = parseCoinbaseBook(msg);
  if (book) return book;
  return null;
}

function parseKrakenMessage(msg: unknown): Row | Row[] | null {
  const trades = parseKrakenTrade(msg);
  if (trades.length) return trades;
  const book = parseKrakenBook(msg);
  if (book) return book;
  return null;
}

function makeFeed(
  name: string,
  url: string,
  subscribe: () => (string | object)[],
  parser: (msg: unknown) => Row | Row[] | null
) {
  const events: { type: string; at: number; detail?: unknown }[] = [];
  const batches: { at: number; size: number }[] = [];
  const rows: Row[] = [];

  const conn = new WsConnection<Row>({
    name,
    url,
    subscribe,
    parser,
    flushIntervalMs: 2000,
    maxBufferSize: 500,
    initialBackoffMs: 1000,
    maxBackoffMs: 30000,
    onConnect: () => events.push({ type: "connect", at: Date.now() }),
    onDisconnect: () => events.push({ type: "disconnect", at: Date.now() }),
    onBatch: async (batch) => {
      batches.push({ at: Date.now(), size: batch.length });
      rows.push(...batch);
    },
  });

  return { conn, events, batches, rows };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const coinbase = makeFeed(
    "coinbase",
    "wss://ws-feed.exchange.coinbase.com",
    () => [
      { type: "subscribe", product_ids: ["BTC-USD", "ETH-USD", "SOL-USD"], channels: ["matches", "level2_batch", "ticker"] },
    ],
    parseCoinbaseMessage
  );

  const kraken = makeFeed(
    "kraken",
    "wss://ws.kraken.com",
    () => [
      { event: "subscribe", pair: ["XBT/USD", "ETH/USD", "SOL/USD"], subscription: { name: "trade" } },
      { event: "subscribe", pair: ["XBT/USD", "ETH/USD", "SOL/USD"], subscription: { name: "book", depth: 25 } },
    ],
    parseKrakenMessage
  );

  coinbase.conn.connect();
  kraken.conn.connect();

  await sleep(15_000);
  const forceAt = Date.now();
  console.log("\n--- forcing disconnect ---\n");
  coinbase.conn.forceReconnect();
  kraken.conn.forceReconnect();

  await sleep(35_000);
  coinbase.conn.close();
  kraken.conn.close();
  await sleep(2_000); // let final flushes and close events settle

  const report = (feed: typeof coinbase, force: number) => {
    const connects = feed.events.filter((e) => e.type === "connect");
    const disconnects = feed.events.filter((e) => e.type === "disconnect");
    const reconnect = connects.find((c) => c.at > force);
    const reconnectMs = reconnect ? reconnect.at - force : null;
    return {
      connects: connects.length,
      disconnects: disconnects.length,
      totalRows: feed.rows.length,
      batches: feed.batches.length,
      firstBatchAt: feed.batches[0]?.at,
      lastBatchAt: feed.batches[feed.batches.length - 1]?.at,
      reconnectMs,
      batchesBeforeForce: feed.batches.filter((b) => b.at < force).length,
      batchesAfterReconnect: reconnect ? feed.batches.filter((b) => b.at > reconnect.at).length : 0,
    };
  };

  console.log("\n=== Coinbase ===");
  console.log(report(coinbase, forceAt));
  console.log("\n=== Kraken ===");
  console.log(report(kraken, forceAt));
  console.log("\n=== Sample rows ===");
  console.log("Coinbase first row:", coinbase.rows[0]);
  console.log("Kraken first row:", kraken.rows[0]);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
