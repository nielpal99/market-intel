ATTACH TABLE _ UUID 'd4003614-ca49-46e0-8438-5c35328ee873'
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
