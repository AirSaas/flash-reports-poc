-- Add columns for the new mapping workflow

-- Add template_analysis column to store the AI analysis of the PPTX template
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS template_analysis JSONB;

-- Add mapping_state column to track Q&A mapping progress
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mapping_state JSONB;

-- Add fetched_projects_data column to store downloaded AirSaas project data
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS fetched_projects_data JSONB;

-- Update current_step check constraint to include configure_projects step
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_current_step_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_current_step_check CHECK (current_step IN (
  'select_engine',
  'configure_projects',
  'upload_template',
  'check_mapping',
  'mapping',
  'long_text_options',
  'generating',
  'evaluating',
  'done'
));
