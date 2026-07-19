ATTACH TABLE _ UUID 'ad8993dd-4e5c-4257-b2c0-9664748daa42'
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
