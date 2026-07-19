import { readFileSync } from "node:fs";
import {
  parseCoinbaseMatch,
  parseCoinbaseBook,
  parseKrakenTrade,
  parseKrakenBook,
  TradeRow,
  BookRow,
} from "../../src/lib/exchange-parsers.ts";

const FIXTURES = "/Users/nielpal/market-intel/src/lib/__fixtures__";

const SYMBOLS = new Set(["BTC-USD", "ETH-USD", "SOL-USD"]);
const SIDES = new Set(["buy", "sell"]);
const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

function assertTrade(r: TradeRow, label: string) {
  if (typeof r.exchange !== "string" || r.exchange.length === 0) throw new Error(`${label}: bad exchange`);
  if (!SYMBOLS.has(r.symbol)) throw new Error(`${label}: bad symbol ${r.symbol}`);
  if (typeof r.trade_id !== "string" || r.trade_id.length === 0) throw new Error(`${label}: bad trade_id`);
  if (!Number.isFinite(r.price) || r.price <= 0) throw new Error(`${label}: bad price ${r.price}`);
  if (!Number.isFinite(r.size) || r.size <= 0) throw new Error(`${label}: bad size ${r.size}`);
  if (!SIDES.has(r.side)) throw new Error(`${label}: bad side ${r.side}`);
  if (typeof r.timestamp !== "string" || !TS_RE.test(r.timestamp)) throw new Error(`${label}: bad timestamp ${r.timestamp}`);
}

function assertBook(r: BookRow, label: string) {
  if (typeof r.exchange !== "string" || r.exchange.length === 0) throw new Error(`${label}: bad exchange`);
  if (!SYMBOLS.has(r.symbol)) throw new Error(`${label}: bad symbol ${r.symbol}`);
  if (typeof r.timestamp !== "string" || !TS_RE.test(r.timestamp)) throw new Error(`${label}: bad timestamp ${r.timestamp}`);
  if (!Number.isFinite(r.best_bid) || !Number.isFinite(r.best_ask)) throw new Error(`${label}: non-numeric bid/ask`);
  if (r.best_bid >= r.best_ask) throw new Error(`${label}: best_bid >= best_ask`);
  if (r.bid_size <= 0 || r.ask_size <= 0) throw new Error(`${label}: non-positive sizes`);
}

const coinbase = JSON.parse(readFileSync(`${FIXTURES}/coinbase-samples.json`, "utf8"));
const coinbaseBook = JSON.parse(readFileSync(`${FIXTURES}/coinbase-book-samples.json`, "utf8"));
const kraken = JSON.parse(readFileSync(`${FIXTURES}/kraken-samples.json`, "utf8"));

let passed = 0;
let failed = 0;

function test<T>(label: string, fn: () => T, check?: (v: T) => void) {
  try {
    const v = fn();
    if (check) check(v);
    passed++;
    console.log(`PASS ${label}`);
  } catch (err: any) {
    failed++;
    console.log(`FAIL ${label}: ${err.message}`);
  }
}

// Coinbase matches
for (let i = 0; i < coinbase.matches.length; i++) {
  test(`coinbase match ${i}`, () => parseCoinbaseMatch(coinbase.matches[i]), (r) => { if (!r) throw new Error("returned null"); assertTrade(r, `cb-match-${i}`); });
}

// Coinbase book from level2 snapshot/ticker
for (let i = 0; i < coinbaseBook.level2_snapshot.length; i++) {
  test(`coinbase book snapshot ${i}`, () => parseCoinbaseBook(coinbaseBook.level2_snapshot[i]), (r) => { if (!r) throw new Error("returned null"); assertBook(r, `cb-snap-${i}`); });
}
for (let i = 0; i < coinbaseBook.ticker.length; i++) {
  test(`coinbase ticker ${i}`, () => parseCoinbaseBook(coinbaseBook.ticker[i]), (r) => { if (!r) throw new Error("returned null"); assertBook(r, `cb-ticker-${i}`); });
}
for (let i = 0; i < Math.min(coinbaseBook.level2_update.length, 3); i++) {
  test(`coinbase l2update ${i} (ignored)`, () => parseCoinbaseBook(coinbaseBook.level2_update[i]), (r) => { if (r) throw new Error("expected null for l2update"); });
}

// Kraken trades
for (let i = 0; i < kraken.trades.length; i++) {
  test(`kraken trade ${i}`, () => parseKrakenTrade(kraken.trades[i]), (rows) => {
    if (rows.length === 0) throw new Error("expected at least one trade row");
    rows.forEach((r, j) => assertTrade(r, `kr-trade-${i}-${j}`));
  });
}

// Kraken book from snapshots
for (let i = 0; i < kraken.book_snapshot.length; i++) {
  test(`kraken book snapshot ${i}`, () => parseKrakenBook(kraken.book_snapshot[i]), (r) => { if (!r) throw new Error("returned null"); assertBook(r, `kr-snap-${i}`); });
}
for (let i = 0; i < Math.min(kraken.book_update.length, 3); i++) {
  test(`kraken book update ${i} (ignored)`, () => parseKrakenBook(kraken.book_update[i]), (r) => { if (r) throw new Error("expected null for book update without state"); });
}

console.log(`\nTotal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
