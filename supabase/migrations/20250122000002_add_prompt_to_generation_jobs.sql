-- Add prompt column to generation_jobs to store the prompt sent to Gamma/Claude
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS prompt TEXT;

-- Add comment for documentation
COMMENT ON COLUMN generation_jobs.prompt IS 'The prompt/content sent to the generation engine (Gamma or Claude)';
