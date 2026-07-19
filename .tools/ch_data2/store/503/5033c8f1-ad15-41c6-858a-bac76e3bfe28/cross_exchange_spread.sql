ATTACH VIEW _ UUID 'b0466f48-20a8-440f-8b85-3e5434664e2f'
(
    `symbol` String,
    `timestamp` DateTime64(3),
    `exchange_a` String,
    `bid_a` Float64,
    `ask_a` Float64,
    `exchange_b` String,
    `bid_b` Float64,
    `ask_b` Float64,
    `spread_a_over_b` Float64
)
AS SELECT
    a.symbol,
    a.timestamp,
    a.exchange AS exchange_a,
    a.best_bid AS bid_a,
    a.best_ask AS ask_a,
    b.exchange AS exchange_b,
    b.best_bid AS bid_b,
    b.best_ask AS ask_b,
    (a.best_bid - b.best_ask) AS spread_a_over_b
FROM default.book_snapshots AS a
INNER JOIN default.book_snapshots AS b ON (a.symbol = b.symbol) AND (a.exchange != b.exchange) AND (abs(a.timestamp - b.timestamp) < 2)
