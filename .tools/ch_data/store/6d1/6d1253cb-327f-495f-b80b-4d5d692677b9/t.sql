ATTACH TABLE _ UUID 'ca8ebb3d-e282-4432-9610-f8b5a0ad93ab'
(
    `x` UInt8
)
ENGINE = MergeTree
ORDER BY x
SETTINGS index_granularity = 8192
