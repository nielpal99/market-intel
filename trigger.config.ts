import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_tzripyncwneyxizvklje",
  dirs: ["./src/trigger"],
  // Project-wide default; the ingest tasks override with timeout.None.
  maxDuration: 300,
});
