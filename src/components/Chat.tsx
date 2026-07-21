"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { WidgetSkeleton } from "./WidgetSkeleton";
import { useThroughput } from "@/lib/useThroughput";

type DrillDownProps = {
  data: any;
  onDrillDown?: (message: string) => void;
};

const RENDER_COMPONENTS: Record<string, (props: DrillDownProps) => JSX.Element> = {
  "tool-render_verdict_card": VerdictCard,
  "tool-render_candlestick": Candlestick,
  "tool-render_spread_heatmap": SpreadHeatmap,
  "tool-render_volatility_bands": VolatilityBands,
  "tool-render_correlation_network": CorrelationNetwork,
};

const WATCHED = ["BTC-USD", "ETH-USD", "SOL-USD"];

function formatTickerPrice(price?: number) {
  if (price === undefined || !Number.isFinite(price)) return "—";
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function Chat() {
  const [chatId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  const [pendingApprovals, setPendingApprovals] = useState<HITLApproval[]>([]);
  const [priceMoves, setPriceMoves] = useState<Record<string, "up" | "down" | "flat">>({});
  const lastPrices = useRef<Map<string, number>>(new Map());
  const throughput = useThroughput();
  const pricesBySymbol = useMemo(
    () => new Map(throughput.prices.map((price) => [price.symbol, price])),
    [throughput.prices]
  );

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

  useEffect(() => {
    const nextMoves: Record<string, "up" | "down" | "flat"> = {};
    for (const price of throughput.prices) {
      const previous = lastPrices.current.get(price.symbol);
      if (previous !== undefined && previous !== price.price) {
        nextMoves[price.symbol] = price.price > previous ? "up" : "down";
      }
      lastPrices.current.set(price.symbol, price.price);
    }
    if (Object.keys(nextMoves).length === 0) return;
    setPriceMoves(nextMoves);
    const clear = setTimeout(() => setPriceMoves({}), 900);
    return () => clearTimeout(clear);
  }, [throughput.prices]);

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

  const sendScopedMessage = (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    sendMessage({ text: message });
  };

  return (
    <section className="console">
      <header className="status-strip">
        <div className="wordmark">MARKET<b>INTEL</b></div>
        <div className="watched">
          {WATCHED.map((s) => {
            const latest = pricesBySymbol.get(s);
            const move = priceMoves[s] ?? "flat";
            return (
              <span key={s} className={`ticker ${move}`} title={latest?.timestamp ? `${s} ${latest.timestamp}` : s}>
                <span className="ticker-symbol">{s.replace("-USD", "")}</span>
                <span className="ticker-price">{formatTickerPrice(latest?.price)}</span>
              </span>
            );
          })}
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
                    if (part.type === "text") {
                      // Suppress trailing text that immediately follows a completed render_* tool
                      // call — defense-in-depth against models echoing tool output as prose.
                      const prev = m.parts[i - 1] as any;
                      const afterRender =
                        prev &&
                        typeof prev.type === "string" &&
                        prev.type.startsWith("tool-render_") &&
                        prev.state === "output-available";
                      return !afterRender && part.text ? <p key={i} className="prose">{part.text}</p> : null;
                    }

                    const Widget = RENDER_COMPONENTS[part.type];
                    if (Widget) {
                      const label = part.type.replace("tool-render_", "").replace(/_/g, " ");
                      if (part.state === "output-available") {
                        return (
                          <div key={i} className="readout">
                            <div className="readout-head">
                              <span className="tag">Readout</span>
                              <span>· {label}</span>
                            </div>
                            <div className="readout-body">
                              <Widget data={part.output} onDrillDown={sendScopedMessage} />
                            </div>
                          </div>
                        );
                      }
                      // input-streaming / input-available: tool is building or executing —
                      // show a shape-matched skeleton so the ~3s gap has visible progress.
                      if (part.state === "input-streaming" || part.state === "input-available") {
                        return (
                          <div key={i} className="readout">
                            <div className="readout-head">
                              <span className="tag">Readout</span>
                              <span>· {label}</span>
                            </div>
                            <div className="readout-body">
                              <WidgetSkeleton type={part.type} />
                            </div>
                          </div>
                        );
                      }
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
