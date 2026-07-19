import WebSocket from "ws";

export interface WsConnectionOptions<T> {
  name: string;
  url: string;
  subscribe?: () => string | object | (string | object)[];
  parser: (msg: unknown) => T | T[] | null | undefined;
  onBatch: (rows: T[]) => Promise<void> | void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  maxBackoffMs?: number;
  initialBackoffMs?: number;
}

export class WsConnection<T> {
  private ws?: WebSocket;
  private flushTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private buffer: T[] = [];
  private closed = false;
  private reconnecting = false;
  private backoffMs: number;
  private lastOpenAt?: number;

  constructor(private opts: WsConnectionOptions<T>) {
    this.backoffMs = opts.initialBackoffMs ?? 1000;
  }

  connect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.on("open", () => this.onOpen(ws));
    ws.on("message", (buf) => this.onMessage(buf));
    ws.on("error", (err) => this.onError(err));
    ws.on("close", () => this.onClose());
  }

  private onOpen(ws: WebSocket): void {
    this.backoffMs = this.opts.initialBackoffMs ?? 1000;
    this.lastOpenAt = Date.now();
    this.reconnecting = false;
    this.opts.onConnect?.();

    if (this.opts.subscribe) {
      const raw = this.opts.subscribe();
      const msgs = Array.isArray(raw) ? raw : [raw];
      for (const msg of msgs) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
        }
      }
    }

    this.startFlushTimer();
  }

  private onMessage(buf: WebSocket.RawData): void {
    try {
      const raw = JSON.parse(buf.toString("utf8"));
      const out = this.opts.parser(raw);
      if (!out) return;
      if (Array.isArray(out)) {
        for (const row of out) this.buffer.push(row);
      } else {
        this.buffer.push(out);
      }
      if (this.buffer.length >= (this.opts.maxBufferSize ?? 1000)) {
        this.flush();
      }
    } catch (err) {
      this.log("parse error", err);
    }
  }

  private onError(err: Error): void {
    this.log("error", err.message);
  }

  private onClose(): void {
    this.opts.onDisconnect?.();
    this.stopFlushTimer();
    this.flush(); // send what we have before reconnect/close
    if (!this.closed && !this.reconnecting) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.reconnecting = true;
    this.log("reconnect", `in ${this.backoffMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs ?? 30000);
  }

  forceReconnect(): void {
    if (this.ws) {
      this.log("force reconnect");
      this.ws.terminate();
    } else {
      this.connect();
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.stopFlushTimer();
    this.flush();
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  private startFlushTimer(): void {
    this.stopFlushTimer();
    const interval = this.opts.flushIntervalMs ?? 1500;
    this.flushTimer = setInterval(() => this.flush(), interval);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      Promise.resolve(this.opts.onBatch(batch)).catch((err) => this.log("onBatch error", err));
    } catch (err) {
      this.log("onBatch sync error", err);
    }
  }

  private log(event: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${this.opts.name}`;
    if (data !== undefined) {
      console.log(`${prefix} ${event}:`, data);
    } else {
      console.log(`${prefix} ${event}`);
    }
  }
}
