-- Migration: Cleanup unused columns
-- Date: 2025-01-23
-- Description: Remove redundant and unused columns from the database
--
-- ANALYSIS SUMMARY:
-- 1. mappings.fetched_data: REDUNDANT - Data is stored in sessions.fetched_projects_data (single source of truth)
--    - Written in mapping-question but the value returned by get-session is never consumed by frontend
--    - Safe to remove as all functions use sessions.fetched_projects_data
--
-- 2. generation_jobs.updated_at: NEVER USED - Has trigger but never read or written manually
--    - Can be safely removed along with its trigger
--

-- Step 1: Remove the unused trigger for generation_jobs.updated_at
DROP TRIGGER IF EXISTS trigger_update_generation_jobs_updated_at ON generation_jobs;
DROP FUNCTION IF EXISTS update_generation_jobs_updated_at();

-- Step 2: Remove unused columns
ALTER TABLE mappings DROP COLUMN IF EXISTS fetched_data;
ALTER TABLE generation_jobs DROP COLUMN IF EXISTS updated_at;

-- Step 3: Add comments for documentation
COMMENT ON TABLE sessions IS 'User sessions - fetched_projects_data is the SINGLE SOURCE OF TRUTH for project data';
COMMENT ON COLUMN sessions.fetched_projects_data IS 'Single source of truth for all project data fetched from AirSaas';
COMMENT ON TABLE mappings IS 'Template to AirSaas field mappings - project data is in sessions.fetched_projects_data';
