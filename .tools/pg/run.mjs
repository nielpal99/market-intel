import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const pg = new PGlite("./pgdata");
const sql = readFileSync("/Users/nielpal/market-intel/db/postgres_schema.sql", "utf8");

try {
  await pg.exec(sql);
  const { rows } = await pg.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  console.log("tables:", rows.map((r) => r.tablename));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
await pg.close();
