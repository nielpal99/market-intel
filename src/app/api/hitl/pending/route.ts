import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/postgres";
import { hitlApprovals } from "@/lib/schema";
import { chQuery } from "@/lib/clickhouse";

// In-process replacement for the old standalone hitl-server.ts. Reads the
// SAME Neon DB the app writes to (set_alert.needsApproval + alert-fanout),
// not a separate PGlite store. Matches the /api/chat/token route pattern.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select()
    .from(hitlApprovals)
    .where(eq(hitlApprovals.status, "pending"))
    .orderBy(desc(hitlApprovals.requestedAt));

  const enriched = await Promise.all(
    rows.map(async (r) => {
      const input = (r.toolInput ?? {}) as Record<string, any>;
      let event = null;
      if (input.symbol && input.event_type) {
        const ev = await chQuery<any>(
          "SELECT symbol, event_type, severity, window_start, window_end, detail FROM events WHERE symbol = {s:String} AND event_type = {e:String} ORDER BY window_end DESC LIMIT 1",
          { s: input.symbol, e: input.event_type }
        ).catch(() => []);
        event = ev[0] ?? null;
      }
      return {
        id: r.id,
        chatId: r.chatId,
        toolName: r.toolName,
        toolInput: input,
        toolCallId: r.toolCallId,
        // Discriminator: a tool_call_id means an in-session AI SDK tool
        // approval (set_alert) that MUST resolve through the chat; null means a
        // run-less alert-fanout notification the /resolve route can acknowledge.
        kind: r.toolCallId ? "tool_approval" : "notification",
        status: r.status,
        requestedAt: r.requestedAt,
        event,
      };
    })
  );

  return Response.json(enriched);
}
