import { and, eq } from "drizzle-orm";
import { db } from "@/lib/postgres";
import { hitlApprovals } from "@/lib/schema";

// One true path to resolve an approval — enforced at this boundary.
//
// An in-session tool approval (set_alert) carries a tool_call_id and belongs to
// a suspended, durable chat run. Its ONLY correct resolution is
// addToolApprovalResponse through the chat transport, which resumes the run and
// runs the tool's execute() (creating the subscription + flipping the row to
// approved). A raw `UPDATE status` here would flip the record while leaving the
// run suspended and execute() un-run — the exact desync the old standalone
// server introduced. So this route REFUSES those rows and points the caller at
// the chat.
//
// alert-fanout notifications have no run and no tool_call_id; there is nothing
// in the AI SDK to respond to, so acknowledging one legitimately IS a DB update.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { id, status } = await req.json().catch(() => ({}));
  if (!id || !["approved", "denied"].includes(status)) {
    return Response.json(
      { error: "id and status ('approved' | 'denied') are required" },
      { status: 400 }
    );
  }

  const [row] = await db
    .select()
    .from(hitlApprovals)
    .where(eq(hitlApprovals.id, id))
    .limit(1);

  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  if (row.toolCallId) {
    return Response.json(
      {
        error:
          "This is an in-session tool approval. Resolve it in the chat via addToolApprovalResponse so the durable run resumes and the tool executes — not through this route.",
      },
      { status: 409 }
    );
  }

  const updated = await db
    .update(hitlApprovals)
    .set({ status, resolvedAt: new Date() })
    .where(and(eq(hitlApprovals.id, id), eq(hitlApprovals.status, "pending")))
    .returning({ id: hitlApprovals.id, status: hitlApprovals.status });

  return Response.json({ acknowledged: updated.length > 0, row: updated[0] ?? null });
}
