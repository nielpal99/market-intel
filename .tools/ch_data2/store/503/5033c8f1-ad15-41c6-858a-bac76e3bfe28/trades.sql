ATTACH TABLE _ UUID '1b641df6-767a-4a1a-a11d-114d6adb946b'
(
    `exchange` String,
    `symbol` String,
    `trade_id` String,
    `price` Float64,
    `size` Float64,
    `side` Enum8('buy' = 1, 'sell' = 2),
    `timestamp` DateTime64(3)
)
ENGINE = MergeTree
ORDER BY (symbol, exchange, timestamp)
SETTINGS index_granularity = 8192
