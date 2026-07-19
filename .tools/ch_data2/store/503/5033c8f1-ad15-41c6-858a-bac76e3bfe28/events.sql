ATTACH TABLE _ UUID '3b3f248b-7c6c-418c-86bb-d80844df4808'
(
    `symbol` String,
    `event_type` Enum8('volatility_spike' = 1, 'spread_anomaly' = 2, 'volume_spike' = 3),
    `window_start` DateTime64(3),
    `window_end` DateTime64(3),
    `severity` Float64,
    `detail` String
)
ENGINE = MergeTree
ORDER BY (symbol, window_start)
SETTINGS index_granularity = 8192
