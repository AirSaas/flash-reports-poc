-- Add anthropic_file_id to sessions table for storing uploaded PPTX file references
ALTER TABLE sessions ADD COLUMN anthropic_file_id TEXT;

-- Update current_step check constraint to include check_mapping step
ALTER TABLE sessions DROP CONSTRAINT sessions_current_step_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_current_step_check CHECK (current_step IN (
  'select_engine',
  'upload_template',
  'check_mapping',
  'mapping',
  'long_text_options',
  'generating',
  'evaluating',
  'done'
));
