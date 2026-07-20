"use client";

export interface HITLApproval {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  event?: {
    symbol?: string;
    event_type?: string;
    severity?: number;
    window_start?: string;
    window_end?: string;
    detail?: string;
  } | null;
  requestedAt?: string;
}

export interface HITLCardProps {
  approval: HITLApproval;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

function formatTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString([], { hour12: false });
}

function humanizeKey(k: string) {
  return k.replace(/_/g, " ");
}

function formatValue(v: unknown) {
  if (typeof v !== "number") return String(v);
  if (Math.abs(v) < 1 && v !== 0) return `${(v * 100).toFixed(2)}%`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// detect-events stores `detail` as JSON.stringify(...). Render it as labeled
// stats, never as a raw JSON string in the user's face.
function parseDetail(detail: string): Array<[string, unknown]> | string {
  const s = detail.trim();
  if (!s.startsWith("{")) return detail;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object") return Object.entries(obj);
  } catch {
    /* fall through to raw */
  }
  return detail;
}

export function HITLCard({ approval, onApprove, onDeny }: HITLCardProps) {
  const input = approval.toolInput || {};
  const event = approval.event || input;
  const symbol = (event.symbol ?? input.symbol ?? "—") as string;
  const eventType = (event.event_type ?? input.event_type ?? approval.toolName) as string;
  const severity = event.severity ?? input.severity;
  const detail = (event.detail ?? input.detail ?? "") as string;
  const windowStart = formatTime(event.window_start as string | undefined);
  const windowEnd = formatTime(event.window_end as string | undefined);

  return (
    <div className="signal" role="alert">
      <div className="signal-head">
        <span>Signal</span>
        {typeof severity === "number" && <span className="meta">{severity.toFixed(1)}σ</span>}
        <span className="meta">{formatTime(approval.requestedAt)}</span>
      </div>
      <p className="signal-title">
        {symbol} · {String(eventType).replace(/_/g, " ")}
      </p>
      {windowStart !== "—" && (
        <p className="signal-detail mono">
          {windowStart} → {windowEnd}
        </p>
      )}
      {detail &&
        (() => {
          const parsed = parseDetail(detail);
          if (typeof parsed === "string") return <p className="signal-detail">{parsed}</p>;
          return (
            <div className="mono" style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, margin: "0 0 12px" }}>
              {parsed.map(([k, v]) => (
                <span key={k} style={{ color: "var(--ink)" }}>
                  <span style={{ color: "var(--signal-deep)" }}>{humanizeKey(k)} </span>
                  {formatValue(v)}
                </span>
              ))}
            </div>
          );
        })()}
      <div className="signal-actions">
        <button className="btn btn-primary" onClick={() => onApprove(approval.id)}>
          Acknowledge
        </button>
        <button className="btn btn-ghost" onClick={() => onDeny(approval.id)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
