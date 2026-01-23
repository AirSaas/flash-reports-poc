-- Update current_step check constraint to include check_fetched_data step
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_current_step_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_current_step_check CHECK (current_step IN (
  'select_engine',
  'configure_projects',
  'upload_template',
  'check_fetched_data',
  'check_mapping',
  'mapping',
  'long_text_options',
  'generating',
  'evaluating',
  'done'
));
