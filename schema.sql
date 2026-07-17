CREATE TABLE IF NOT EXISTS calls (
    call_sid VARCHAR(50) PRIMARY KEY,
    to_number VARCHAR(20),
    status VARCHAR(20) DEFAULT 'in-progress',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_secs INTEGER,
    recording_url TEXT,
    transcript JSONB,
    total_cost NUMERIC(10, 5) DEFAULT 0,
    agent_name VARCHAR(50),
    cost_breakdown JSONB
);

CREATE TABLE IF NOT EXISTS call_events (
    id SERIAL PRIMARY KEY,
    call_sid VARCHAR(50) REFERENCES calls(call_sid) ON DELETE CASCADE,
    event_type VARCHAR(50), -- e.g., 'stt_connect', 'ttft', 'barge_in', 'llm_response', 'tts_audio'
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_events_call_sid ON call_events(call_sid);
