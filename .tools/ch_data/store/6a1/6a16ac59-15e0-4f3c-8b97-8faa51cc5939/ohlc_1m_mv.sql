ATTACH MATERIALIZED VIEW _ UUID 'af548cb5-d79d-4115-8db6-c691f3728fef' TO INNER UUID 'c63ac1e6-a0b8-4b94-be98-a000dba37cc2'
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
AS SELECT
    symbol,
    exchange,
    toStartOfMinute(timestamp) AS minute,
    argMinState(price, timestamp) AS open,
    maxState(price) AS high,
    minState(price) AS low,
    argMaxState(price, timestamp) AS close,
    sumState(size) AS volume
FROM default.trades
GROUP BY
    symbol,
    exchange,
    minute
