ATTACH TABLE _ UUID '52659192-2599-4ab1-8729-775715c53f9f'
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
