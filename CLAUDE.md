# Flash Reports - Technical Documentation

## Overview

Flash Reports is a tool that generates PowerPoint presentations from AirSaas project portfolio data using Claude's PPTX Skill. Users can configure which projects to include, upload a template, map fields, and generate professional reports.

## Architecture

### Tech Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Supabase Edge Functions (Deno)
- **Database**: Supabase PostgreSQL
- **Storage**: Supabase Storage (for templates and generated files)
- **AI**: Anthropic Claude API with PPTX Skill
- **Plan**: Supabase Pro (150s Edge Function timeout)

### Project Structure

```
flash-reports/
├── frontend/                    # React application
│   ├── src/
│   │   ├── components/          # UI components organized by feature
│   │   │   ├── chat/           # Chat interface components
│   │   │   ├── engine/         # Engine selection
│   │   │   ├── generation/     # Report generation UI
│   │   │   ├── layout/         # Header, Sidebar
│   │   │   ├── mapping/        # Field mapping components
│   │   │   ├── options/        # Long text options
│   │   │   ├── projects/       # Project configuration
│   │   │   └── template/       # Template upload/preview
│   │   ├── config/             # Constants and configuration
│   │   ├── hooks/              # React hooks (useSession, useMapping, etc.)
│   │   ├── lib/                # Utilities (storage, supabase client)
│   │   ├── pages/              # Page components (Home.tsx)
│   │   ├── services/           # API service functions
│   │   └── types/              # TypeScript type definitions
│   └── .env.local              # Environment variables
│
├── supabase/
│   ├── functions/              # Edge Functions
│   │   ├── _shared/            # Shared utilities
│   │   │   ├── anthropic.ts    # Claude API helpers, compression
│   │   │   ├── cors.ts         # CORS handling
│   │   │   └── supabase.ts     # Supabase client helpers
│   │   ├── analyze-template/   # Analyzes PPTX template with Claude
│   │   ├── chat/               # Chat endpoint for mapping questions
│   │   ├── check-job-status/   # Polls job status for async generation
│   │   ├── copy-fetched-data/  # Copies project data between sessions
│   │   ├── copy-mapping/       # Copies mapping + data between sessions
│   │   ├── evaluate-report/    # Evaluates generated report quality
│   │   ├── fetch-projects/     # Fetches data from AirSaas API
│   │   ├── generate-claude-pptx/ # Creates job for PPTX generation
│   │   ├── get-session/        # Gets/updates session state
│   │   ├── mapping-question/   # Gets next mapping question
│   │   ├── process-pptx-job/   # Actual PPTX generation with Claude
│   │   └── upload-template/    # Handles template uploads
│   └── migrations/             # Database migrations
```

## Data Flow

### Single Source of Truth

**Project data is stored ONLY in `sessions.fetched_projects_data`**

This simplifies the architecture and prevents data synchronization issues.

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────────────┐
│  AirSaas    │────▶│  fetch-projects  │────▶│ sessions.fetched_projects_  │
│    API      │     │                  │     │           data              │
└─────────────┘     └──────────────────┘     └─────────────────────────────┘
                                                          │
                                                          ▼
                                             ┌─────────────────────────────┐
                                             │   process-pptx-job          │
                                             │   (reads project data)      │
                                             └─────────────────────────────┘
```

### Database Tables

#### `sessions`
- `id` (UUID) - Session identifier (generated client-side)
- `current_step` (text) - Current workflow step
- `fetched_projects_data` (JSONB) - **Single source of truth for project data**
  ```json
  {
    "fetched_at": "2025-01-22T...",
    "workspace": "workspace-id",
    "project_count": 7,
    "successful_count": 7,
    "projects": [{ ... }, { ... }]
  }
  ```
- `created_at`, `updated_at` (timestamps)

#### `mappings`
- `id` (UUID) - Primary key
- `session_id` (UUID) - Foreign key to sessions
- `mapping_json` (JSONB) - Field mapping configuration
- `template_path` (text) - Path to uploaded template
- `long_text_strategy` (text) - 'summarize' | 'ellipsis' | 'omit'
- `created_at` (timestamp)

#### `generated_reports`
- `id` (UUID) - Primary key
- `session_id` (UUID) - Foreign key to sessions
- `engine` (text) - Generation engine used
- `pptx_path` (text) - Path to generated file in storage
- `iteration` (integer) - Report iteration number
- `created_at` (timestamp)

#### `generation_jobs` (for async processing)
- `id` (UUID) - Primary key
- `session_id` (UUID) - Foreign key to sessions
- `status` (text) - 'pending' | 'processing' | 'completed' | 'failed'
- `engine` (text) - Generation engine ('gamma' or 'claude-pptx')
- `input_data` (JSONB) - Snapshot of mapping and project data at job creation
- `result` (JSONB) - Contains reportId, pptxUrl, storagePath, iteration on completion
- `error` (text) - Error message if failed
- `prompt` (text) - The prompt sent to Gamma/Claude for debugging
- `created_at`, `started_at`, `completed_at` (timestamps)

## User Flow

```
┌──────────────────┐
│  Select Engine   │  (claude-pptx)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Configure        │  User selects workspace + projects
│ Projects         │
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Upload Template  │  Or use last template
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Check Fetched    │  Optional: reuse previous data?
│ Data (optional)  │
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Check Mapping    │  Optional: reuse previous mapping?
│ (optional)       │
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Mapping          │  1. fetch-projects (downloads from AirSaas)
│                  │  2. analyze-template (extracts fields)
│                  │  3. mapping-question (user answers Q&A)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Long Text        │  How to handle long texts?
│ Options          │  - Summarize
│                  │  - Truncate with ellipsis
│                  │  - Omit
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Generating       │  Async job-based generation (see below)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Evaluating       │  evaluate-report
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Done             │  Download PPTX
└──────────────────┘
```

## PPTX Generation Architecture (Job-Based Polling)

Due to Claude PPTX Skill taking 60-180 seconds, we use an async job-based architecture:

```
Frontend                              Supabase
   │
   ├──► generate-claude-pptx ────────► Creates job in DB
   │         │                         Returns jobId immediately (~1s)
   │         ▼
   ├──► process-pptx-job ────────────► Processes in background (up to 150s)
   │    (fire-and-forget)              [STEP 1/6] Calling Claude API...
   │                                   [STEP 2/6] Claude responded in XXs
   │                                   [STEP 3/6] Downloading file...
   │                                   [STEP 4/6] Uploading to storage...
   │                                   [STEP 5/6] Saving report record...
   │                                   [STEP 6/6] Marking job completed
   │
   └──► check-job-status ◄───────────► Poll every 3s until completed/failed
        (polling loop, max 3 min)
```

### Why This Architecture?

1. **Supabase Edge Functions timeout**: Even on Pro plan, functions timeout at 150s
2. **Claude PPTX Skill is slow**: With code execution, it takes 60-180s depending on data size
3. **Fire-and-forget from client**: The frontend triggers `process-pptx-job` and immediately starts polling
4. **Job status in database**: Job state is persisted, so even if polling disconnects, state is preserved

### Token Limits for Timeout Prevention

With 150s timeout, we limit data to ~12k tokens (was 25k, caused timeouts):

```typescript
const MAX_DATA_TOKENS = 12000

// Compression steps:
// 1. Apply long text strategy (user-selected)
// 2. Compress to 50 char strings
// 3. If still > 12k, compress to 30 char strings
// 4. If still > 12k, limit number of projects
// 5. Final safety: max 4 projects if > 15k tokens
```

## Key Edge Functions

### `generate-claude-pptx`
Creates a generation job and returns immediately.

**Input**: Session ID (via header)
**Output**: `{ success: true, jobId: "uuid" }`

**Process**:
1. Get session with `fetched_projects_data`
2. Get mapping with `mapping_json`, `long_text_strategy`
3. Create job in `generation_jobs` table with input data snapshot
4. Return jobId immediately (frontend triggers processing)

### `process-pptx-job`
Actually generates the PPTX using Claude. Called by frontend after receiving jobId.

**Input**: `{ jobId: "uuid" }`
**Output**: Updates job status in database

**Process**:
1. Mark job as 'processing'
2. Apply long text strategy to data
3. Compress data aggressively (12k token limit)
4. Call Claude with PPTX Skill
5. Download file from Anthropic Files API
6. Upload to Supabase Storage
7. Save report reference
8. Mark job as 'completed' with result

**Logs**:
```
[STEP 1/6] Calling Claude API with PPTX Skill...
[STEP 2/6] Claude API responded in XXXms (XX.Xs)
[STEP 3/6] Found file_id: xxx, downloading from Anthropic...
[STEP 4/6] Downloaded file (XX KB), uploading to Supabase Storage...
[STEP 5/6] Uploaded to storage: xxx, saving report record...
[STEP 6/6] Marking job as completed...
✅ Job xxx completed successfully in XX.Xs
```

### `check-job-status`
Polling endpoint to check job progress.

**Input**: `{ jobId: "uuid" }`
**Output**: `{ success: true, job: { id, status, result, error, ... } }`

### `fetch-projects`
Downloads project data from AirSaas API and stores in session.

**Input**: `projectsConfig` with workspace and project list
**Output**: Saves to `sessions.fetched_projects_data`

### `copy-mapping`
Copies mapping configuration AND project data from a previous session.

**Input**: `sourceMappingId`
**Actions**:
1. Copies `mapping_json`, `template_path`, `long_text_strategy` to new mapping
2. Copies `fetched_projects_data` from source session to current session

### `copy-fetched-data`
Copies project data between sessions (used when reusing previous fetch).

**Input**: `sourceSessionId`
**Action**: Copies `fetched_projects_data` from source to current session

## Frontend State Management

### localStorage Persistence
Session state is persisted to localStorage via `storage.ts`:
- `sessionId` - Current session UUID
- `lastTemplateId` - Last used template path
- `lastMappingId` - Last mapping ID for reuse
- `lastFetchedDataId` - Last session ID with fetched data
- `hasFetchedData` - Whether current session has data
- `projectsConfig` - Selected projects configuration

### Key Hooks

- `useSession` - Manages session state and step navigation
- `useMapping` - Handles the mapping Q&A flow
- `useGenerate` - Manages report generation with polling
- `useUpload` - Handles template file uploads

### Polling in useGenerate

```typescript
// Polling configuration
const POLL_INTERVAL = 3000 // 3 seconds
const MAX_POLL_TIME = 3 * 60 * 1000 // 3 minutes max

// Flow:
// 1. Call generate-claude-pptx → get jobId
// 2. triggerJobProcessing(jobId) - fire and forget
// 3. pollJobStatus(jobId) - recursive polling until completed/failed/timeout
```

## Token Management

Claude has context limits. The system manages tokens by:

1. **Long Text Strategy** - User-selected (summarize/ellipsis/omit)
2. **Data Compression** (`compressProjectData` in `_shared/anthropic.ts`):
   - Removes metadata fields (id, type, settings, etc.)
   - Limits array lengths (20 items max)
   - Truncates long strings (30-50 chars for aggressive compression)
3. **Dynamic Project Limiting** - If still too large, limits number of projects
4. **Hard Limit** - Max 4 projects if tokens > 15k

Target: ~12k tokens for data to stay under ~20k total prompt (safe for 150s timeout).

## Deployment

### Edge Functions
```bash
# Deploy all functions
npx supabase functions deploy <function-name> --project-ref wlvpwlygitzhrkrvrfwj --use-api --no-verify-jwt

# Key functions:
npx supabase functions deploy generate-claude-pptx --project-ref wlvpwlygitzhrkrvrfwj --use-api --no-verify-jwt
npx supabase functions deploy process-pptx-job --project-ref wlvpwlygitzhrkrvrfwj --use-api --no-verify-jwt
npx supabase functions deploy check-job-status --project-ref wlvpwlygitzhrkrvrfwj --use-api --no-verify-jwt
npx supabase functions deploy copy-mapping --project-ref wlvpwlygitzhrkrvrfwj --use-api --no-verify-jwt
npx supabase functions deploy fetch-projects --project-ref wlvpwlygitzhrkrvrfwj --use-api --no-verify-jwt
```

Note: `--use-api` is required because Docker is not available locally.

### Frontend
```bash
cd frontend
npm run dev    # Development
npm run build  # Production build
```

## Environment Variables

### Frontend (`.env.local`)
```
VITE_SUPABASE_URL=https://wlvpwlygitzhrkrvrfwj.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### Supabase Functions
Set in Supabase Dashboard > Settings > Edge Functions:
- `ANTHROPIC_API_KEY` - Claude API key
- `AIRSAAS_API_KEY` - AirSaas API key (if needed)

## Testing with cURL/Postman

### Create a job
```bash
curl -X POST 'https://wlvpwlygitzhrkrvrfwj.supabase.co/functions/v1/generate-claude-pptx' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <ANON_KEY>' \
  -H 'x-session-id: <SESSION_ID>'
```

### Process a job (set timeout to 5 min in Postman)
```bash
curl -X POST 'https://wlvpwlygitzhrkrvrfwj.supabase.co/functions/v1/process-pptx-job' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <ANON_KEY>' \
  -d '{"jobId": "<JOB_ID>"}'
```

### Check job status
```bash
curl -X POST 'https://wlvpwlygitzhrkrvrfwj.supabase.co/functions/v1/check-job-status' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <ANON_KEY>' \
  -H 'x-session-id: <SESSION_ID>' \
  -d '{"jobId": "<JOB_ID>"}'
```

## Common Issues & Solutions

### Job stuck in "processing"
**Cause**: Function timed out while calling Claude.
**Solution**:
1. Run SQL: `UPDATE generation_jobs SET status = 'failed', error = 'Timeout' WHERE status = 'processing';`
2. Reduce data size (check token count in logs)
3. Try again

### "No project data available"
**Cause**: `sessions.fetched_projects_data` is NULL or empty.
**Solution**: Ensure `fetch-projects` ran successfully, or that `copy-mapping` copied data from source session.

### 504 Gateway Timeout
**Cause**: Function exceeded 150s timeout (Pro plan limit).
**Solution**: Data is too large. Check logs for token count. Reduce `MAX_DATA_TOKENS` or limit projects.

### "No mapping found for session"
**Cause**: Mapping wasn't created or copied for current session.
**Solution**: Complete the mapping step or use "Use Last Mapping" which calls `copy-mapping`.

### "No PPTX file generated - could not find file_id"
**Cause**: Claude didn't generate a file (may have errored or returned text only).
**Solution**: Check Claude response in logs. May need to adjust prompt or reduce data.

## Database Migrations

### `generation_jobs` table (20250122000001)
```sql
CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  engine TEXT NOT NULL DEFAULT 'claude-pptx',
  input_data JSONB,
  result JSONB,
  error TEXT,
  prompt TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_session_status ON generation_jobs(session_id, status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status) WHERE status = 'pending';
```

### Cleanup migration (20250123000001)
```sql
-- Remove unused columns:
-- - mappings.fetched_data: Redundant, data is in sessions.fetched_projects_data
-- - generation_jobs.updated_at: Never used
ALTER TABLE mappings DROP COLUMN IF EXISTS fetched_data;
ALTER TABLE generation_jobs DROP COLUMN IF EXISTS updated_at;
```

## Future Improvements

1. **Streaming progress** - Use Supabase Realtime to stream job progress instead of polling
2. **Retry logic** - Automatically retry failed jobs with backoff
3. **Queue management** - Limit concurrent jobs per user
4. **Caching** - Cache AirSaas responses to reduce API calls
5. **Webhook triggers** - Use database webhooks instead of client-triggered processing
