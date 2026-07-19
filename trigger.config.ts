import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "market-intel",
  dirs: ["./src/trigger"],
  // Project-wide default; the ingest tasks override with timeout.None.
  maxDuration: 300,
});
