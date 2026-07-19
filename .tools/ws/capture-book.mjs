import WebSocket from "ws";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FIXTURES_DIR = new URL("../../src/lib/__fixtures__/", import.meta.url).pathname;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureCoinbaseBook() {
  const samples = { level2_snapshot: [], level2_update: [], ticker: [], raw: [] };
  return new Promise((resolve) => {
    const ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
    let done = false;
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "subscribe",
        product_ids: ["BTC-USD", "ETH-USD", "SOL-USD"],
        channels: ["level2", "level2_batch", "ticker"],
      }));
    });
    ws.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf.toString());
        samples.raw.push(msg);
        if (msg.type === "snapshot") {
          if (samples.level2_snapshot.length < 2) samples.level2_snapshot.push(msg);
        } else if (msg.type === "l2update") {
          if (samples.level2_update.length < 10) samples.level2_update.push(msg);
        } else if (msg.type === "ticker") {
          if (samples.ticker.length < 10) samples.ticker.push(msg);
        }
      } catch {}
    });
    ws.on("error", (err) => console.error("Coinbase WS error:", err.message));
    ws.on("close", () => { if (!done) { done = true; resolve(samples); } });
    setTimeout(() => { if (!done) { done = true; ws.close(); sleep(2000).then(() => resolve(samples)); } }, 30_000);
  });
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  const book = await captureCoinbaseBook();
  await writeFile(join(FIXTURES_DIR, "coinbase-book-samples.json"), JSON.stringify(book, null, 2));
  console.log("Coinbase book samples:", {
    level2_snapshot: book.level2_snapshot.length,
    level2_update: book.level2_update.length,
    ticker: book.ticker.length,
    raw_total: book.raw.length,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
