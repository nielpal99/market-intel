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
  const data = m[1];
  const bidSide = data.bs ?? data.b;
  const askSide = data.as ?? data.a;
  if (!Array.isArray(bidSide) || !Array.isArray(askSide) || !bidSide[0] || !askSide[0]) return null;
  const bid = bidSide[0];
  const ask = askSide[0];
  const ts = bid[2] ?? ask[2];
  return {
    exchange: "kraken",
    symbol: pair,
    timestamp: toDateTime64(ts),
    best_bid: Number(bid[0]),
    best_ask: Number(ask[0]),
    bid_size: Number(bid[1]),
    ask_size: Number(ask[1]),
  };
}
