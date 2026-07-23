# Submission Runbook

Use this in the final hour before recording or submitting. The goal is to prove the demo is live, then avoid touching working systems.

## Pre-recording

1. Confirm production health:

   ```bash
   npm run demo:health
   ```

   It checks the deployed throughput endpoint, ClickHouse ingestion heartbeats, recent `trades` and `book_snapshots`, the 250ms `cross_exchange_spread` view, and Trigger run status when `TRIGGER_SECRET_KEY` is present locally.
   If local `.env` uses a dev Trigger key, the direct Trigger prod run-status check is skipped; ClickHouse heartbeats still prove live ingestion. To include prod Trigger run status, run it with the production Trigger secret in the shell environment.

2. If ingestion is stale, restart the long-running Trigger ingestion tasks:

   ```bash
   npm run trigger:kickoff
   npm run demo:health
   ```

3. Open the production app:

   <https://market-intel-mu.vercel.app/>

4. Run the demo path once without recording:

   - Proactive alert card appears or seed one with `npm run demo:hitl`
   - Ask for a spread heatmap
   - Ask for the correlation network
   - Ask for a candlestick, then drag-select a narrower range
   - Click a heatmap cell to drill into trades
   - Set an alert and approve it

## Recording Notes

- Open directly on the working product; keep setup explanation brief.
- Mention that Trigger.dev runs ingestion, watchdog, event detection, fanout, and chat orchestration.
- Mention that ClickHouse stores live market data and powers the low-latency views/materialized views.
- Show one live proof signal in the header: `CH rows/min` and `Trigger hb`.
- Keep text as narration only; the app responses should be widgets.

## Do Not Touch Before Submit

- Do not redesign mobile layouts for the desktop recording.
- Do not add new data sources.
- Do not change model/provider unless the app is failing.
- Do not run schema-destructive commands against ClickHouse or Neon.
