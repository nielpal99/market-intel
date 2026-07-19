import WebSocket from "ws";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FIXTURES_DIR = new URL("../../src/lib/__fixtures__/", import.meta.url).pathname;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureCoinbase() {
  const samples = { matches: [], level2_snapshot: [], level2_update: [] };
  return new Promise((resolve) => {
    const ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
    let done = false;
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "subscribe",
        product_ids: ["BTC-USD", "ETH-USD", "SOL-USD"],
        channels: ["matches", "level2"],
      }));
    });
    ws.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === "match" || msg.type === "last_match") {
          if (samples.matches.length < 15) samples.matches.push(msg);
        } else if (msg.type === "snapshot") {
          if (samples.level2_snapshot.length < 2) samples.level2_snapshot.push(msg);
        } else if (msg.type === "l2update") {
          if (samples.level2_update.length < 10) samples.level2_update.push(msg);
        }
      } catch {}
    });
    ws.on("error", (err) => console.error("Coinbase WS error:", err.message));
    ws.on("close", () => { if (!done) { done = true; resolve(samples); } });
    setTimeout(() => { if (!done) { done = true; ws.close(); sleep(2000).then(() => resolve(samples)); } }, 120_000);
  });
}

async function captureKraken() {
  const samples = { trades: [], book_snapshot: [], book_update: [] };
  return new Promise((resolve) => {
    const ws = new WebSocket("wss://ws.kraken.com");
    let done = false;
    ws.on("open", () => {
      const pairs = ["XBT/USD", "ETH/USD", "SOL/USD"];
      ws.send(JSON.stringify({ event: "subscribe", pair: pairs, subscription: { name: "trade" } }));
      ws.send(JSON.stringify({ event: "subscribe", pair: pairs, subscription: { name: "book", depth: 25 } }));
    });
    ws.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (Array.isArray(msg) && msg.length >= 4) {
          const channelName = msg[msg.length - 2];
          const data = msg[1];
          if (typeof channelName === "string" && channelName.startsWith("trade")) {
            if (samples.trades.length < 15) samples.trades.push(msg);
          } else if (typeof channelName === "string" && channelName.startsWith("book")) {
            if (data.as || data.bs) {
              if (samples.book_snapshot.length < 2) samples.book_snapshot.push(msg);
            } else if (data.a || data.b) {
              if (samples.book_update.length < 10) samples.book_update.push(msg);
            }
          }
        }
      } catch {}
    });
    ws.on("error", (err) => console.error("Kraken WS error:", err.message));
    ws.on("close", () => { if (!done) { done = true; resolve(samples); } });
    setTimeout(() => { if (!done) { done = true; ws.close(); sleep(2000).then(() => resolve(samples)); } }, 120_000);
  });
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  const [coinbase, kraken] = await Promise.all([captureCoinbase(), captureKraken()]);
  await writeFile(join(FIXTURES_DIR, "coinbase-samples.json"), JSON.stringify(coinbase, null, 2));
  await writeFile(join(FIXTURES_DIR, "kraken-samples.json"), JSON.stringify(kraken, null, 2));
  console.log("Captured:", {
    coinbase: { matches: coinbase.matches.length, snapshots: coinbase.level2_snapshot.length, updates: coinbase.level2_update.length },
    kraken: { trades: kraken.trades.length, snapshots: kraken.book_snapshot.length, updates: kraken.book_update.length },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
