CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Demo user for single-tenant runs; identity is injected server-side
-- (DEMO_USER_ID in src/lib/agent-tools.ts), never supplied by the model.
INSERT INTO users (id, email) VALUES
    ('00000000-0000-0000-0000-000000000001', 'demo@market-intel.local')
    ON CONFLICT (id) DO NOTHING;

CREATE TABLE watchlists (
    user_id UUID REFERENCES users(id),
    symbol TEXT NOT NULL,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, symbol)
);

CREATE TABLE saved_investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    chat_id TEXT NOT NULL,
    turn_index INT NOT NULL,
    question TEXT NOT NULL,
    widget_snapshot JSONB NOT NULL,
    saved_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alert_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    symbol TEXT NOT NULL,
    event_type TEXT NOT NULL,
    min_severity FLOAT NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE hitl_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    chat_id TEXT NOT NULL,
    tool_call_id TEXT UNIQUE,
    tool_name TEXT NOT NULL,
    tool_input JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE eval_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ran_at TIMESTAMPTZ DEFAULT NOW(),
    question TEXT NOT NULL,
    expected_widget TEXT,
    actual_widget TEXT,
    passed BOOLEAN NOT NULL,
    latency_ms INT
);
