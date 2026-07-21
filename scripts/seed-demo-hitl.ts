import "dotenv/config";

import { and, eq } from "drizzle-orm";
import { db } from "../src/lib/postgres";
import { hitlApprovals } from "../src/lib/schema";
import { DEMO_USER_ID } from "../src/lib/agent-tools";

async function main() {
  await db
    .update(hitlApprovals)
    .set({ status: "denied", resolvedAt: new Date() })
    .where(and(eq(hitlApprovals.chatId, "demo-hitl-seed"), eq(hitlApprovals.status, "pending")));

  const [row] = await db
    .insert(hitlApprovals)
    .values({
      userId: DEMO_USER_ID,
      chatId: "demo-hitl-seed",
      toolCallId: null,
      toolName: "alert-fanout",
      toolInput: {
        symbol: "BTC-USD",
        event_type: "volatility_spike",
        severity: 3.4,
        window_start: new Date(Date.now() - 60_000).toISOString(),
        window_end: new Date().toISOString(),
        detail: JSON.stringify({
          source: "demo seed",
          note: "Run-less notification for the proactive HITL card.",
        }),
      },
      status: "pending",
    })
    .returning({ id: hitlApprovals.id, status: hitlApprovals.status });

  console.log(JSON.stringify({ seeded: true, row }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
