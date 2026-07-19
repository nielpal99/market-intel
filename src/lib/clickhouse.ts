import { createClient } from "@clickhouse/client";

export const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
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
  const rows = await result.json<T>();
  return rows;
}
