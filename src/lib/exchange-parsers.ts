export interface TradeRow {
  exchange: string;
  symbol: string;
  trade_id: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  timestamp: string; // ClickHouse DateTime64(3) friendly: "YYYY-MM-DD HH:MM:SS.mmm"
}

export interface BookRow {
  exchange: string;
  symbol: string;
  timestamp: string;
  best_bid: number;
  best_ask: number;
  bid_size: number;
  ask_size: number;
}

function toDateTime64(isoOrSeconds: string | number): string {
  const s = String(isoOrSeconds);
  const d = /^\d+(\.\d+)?$/.test(s) ? new Date(Number(s) * 1000) : new Date(s);
  return d.toISOString().slice(0, 23).replace("T", " ");
}

function toEpochMs(isoOrSeconds: string | number): number {
  const s = String(isoOrSeconds);
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) * 1000 : new Date(s).getTime();
}

const KRAKEN_PAIR_MAP: Record<string, string> = {
  "XBT/USD": "BTC-USD",
  "BTC/USD": "BTC-USD",
  "ETH/USD": "ETH-USD",
  "SOL/USD": "SOL-USD",
};

function normalizeKrakenPair(pair: string): string {
  return KRAKEN_PAIR_MAP[pair] ?? pair.replace("/", "-").replace("XBT", "BTC");
}

function mapKrakenSide(side: string): "buy" | "sell" {
  if (side === "b" || side === "buy") return "buy";
  if (side === "s" || side === "sell") return "sell";
  throw new Error(`Unknown Kraken side: ${side}`);
}

type KrakenBookLevel = { size: number; timestamp: string };
type KrakenBookState = {
  bids: Map<number, KrakenBookLevel>;
  asks: Map<number, KrakenBookLevel>;
  lastEmittedAtMs?: number;
};

const krakenBookStateBySymbol = new Map<string, KrakenBookState>();

function getKrakenBookState(symbol: string): KrakenBookState {
  let state = krakenBookStateBySymbol.get(symbol);
  if (!state) {
    state = { bids: new Map(), asks: new Map() };
    krakenBookStateBySymbol.set(symbol, state);
  }
  return state;
}

function applyKrakenLevels(side: Map<number, KrakenBookLevel>, levels: unknown): string | undefined {
  if (!Array.isArray(levels)) return undefined;
  let lastTimestamp: string | undefined;
  for (const level of levels) {
    if (!Array.isArray(level) || level.length < 3) continue;
    const price = Number(level[0]);
    const size = Number(level[1]);
    const timestamp = String(level[2]);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    lastTimestamp = timestamp;
    if (size === 0) {
      side.delete(price);
    } else {
      side.set(price, { size, timestamp });
    }
  }
  return lastTimestamp;
}

function bestKrakenLevel(
  side: Map<number, KrakenBookLevel>,
  better: (candidate: number, current: number) => boolean
): [number, KrakenBookLevel] | undefined {
  let best: [number, KrakenBookLevel] | undefined;
  side.forEach((level, price) => {
    if (!best || better(price, best[0])) best = [price, level];
  });
  return best;
}

function pruneKrakenLevels(side: Map<number, KrakenBookLevel>, shouldPrune: (price: number) => boolean): void {
  const prices: number[] = [];
  side.forEach((_level, price) => {
    if (shouldPrune(price)) prices.push(price);
  });
  for (const price of prices) side.delete(price);
}

function repairKrakenCrossedBook(state: KrakenBookState, updatedBid: boolean, updatedAsk: boolean): void {
  for (let i = 0; i < 2; i++) {
    const bid = bestKrakenLevel(state.bids, (candidate, current) => candidate > current);
    const ask = bestKrakenLevel(state.asks, (candidate, current) => candidate < current);
    if (!bid || !ask || bid[0] < ask[0]) return;
    if (updatedAsk) pruneKrakenLevels(state.bids, (price) => price >= ask[0]);
    if (updatedBid) pruneKrakenLevels(state.asks, (price) => price <= bid[0]);
    if (!updatedBid && !updatedAsk) return;
  }
}

export function parseCoinbaseMatch(msg: unknown): TradeRow | null {
  const m = msg as any;
  if (m?.type !== "match" && m?.type !== "last_match") return null;
  return {
    exchange: "coinbase",
    symbol: m.product_id,
    trade_id: String(m.trade_id ?? ""),
    price: Number(m.price),
    size: Number(m.size),
    side: m.side,
    timestamp: toDateTime64(m.time),
  };
}

export function parseCoinbaseBook(msg: unknown): BookRow | null {
  const m = msg as any;
  if (m?.type === "snapshot" && Array.isArray(m.bids) && Array.isArray(m.asks) && m.bids[0] && m.asks[0]) {
    return {
      exchange: "coinbase",
      symbol: m.product_id,
      timestamp: toDateTime64(Date.now() / 1000),
      best_bid: Number(m.bids[0][0]),
      best_ask: Number(m.asks[0][0]),
      bid_size: Number(m.bids[0][1]),
      ask_size: Number(m.asks[0][1]),
    };
  }
  if (m?.type === "ticker" && m.best_bid && m.best_ask) {
    return {
      exchange: "coinbase",
      symbol: m.product_id,
      timestamp: toDateTime64(m.time),
      best_bid: Number(m.best_bid),
      best_ask: Number(m.best_ask),
      bid_size: Number(m.best_bid_size),
      ask_size: Number(m.best_ask_size),
    };
  }
  // l2update requires maintaining a full order book; not supported as a single-message parser.
  return null;
}

export function parseKrakenTrade(msg: unknown): TradeRow[] {
  const m = msg as any;
  if (!Array.isArray(m) || m.length < 4) return [];
  const channelName = m[m.length - 2];
  if (typeof channelName !== "string" || !channelName.startsWith("trade")) return [];
  const pair = normalizeKrakenPair(m[m.length - 1]);
  const rows = m[1];
  if (!Array.isArray(rows)) return [];
  return rows.map((t: any, i: number) => ({
    exchange: "kraken",
    symbol: pair,
    trade_id: `${pair}@${t[2]}@${t[0]}@${t[1]}@${t[3]}@${i}`,
    price: Number(t[0]),
    size: Number(t[1]),
    side: mapKrakenSide(t[3]),
    timestamp: toDateTime64(t[2]),
  }));
}

export function parseKrakenBook(msg: unknown): BookRow | null {
  const m = msg as any;
  if (!Array.isArray(m) || m.length < 4) return null;
  const channelName = m[m.length - 2];
  if (typeof channelName !== "string" || !channelName.startsWith("book")) return null;
  const pair = normalizeKrakenPair(m[m.length - 1]);

  const state = getKrakenBookState(pair);
  let bidTimestamp: string | undefined;
  let askTimestamp: string | undefined;

  for (let i = 1; i < m.length - 2; i++) {
    const data = m[i];
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    bidTimestamp = applyKrakenLevels(state.bids, data.bs ?? data.b) ?? bidTimestamp;
    askTimestamp = applyKrakenLevels(state.asks, data.as ?? data.a) ?? askTimestamp;
  }
  if (!bidTimestamp && !askTimestamp) return null;
  repairKrakenCrossedBook(state, Boolean(bidTimestamp), Boolean(askTimestamp));

  const bid = bestKrakenLevel(state.bids, (candidate, current) => candidate > current);
  const ask = bestKrakenLevel(state.asks, (candidate, current) => candidate < current);
  if (!bid || !ask) return null;
  if (bid[0] >= ask[0]) return null;

  const ts = bidTimestamp ?? askTimestamp ?? bid[1].timestamp ?? ask[1].timestamp;
  const tsMs = toEpochMs(ts);
  if (state.lastEmittedAtMs !== undefined && Number.isFinite(tsMs) && tsMs - state.lastEmittedAtMs < 1000) {
    return null;
  }
  if (Number.isFinite(tsMs)) state.lastEmittedAtMs = tsMs;

  return {
    exchange: "kraken",
    symbol: pair,
    timestamp: toDateTime64(ts),
    best_bid: bid[0],
    best_ask: ask[0],
    bid_size: bid[1].size,
    ask_size: ask[1].size,
  };
}
