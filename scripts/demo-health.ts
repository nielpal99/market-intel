import "dotenv/config";

import { runs } from "@trigger.dev/sdk/v3";
import { chQuery } from "../src/lib/clickhouse";

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

const APP_URL = process.env.DEMO_APP_URL ?? "https://market-intel-mu.vercel.app";
const MAX_HEARTBEAT_AGE_SECONDS = 45;

function printCheck(check: Check) {
  const marker = check.ok ? "OK " : "BAD";
  console.log(`${marker} ${check.name}: ${check.detail}`);
}

function summarizeChecks(checks: Check[]) {
  console.log("\nDemo health");
  console.log("-----------");
  for (const check of checks) printCheck(check);
  const failures = checks.filter((check) => !check.ok);
  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed. Fix these before recording.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll live-demo checks passed.");
  }
}

async function appHealth(): Promise<Check> {
  try {
    const response = await fetch(`${APP_URL}/api/throughput`, { cache: "no-store" });
    if (!response.ok) {
      return { name: "Vercel throughput API", ok: false, detail: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as {
      live?: boolean;
      ageSeconds?: number | null;
      rowsLastMinute?: number;
      prices?: Array<{ symbol: string; price: number }>;
    };
    const symbols = body.prices?.map((price) => `${price.symbol}=${price.price}`).join(", ") || "no prices";
    return {
      name: "Vercel throughput API",
      ok: Boolean(body.live) && Number(body.rowsLastMinute ?? 0) > 0,
      detail: `live=${Boolean(body.live)}, age=${body.ageSeconds ?? "n/a"}s, rows/min=${body.rowsLastMinute ?? 0}, ${symbols}`,
    };
  } catch (error) {
    return { name: "Vercel throughput API", ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function ingestionStart(): Promise<Check> {
  const rows = await chQuery<{ first_seen: string | null }>(
    `SELECT toString(min(flushed_at)) AS first_seen FROM ingest_heartbeats`
  );
  const firstSeen = rows[0]?.first_seen;
  return {
    name: "Real ingestion start",
    ok: Boolean(firstSeen),
    detail: firstSeen ? `${firstSeen} UTC` : "no ingest_heartbeats rows found",
  };
}

async function heartbeatHealth(): Promise<Check> {
  const rows = await chQuery<{ task: string; exchange: string; age_seconds: number; rows_last_minute: number }>(
    `SELECT
        task,
        exchange,
        dateDiff('second', max(flushed_at), now()) AS age_seconds,
        toUInt32(sumIf(flushed_rows, flushed_at > now() - INTERVAL 1 MINUTE)) AS rows_last_minute
     FROM ingest_heartbeats
     WHERE flushed_at > now() - INTERVAL 5 MINUTE
     GROUP BY task, exchange
     ORDER BY task, exchange`
  );
  const expected = new Set([
    "ingest-book-ws:coinbase",
    "ingest-book-ws:kraken",
    "ingest-trades-ws:coinbase",
    "ingest-trades-ws:kraken",
  ]);
  for (const row of rows) expected.delete(`${row.task}:${row.exchange}`);
  const stale = rows.filter((row) => row.age_seconds > MAX_HEARTBEAT_AGE_SECONDS || row.rows_last_minute <= 0);
  const detail = rows
    .map((row) => `${row.task}/${row.exchange} age=${row.age_seconds}s rows/min=${row.rows_last_minute}`)
    .join("; ");
  return {
    name: "Trigger ingestion heartbeats",
    ok: expected.size === 0 && stale.length === 0,
    detail: `${detail || "no recent heartbeats"}${expected.size ? `; missing=${Array.from(expected).join(",")}` : ""}`,
  };
}

async function tableHealth(table: "trades" | "book_snapshots"): Promise<Check> {
  const rows = await chQuery<{ symbol: string; exchange: string; rows: number; first_ts: string; last_ts: string }>(
    `SELECT
        symbol,
        exchange,
        toUInt32(count()) AS rows,
        toString(min(timestamp)) AS first_ts,
        toString(max(timestamp)) AS last_ts
     FROM ${table}
     WHERE timestamp > now() - INTERVAL 5 MINUTE
     GROUP BY symbol, exchange
     ORDER BY symbol, exchange`
  );
  const total = rows.reduce((sum, row) => sum + Number(row.rows), 0);
  const pairs = new Set(rows.map((row) => `${row.symbol}:${row.exchange}`));
  const expected = ["BTC-USD", "ETH-USD", "SOL-USD"].flatMap((symbol) => [
    `${symbol}:coinbase`,
    `${symbol}:kraken`,
  ]);
  const missing = expected.filter((key) => !pairs.has(key));
  return {
    name: `${table} live rows`,
    ok: total > 0 && missing.length === 0,
    detail: `${total} rows in last 5m${missing.length ? `; missing=${missing.join(",")}` : ""}`,
  };
}

async function spreadHealth(): Promise<Check> {
  const rows = await chQuery<{ symbol: string; rows: number; avg_delta_ms: number; max_delta_ms: number }>(
    `SELECT
        symbol,
        toUInt32(count()) AS rows,
        round(avg(time_delta_ms), 1) AS avg_delta_ms,
        max(time_delta_ms) AS max_delta_ms
     FROM cross_exchange_spread
     WHERE timestamp > now() - INTERVAL 30 MINUTE
     GROUP BY symbol
     ORDER BY symbol`
  );
  const total = rows.reduce((sum, row) => sum + Number(row.rows), 0);
  const detail = rows
    .map((row) => `${row.symbol} rows=${row.rows} avgDelta=${row.avg_delta_ms}ms maxDelta=${row.max_delta_ms}ms`)
    .join("; ");
  return {
    name: "cross_exchange_spread view",
    ok: total > 0 && rows.every((row) => row.max_delta_ms <= 250),
    detail: detail || "no matched spread rows in last 30m",
  };
}

async function triggerRunHealth(): Promise<Check> {
  if (!process.env.TRIGGER_SECRET_KEY) {
    return {
      name: "Trigger prod run status",
      ok: true,
      detail: "skipped because TRIGGER_SECRET_KEY is not set locally",
    };
  }
  if (!process.env.TRIGGER_SECRET_KEY.startsWith("tr_prod_")) {
    return {
      name: "Trigger prod run status",
      ok: true,
      detail: "skipped because local TRIGGER_SECRET_KEY is not a prod key; ClickHouse heartbeats still prove ingestion liveness",
    };
  }
  const [tradesPage, bookPage, recentPage] = await Promise.all([
    runs.list({ taskIdentifier: "ingest-trades-ws", period: "1d", limit: 5 }),
    runs.list({ taskIdentifier: "ingest-book-ws", period: "1d", limit: 5 }),
    runs.list({ period: "30m", limit: 20 }),
  ]);
  const latestIngest = [tradesPage.data[0], bookPage.data[0]].filter(Boolean);
  const activeIngest = latestIngest.filter((run) => run.status === "EXECUTING");
  const recentFailures = recentPage.data.filter((run) =>
    ["FAILED", "CRASHED", "SYSTEM_FAILURE"].includes(run.status)
  );
  return {
    name: "Trigger prod run status",
    ok: activeIngest.length >= 2 && recentFailures.length === 0,
    detail: `${activeIngest.length}/2 latest ingest runs executing, ${recentFailures.length} failure(s) in latest ${recentPage.data.length} scheduled/chat run(s)`,
  };
}

async function main() {
  const checks = await Promise.all([
    appHealth(),
    ingestionStart(),
    heartbeatHealth(),
    tableHealth("trades"),
    tableHealth("book_snapshots"),
    spreadHealth(),
    triggerRunHealth(),
  ]);
  summarizeChecks(checks);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
