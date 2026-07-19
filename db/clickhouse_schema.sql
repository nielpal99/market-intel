CREATE TABLE trades (
    exchange String,
    symbol String,
    trade_id String,
    price Float64,
    size Float64,
    side Enum8('buy'=1,'sell'=2),
    timestamp DateTime64(3)
) ENGINE = MergeTree
ORDER BY (symbol, exchange, timestamp);

CREATE TABLE book_snapshots (
    exchange String,
    symbol String,
    timestamp DateTime64(3),
    best_bid Float64,
    best_ask Float64,
    bid_size Float64,
    ask_size Float64
) ENGINE = MergeTree
ORDER BY (symbol, exchange, timestamp);

CREATE MATERIALIZED VIEW ohlc_1m_mv
ENGINE = AggregatingMergeTree
ORDER BY (symbol, exchange, minute)
AS SELECT
    symbol, exchange,
    toStartOfMinute(timestamp) AS minute,
    argMinState(price, timestamp) AS open,
    maxState(price) AS high,
    minState(price) AS low,
    argMaxState(price, timestamp) AS close,
    sumState(size) AS volume
FROM trades
GROUP BY symbol, exchange, minute;

CREATE VIEW cross_exchange_spread AS
SELECT
    a.symbol,
    a.timestamp,
    a.exchange AS exchange_a, a.best_bid AS bid_a, a.best_ask AS ask_a,
    b.exchange AS exchange_b, b.best_bid AS bid_b, b.best_ask AS ask_b,
    (a.best_bid - b.best_ask) AS spread_a_over_b
FROM book_snapshots a
INNER JOIN book_snapshots b
    ON a.symbol = b.symbol AND a.exchange != b.exchange
    AND abs(a.timestamp - b.timestamp) < 2;

CREATE TABLE ingest_heartbeats (
    task String,
    exchange String,
    flushed_rows UInt32,
    flushed_at DateTime64(3)
) ENGINE = MergeTree
ORDER BY (task, flushed_at)
TTL toDateTime(flushed_at) + INTERVAL 3 DAY;

CREATE TABLE events (
    symbol String,
    event_type Enum8('volatility_spike'=1,'spread_anomaly'=2,'volume_spike'=3),
    window_start DateTime64(3),
    window_end DateTime64(3),
    severity Float64,
    detail String
) ENGINE = MergeTree
ORDER BY (symbol, window_start);
