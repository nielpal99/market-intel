"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import { VerdictCard } from "./VerdictCard";
import { Candlestick } from "./Candlestick";
import { SpreadHeatmap } from "./SpreadHeatmap";
import { VolatilityBands } from "./VolatilityBands";
import { CorrelationNetwork } from "./CorrelationNetwork";

export function Chat() {
  const transport = useTriggerChatTransport({ agent: "market-intel" });
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    transport,
  });

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask: Show me BTC over the last hour"
          style={{ flex: 1, padding: 12, borderRadius: 8, border: "1px solid #333", background: "#111", color: "#fff" }}
        />
        <button type="button" onClick={() => handleSubmit(undefined, {})} style={{ padding: "0 16px", borderRadius: 8, background: "#3b82f6", border: "none", color: "#fff" }}>
          Send
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ padding: 12, borderRadius: 8, background: m.role === "user" ? "#1f2937" : "#111827" }}>
            {m.parts?.map((part: any, i: number) => {
              if (part.type === "text") return <p key={i}>{part.text}</p>;
              if (part.type === "tool-render_verdict_card") return <VerdictCard key={i} data={part.output} />;
              if (part.type === "tool-render_candlestick") return <Candlestick key={i} data={part.output} />;
              if (part.type === "tool-render_spread_heatmap") return <SpreadHeatmap key={i} data={part.output} />;
              if (part.type === "tool-render_volatility_bands") return <VolatilityBands key={i} data={part.output} />;
              if (part.type === "tool-render_correlation_network") return <CorrelationNetwork key={i} data={part.output} />;
              return <pre key={i} style={{ fontSize: 12 }}>{JSON.stringify(part, null, 2)}</pre>;
            }) || <p>{m.content}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
