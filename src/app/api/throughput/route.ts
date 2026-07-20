import { chQuery } from "@/lib/clickhouse";

// Lightweight read of real ingestion throughput off ingest_heartbeats — drives
// the live signal rail. No new data layer; just recent flushed-row counts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [buckets, freshness] = await Promise.all([
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
  ]);

  const age = freshness[0]?.age ?? null;
  return Response.json({
    buckets,
    ageSeconds: age,
    live: age !== null && age < 30,
  });
}
