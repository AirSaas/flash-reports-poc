-- Add fields for template preparation (background HTML conversion)
-- This enables the optimization where PPTX → HTML conversion happens in background
-- while the user continues with other steps

-- HTML template URL (stored in Supabase Storage)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS html_template_url TEXT;

-- Array of PNG URLs for each slide (stored in Supabase Storage)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS template_png_urls JSONB;

-- PDF URL of the converted template (stored in Supabase Storage)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS template_pdf_url TEXT;

-- Status of template preparation job
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS template_preparation_status TEXT
  DEFAULT 'pending'
  CHECK (template_preparation_status IN ('pending', 'processing', 'completed', 'failed'));

-- Error message if preparation failed
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS template_preparation_error TEXT;

-- Index for querying sessions with processing templates
CREATE INDEX IF NOT EXISTS idx_sessions_template_preparation_status
  ON sessions(template_preparation_status)
  WHERE template_preparation_status = 'processing';

-- Comment for documentation
COMMENT ON COLUMN sessions.html_template_url IS 'URL to the HTML template generated from PPTX (stored in Supabase Storage)';
COMMENT ON COLUMN sessions.template_png_urls IS 'Array of URLs to PNG images of each slide';
COMMENT ON COLUMN sessions.template_pdf_url IS 'URL to the PDF version of the template';
COMMENT ON COLUMN sessions.template_preparation_status IS 'Status of background PPTX→HTML conversion: pending, processing, completed, failed';
COMMENT ON COLUMN sessions.template_preparation_error IS 'Error message if template preparation failed';
