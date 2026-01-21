-- Sessions: user state (no auth, sessionId comes from frontend)
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  current_step TEXT CHECK (current_step IN (
    'select_engine',
    'upload_template',
    'mapping',
    'long_text_options',
    'generating',
    'evaluating',
    'done'
  )) DEFAULT 'select_engine',
  chat_history JSONB DEFAULT '[]',
  template_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mappings: template ↔ AirSaas field configuration
CREATE TABLE mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  template_path TEXT NOT NULL,
  mapping_json JSONB,
  fetched_data JSONB,
  long_text_strategy TEXT CHECK (long_text_strategy IN ('summarize', 'ellipsis', 'omit')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id)
);

-- Generated reports: history + evaluation
CREATE TABLE generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  engine TEXT CHECK (engine IN ('gamma', 'claude-pptx')) NOT NULL,
  pptx_path TEXT NOT NULL,
  eval_score INTEGER CHECK (eval_score BETWEEN 0 AND 100),
  iteration INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_mappings_session ON mappings(session_id);
CREATE INDEX idx_reports_session ON generated_reports(session_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to sessions table
CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
