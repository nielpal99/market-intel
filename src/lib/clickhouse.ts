import { createClient } from "@clickhouse/client";

export const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

export async function chQuery<T = unknown>(
  sql: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  const result = await clickhouse.query({
    query: sql,
    query_params: params || {},
    format: "JSONEachRow",
  });
  return result.json<T>();
}

export type QueryStats = {
  readRows: number;
  resultRows: number;
  elapsedMs: number;
};

// Uses FORMAT JSON so ClickHouse returns statistics (rows_read, elapsed) in the
// same response body — no query_log polling, no timing dependency.
export async function chQueryWithStats<T = unknown>(
  sql: string,
  params?: Record<string, unknown>
): Promise<{ rows: T[]; queryStats: QueryStats | null }> {
  const result = await clickhouse.query({
    query: sql,
    query_params: params || {},
    format: "JSON",
  });
  const text = await result.text();
  let rows: T[] = [];
  let queryStats: QueryStats | null = null;
  try {
    const parsed = JSON.parse(text) as {
      data: T[];
      rows: number;
      statistics: { elapsed: number; rows_read: number; bytes_read: number };
    };
    rows = parsed.data ?? [];
    if (parsed.statistics) {
      queryStats = {
        readRows: Number(parsed.statistics.rows_read),
        resultRows: Number(parsed.rows),
        elapsedMs: Math.round(parsed.statistics.elapsed * 1000),
      };
    }
  } catch {
    /* malformed response — return empty rows, no stats */
  }
  return { rows, queryStats };
}
