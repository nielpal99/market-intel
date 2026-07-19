import { pgTable, uuid, text, timestamp, boolean, real, integer, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const watchlists = pgTable("watchlists", {
  userId: uuid("user_id").references(() => users.id).notNull(),
  symbol: text("symbol").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
});

export const savedInvestigations = pgTable("saved_investigations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  chatId: text("chat_id").notNull(),
  turnIndex: integer("turn_index").notNull(),
  question: text("question").notNull(),
  widgetSnapshot: jsonb("widget_snapshot").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).defaultNow(),
});

export const alertSubscriptions = pgTable("alert_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  symbol: text("symbol").notNull(),
  eventType: text("event_type").notNull(),
  minSeverity: real("min_severity").notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const hitlApprovals = pgTable("hitl_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  chatId: text("chat_id").notNull(),
  toolName: text("tool_name").notNull(),
  toolInput: jsonb("tool_input").notNull(),
  status: text("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ranAt: timestamp("ran_at", { withTimezone: true }).defaultNow(),
  question: text("question").notNull(),
  expectedWidget: text("expected_widget"),
  actualWidget: text("actual_widget"),
  passed: boolean("passed").notNull(),
  latencyMs: integer("latency_ms"),
});
