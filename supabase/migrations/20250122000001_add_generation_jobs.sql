-- Add generation_jobs table for async PPTX generation with polling
CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  engine TEXT NOT NULL DEFAULT 'claude-pptx',

  -- Input data (snapshot at job creation time)
  input_data JSONB,

  -- Output data
  result JSONB,
  error TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Index for polling queries
CREATE INDEX IF NOT EXISTS idx_generation_jobs_session_status ON generation_jobs(session_id, status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status) WHERE status = 'pending';

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_generation_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_generation_jobs_updated_at
  BEFORE UPDATE ON generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_generation_jobs_updated_at();
