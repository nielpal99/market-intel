import { defineConfig } from "@trigger.dev/sdk/v3";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

const TRIGGER_RUNTIME_ENV = [
  "CLICKHOUSE_HOST",
  "CLICKHOUSE_USER",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_DATABASE",
  "POSTGRES_URL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "TRIGGER_API_URL",
] as const;

export default defineConfig({
  project: "proj_tzripyncwneyxizvklje",
  dirs: ["./src/trigger"],
  // Project-wide default; the ingest tasks override with timeout.None.
  maxDuration: 300,
  build: {
    extensions: [
      syncEnvVars(async () =>
        TRIGGER_RUNTIME_ENV.flatMap((name) => {
          const value = process.env[name];
          return value ? [{ name, value, isSecret: true }] : [];
        })
      ),
    ],
  },
});
