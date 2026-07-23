import { chQuery } from "@/lib/clickhouse";

// Lightweight read of real ingestion throughput and latest trades — drives
// the live signal rail/status strip. No chat/tool logic touched.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [buckets, freshness, prices, taskHealth, rowRate] = await Promise.all([
    chQuery<{ t: number; rows: number }>(
      `SELECT toUnixTimestamp(toStartOfInterval(flushed_at, INTERVAL 5 SECOND)) AS t,
              toUInt32(sum(flushed_rows)) AS rows
       FROM ingest_heartbeats
       WHERE flushed_at > now() - INTERVAL 3 MINUTE
       GROUP BY t ORDER BY t`
    ).catch(() => []),
    chQuery<{ age: number | null }>(
      `SELECT dateDiff('second', max(flushed_at), now()) AS age FROM ingest_heartbeats`
    ).catch(() => [{ age: null }]),
    chQuery<{ symbol: string; price: number; timestamp: string }>(
      `SELECT symbol, price, latest_timestamp AS timestamp
       FROM (
         SELECT symbol,
                argMax(price, timestamp) AS price,
                max(timestamp) AS latest_timestamp
         FROM trades
         WHERE timestamp > now() - INTERVAL 5 MINUTE
         GROUP BY symbol
       )
       ORDER BY symbol`
    ).catch(() => []),
    chQuery<{ task: string; exchange: string; ageSeconds: number | null; rowsLastMinute: number }>(
      `SELECT
          task,
          exchange,
          dateDiff('second', max(flushed_at), now()) AS ageSeconds,
          toUInt32(sumIf(flushed_rows, flushed_at > now() - INTERVAL 1 MINUTE)) AS rowsLastMinute
       FROM ingest_heartbeats
       WHERE flushed_at > now() - INTERVAL 5 MINUTE
       GROUP BY task, exchange
       ORDER BY task, exchange`
    ).catch(() => []),
    chQuery<{ rowsLastMinute: number }>(
      `SELECT toUInt32(sum(flushed_rows)) AS rowsLastMinute
       FROM ingest_heartbeats
       WHERE flushed_at > now() - INTERVAL 1 MINUTE`
    ).catch(() => [{ rowsLastMinute: 0 }]),
  ]);

  const age = freshness[0]?.age ?? null;
  return Response.json({
    buckets,
    ageSeconds: age,
    live: age !== null && age < 30,
    prices,
    taskHealth,
    rowsLastMinute: rowRate[0]?.rowsLastMinute ?? 0,
  });
}
