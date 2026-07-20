"use client";

import { useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { VerdictCard } from "./VerdictCard";
import { Candlestick } from "./Candlestick";
import { SpreadHeatmap } from "./SpreadHeatmap";
import { VolatilityBands } from "./VolatilityBands";
import { CorrelationNetwork } from "./CorrelationNetwork";
import { HITLCard, HITLApproval } from "./HITLCard";

const RENDER_COMPONENTS: Record<string, (props: { data: any }) => JSX.Element> = {
  "tool-render_verdict_card": VerdictCard,
  "tool-render_candlestick": Candlestick,
  "tool-render_spread_heatmap": SpreadHeatmap,
  "tool-render_volatility_bands": VolatilityBands,
  "tool-render_correlation_network": CorrelationNetwork,
};

export function Chat() {
  const [chatId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  const [pendingApprovals, setPendingApprovals] = useState<HITLApproval[]>([]);

  const transport = useTriggerChatTransport({
    task: "market-intel",
    accessToken: async () => {
      const res = await fetch("/api/chat/token", { method: "POST" });
      const { token } = await res.json();
      return token;
    },
    headStart: "/api/chat",
  });

  const { messages, sendMessage, status, addToolApprovalResponse } = useChat({
    id: chatId,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const busy = status === "submitted" || status === "streaming";

  // Poll the in-process route (real Neon DB) for run-less alert-fanout
  // notifications. In-session set_alert approvals carry a tool_call_id and are
  // surfaced + resolved inline in the message stream (addToolApprovalResponse),
  // so they're filtered out here to avoid a duplicate, wrong-path surface.
  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await fetch("/api/hitl/pending");
        if (!res.ok) return;
        const rows = await res.json();
        setPendingApprovals(rows.filter((r: any) => r.kind === "notification"));
      } catch {
        // swallow transient poll errors
      }
    };

    fetchPending();
    const interval = setInterval(fetchPending, 5000);
    return () => clearInterval(interval);
  }, []);

  const resolveApproval = async (id: string, status: "approved" | "denied") => {
    const res = await fetch("/api/hitl/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) {
      setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
    }
  };

  const submit = () => {
    if (!input.trim() || busy) return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
      {pendingApprovals.length > 0 && (
        <div>
          {pendingApprovals.map((a) => (
            <HITLCard
              key={a.id}
              approval={a}
              onApprove={(id) => resolveApproval(id, "approved")}
              onDeny={(id) => resolveApproval(id, "denied")}
            />
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Ask: Show me BTC over the last hour"
          style={{ flex: 1, padding: 12, borderRadius: 8, border: "1px solid #333", background: "#111", color: "#fff" }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          style={{ padding: "0 16px", borderRadius: 8, background: busy ? "#334155" : "#3b82f6", border: "none", color: "#fff" }}
        >
          Send
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ padding: 12, borderRadius: 8, background: m.role === "user" ? "#1f2937" : "#111827" }}>
            {m.parts.map((part: any, i: number) => {
              if (part.type === "text") return <p key={i}>{part.text}</p>;

              const Widget = RENDER_COMPONENTS[part.type];
              if (Widget && part.state === "output-available") {
                return <Widget key={i} data={part.output} />;
              }

              if (part.type === "tool-set_alert" && part.state === "approval-requested") {
                return (
                  <div key={i} style={{ border: "1px solid #b45309", borderRadius: 8, padding: 12 }}>
                    <p style={{ margin: "0 0 8px" }}>
                      Create alert: {part.input?.symbol} / {part.input?.event_type} (min severity {part.input?.min_severity})?
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}
                        style={{ padding: "4px 12px", borderRadius: 6, background: "#16a34a", border: "none", color: "#fff" }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: false })}
                        style={{ padding: "4px 12px", borderRadius: 6, background: "#dc2626", border: "none", color: "#fff" }}
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                );
              }

              if (typeof part.type === "string" && part.type.startsWith("tool-query_")) {
                return (
                  <p key={i} style={{ fontSize: 12, color: "#6b7280" }}>
                    {part.state === "output-available" ? "✓" : "…"} {part.type.replace("tool-", "")}
                  </p>
                );
              }

              return null;
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
