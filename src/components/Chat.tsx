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
import { SignalTrace } from "./SignalTrace";
import { useThroughput } from "@/lib/useThroughput";

const RENDER_COMPONENTS: Record<string, (props: { data: any }) => JSX.Element> = {
  "tool-render_verdict_card": VerdictCard,
  "tool-render_candlestick": Candlestick,
  "tool-render_spread_heatmap": SpreadHeatmap,
  "tool-render_volatility_bands": VolatilityBands,
  "tool-render_correlation_network": CorrelationNetwork,
};

const WATCHED = ["BTC-USD", "ETH-USD", "SOL-USD"];

export function Chat() {
  const [chatId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  const [pendingApprovals, setPendingApprovals] = useState<HITLApproval[]>([]);
  const throughput = useThroughput();

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
        /* swallow transient poll errors */
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
    <section className="console">
      <header className="status-strip">
        <div className="wordmark">MARKET<b>INTEL</b></div>
        <div className="watched">
          {WATCHED.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
        <div className={`beacon ${throughput.live ? "on" : "off"}`}>
          <span className="dot" />
          <span className="label">{throughput.live ? "Live feed" : "Feed idle"}</span>
        </div>
      </header>

      <div className="stage">
        <aside className="rail">
          <SignalTrace buckets={throughput.buckets} live={throughput.live} />
        </aside>

        <div className="feed">
          {pendingApprovals.map((a) => (
            <HITLCard
              key={a.id}
              approval={a}
              onApprove={(id) => resolveApproval(id, "approved")}
              onDeny={(id) => resolveApproval(id, "denied")}
            />
          ))}

          {messages.map((m) => (
            <div key={m.id}>
              {m.role === "user"
                ? m.parts.map((part: any, i: number) =>
                    part.type === "text" ? (
                      <div key={i} className="query-line">
                        <span className="caret">▸</span>
                        <span className="text">{part.text}</span>
                      </div>
                    ) : null
                  )
                : m.parts.map((part: any, i: number) => {
                    if (part.type === "text")
                      return part.text ? <p key={i} className="prose">{part.text}</p> : null;

                    const Widget = RENDER_COMPONENTS[part.type];
                    if (Widget && part.state === "output-available") {
                      const label = part.type.replace("tool-render_", "").replace(/_/g, " ");
                      return (
                        <div key={i} className="readout">
                          <div className="readout-head">
                            <span className="tag">Readout</span>
                            <span>· {label}</span>
                          </div>
                          <div className="readout-body">
                            <Widget data={part.output} />
                          </div>
                        </div>
                      );
                    }

                    if (part.type === "tool-set_alert" && part.state === "approval-requested") {
                      return (
                        <div key={i} className="approval">
                          <div className="approval-head">Confirm · set alert</div>
                          <p className="prose" style={{ marginBottom: 12 }}>
                            Watch {part.input?.symbol} for {part.input?.event_type} at severity ≥{" "}
                            {part.input?.min_severity}?
                          </p>
                          <div className="signal-actions">
                            <button
                              type="button"
                              className="btn btn-ice"
                              onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}
                            >
                              Set alert
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: false })}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      );
                    }

                    if (typeof part.type === "string" && part.type.startsWith("tool-query_")) {
                      const done = part.state === "output-available";
                      return (
                        <div key={i} className={`pill ${done ? "done" : ""}`}>
                          <span>{done ? "▪" : "▫"}</span>
                          <span>{part.type.replace("tool-", "")}</span>
                        </div>
                      );
                    }

                    return null;
                  })}
            </div>
          ))}
        </div>
      </div>

      <div className="composer">
        <span className="prompt">⌘</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="query the tape — e.g. show me ETH over the last hour"
        />
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? "Reading…" : "Send"}
        </button>
      </div>
    </section>
  );
}
