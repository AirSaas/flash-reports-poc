-- Add job_type column to support both generation and evaluation jobs
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'generation' CHECK (job_type IN ('generation', 'evaluation'));

-- Add report_id column for evaluation jobs (references the report being evaluated)
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES generated_reports(id) ON DELETE CASCADE;

-- Create index for evaluation jobs
CREATE INDEX IF NOT EXISTS idx_generation_jobs_type ON generation_jobs(job_type);
