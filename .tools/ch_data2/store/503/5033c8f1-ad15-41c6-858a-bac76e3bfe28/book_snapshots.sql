ATTACH TABLE _ UUID '3819b8bb-f2c8-4a00-a72c-ee4a6fed7616'
(
    `exchange` String,
    `symbol` String,
    `timestamp` DateTime64(3),
    `best_bid` Float64,
    `best_ask` Float64,
    `bid_size` Float64,
    `ask_size` Float64
)
ENGINE = MergeTree
ORDER BY (symbol, exchange, timestamp)
SETTINGS index_granularity = 8192
