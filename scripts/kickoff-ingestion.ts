import "dotenv/config";

import { runs, tasks } from "@trigger.dev/sdk/v3";
import { chQuery } from "../src/lib/clickhouse";

const ACTIVE_RUN_STATUSES = ["PENDING_VERSION", "QUEUED", "DEQUEUED", "EXECUTING", "WAITING", "DELAYED"] as const;

async function heartbeatFreshness() {
  return chQuery<{ task: string; last_flush: string; age_seconds: number }>(
    `SELECT task,
      toString(max(flushed_at)) AS last_flush,
      dateDiff('second', max(flushed_at), now()) AS age_seconds
    FROM ingest_heartbeats
    WHERE task IN ('ingest-trades-ws', 'ingest-book-ws')
      AND flushed_at > now() - INTERVAL 1 DAY
    GROUP BY task
    ORDER BY task`
  );
}

async function cancelActiveRuns(taskId: string) {
  const page = await runs.list({
    taskIdentifier: taskId,
    status: [...ACTIVE_RUN_STATUSES],
    period: "1d",
  });
  const cancelled: string[] = [];
  for (const run of page.data) {
    await runs.cancel(run.id);
    cancelled.push(run.id);
  }
  return cancelled;
}

async function main() {
  const before = await heartbeatFreshness();
  const [cancelledTrades, cancelledBook] = await Promise.all([
    cancelActiveRuns("ingest-trades-ws"),
    cancelActiveRuns("ingest-book-ws"),
  ]);
  const [trades, book] = await Promise.all([
    tasks.trigger("ingest-trades-ws", {}),
    tasks.trigger("ingest-book-ws", {}),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const after = await heartbeatFreshness();

  console.log(JSON.stringify({
    cancelled: { trades: cancelledTrades, book: cancelledBook },
    triggered: { trades: trades.id, book: book.id },
    before,
    after,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
