ATTACH TABLE _ UUID '65a6ef4d-d9ec-4170-8cf3-92f68f576bcc'
(
    `symbol` String,
    `exchange` String,
    `minute` DateTime,
    `open` AggregateFunction(argMin, Float64, DateTime64(3)),
    `high` AggregateFunction(max, Float64),
    `low` AggregateFunction(min, Float64),
    `close` AggregateFunction(argMax, Float64, DateTime64(3)),
    `volume` AggregateFunction(sum, Float64)
)
ENGINE = AggregatingMergeTree
ORDER BY (symbol, exchange, minute)
SETTINGS index_granularity = 8192
