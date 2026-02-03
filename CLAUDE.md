# Flash Reports - Technical Documentation

## Overview

Flash Reports generates professional portfolio reports from AirSaas project data. It supports two generation engines:

- **Claude HTML** (Primary): HTML/PDF/PPTX reports via Python FastAPI backend with Claude Vision
- **Claude PPTX** (Legacy): PowerPoint via Claude's PPTX Skill in Supabase Edge Functions

Users select projects from AirSaas smartviews, upload a PPTX template, map fields via AI-assisted Q&A, and generate reports.

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend (Python) | FastAPI for HTML generation with Claude Vision |
| Backend (Supabase) | Edge Functions (Deno) for PPTX generation |
| Database | Supabase PostgreSQL |
| Storage | Supabase Storage (templates, outputs buckets) |
| AI | Anthropic Claude API (Vision + PPTX Skill) |
| Plan | Supabase Pro (150s Edge Function timeout) |

### Project Structure

```
flash-reports/
├── frontend/                    # React application
│   ├── src/
│   │   ├── components/          # UI components by feature
│   │   │   ├── engine/          # EngineSelector
│   │   │   ├── generation/      # GenerationProgress, EvaluationResult
│   │   │   ├── layout/          # Header, Sidebar
│   │   │   ├── mapping/         # BatchMappingEditor, SlideSelector, UseLastMapping
│   │   │   ├── options/         # LongTextOptions
│   │   │   ├── projects/        # SmartviewSelector
│   │   │   └── template/        # TemplateUpload, TemplatePreview, UseLastTemplate
│   │   ├── hooks/               # React hooks
│   │   │   ├── useSession.ts    # Session state management
│   │   │   ├── useMapping.ts    # Mapping workflow with template preparation
│   │   │   ├── useGenerate.ts   # Report generation with polling
│   │   │   ├── useUpload.ts     # Template upload + preparation trigger
│   │   │   ├── useTemplatePreparation.ts  # Background conversion status
│   │   │   └── useChat.ts       # Chat conversation (legacy)
│   │   ├── services/            # API service functions
│   │   │   ├── session.service.ts         # Session and data management
│   │   │   ├── smartview.service.ts       # AirSaas smartview API
│   │   │   ├── template-preparation.service.ts  # Background conversion
│   │   │   ├── python-backend.service.ts  # Python backend calls
│   │   │   ├── generate.service.ts        # Report generation
│   │   │   ├── upload.service.ts          # Template upload
│   │   │   ├── evaluate.service.ts        # Report evaluation
│   │   │   └── chat.service.ts            # Chat/mapping conversation
│   │   ├── lib/                 # Utilities (storage, supabase client)
│   │   ├── pages/               # Home.tsx (main page)
│   │   └── types/               # TypeScript definitions
│   └── .env.local
│
├── backend/                     # Python FastAPI backend
│   ├── app/
│   │   ├── main.py              # FastAPI application + job processing
│   │   ├── config.py            # Environment configuration
│   │   └── services/
│   │       ├── converter.py     # PPTX → PDF → PNG conversion
│   │       ├── claude_html.py   # HTML generation with Claude Vision (exact replica)
│   │       ├── data_populator.py  # HTML population with project data
│   │       ├── pdf_generator.py   # HTML → PDF (WeasyPrint)
│   │       └── supabase_client.py # Database/Storage operations
│   ├── requirements.txt
│   └── .env
│
├── supabase/
│   ├── functions/               # Edge Functions
│   │   ├── _shared/             # Shared utilities
│   │   ├── analyze-template/    # Field analysis (uses pre-generated HTML)
│   │   ├── fetch-projects/      # Downloads data from AirSaas
│   │   ├── list-smartviews/     # Lists AirSaas smartviews
│   │   ├── get-smartview-projects/  # Gets projects in a smartview
│   │   ├── mapping-batch/       # Generates mapping suggestions
│   │   ├── mapping-batch-submit/# Saves user's mapping choices
│   │   ├── copy-mapping/        # Reuses mapping from previous session
│   │   ├── copy-fetched-data/   # Reuses project data
│   │   ├── generate-claude-pptx/# Creates PPTX generation job
│   │   ├── process-pptx-job/    # Executes PPTX generation
│   │   └── check-job-status/    # Polls job status
│   └── migrations/
│
├── CLAUDE.md                    # This file
├── README.md                    # Quick start guide
└── SPEC.md                      # Original specification
```

## User Flow

```
┌──────────────────────┐
│ 1. Select Engine     │  (claude-html recommended)
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 2. Select Smartview  │  User picks smartview from AirSaas dropdown
│    + Projects        │  Preview shows projects in the smartview
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 3. Upload Template   │  Or "Use Last Template" (reuses cached HTML)
│    [Background:      │  Triggers PPTX → HTML conversion in background
│     PPTX → HTML]     │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 4. Reuse Data?       │  Optional: "Use cached data" from previous session
│    (if available)    │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 5. Reuse Mapping?    │  Optional: "Use last mapping" (copies mapping+data)
│    (if available)    │
└──────────┬───────────┘
           ▼
┌──────────────────────┐     ┌─────────────────────────────────────────┐
│ 6. Mapping           │     │ Sub-steps:                              │
│                      │ ──► │ a) Wait for template preparation        │
│                      │     │ b) Download project data from AirSaas   │
│                      │     │ c) List slides (from HTML or PPTX)      │
│                      │     │ d) User selects unique slide templates  │
│                      │     │ e) analyze-template extracts fields     │
│                      │     │ f) mapping-batch generates suggestions  │
│                      │     │ g) User reviews/edits in BatchMappingEditor │
└──────────┬───────────┘     └─────────────────────────────────────────┘
           ▼
┌──────────────────────┐
│ 7. Long Text Options │  How to handle long text: Summarize/Truncate/Omit
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 8. Generating        │  Job-based async generation with polling
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 9. Done              │  Download HTML, PDF, or PPTX
└──────────────────────┘
```

## Core Flows

### Flow 1: Background Template Preparation (PPTX → HTML)

This optimization runs immediately after template upload to pre-convert PPTX to HTML, making subsequent steps faster.

```
Frontend                              Python Backend
   │
   ├──► uploadTemplate(file) ────────► Stores PPTX in Supabase Storage
   │         │
   │         ▼
   ├──► POST /prepare-template ──────► Background task:
   │    (fire-and-forget)              1. Download PPTX
   │                                   2. Convert PPTX → PDF → PNG
   │                                   3. Send PNGs to Claude Vision
   │                                   4. Generate exact HTML replica
   │                                   5. Store HTML in Storage
   │                                   6. Update session status → 'completed'
   │
   │    [User continues with steps]
   │
   └──► useMapping.waitForTemplatePreparation()
        (polls until completed/failed/timeout)
```

**Key Insight**: Claude Vision generates an EXACT REPLICA of the PPTX - no placeholders. The actual text, dates, numbers, and names from the original are preserved. Field identification happens later in `analyze-template`.

### Flow 2: Template Analysis (Field Detection)

```
Frontend                              analyze-template Edge Function
   │
   ├──► analyzeTemplate(path, slideNumbers) ──►
   │                                   │
   │                                   ▼
   │                          1. Load HTML from Storage (optimized path)
   │                             OR parse PPTX (fallback path)
   │                          2. Filter to user-selected slides
   │                          3. Send to Claude with ANALYSIS_PROMPT
   │                          4. Claude compares structurally similar slides:
   │                             - Slide 1: "Project: Alpha", "Budget: $50K"
   │                             - Slide 2: "Project: Beta", "Budget: $75K"
   │                             → Identifies: project_name, budget fields
   │                          5. Returns field definitions
   │
   └──◄──────────────────────────────────────◄──┘
```

### Flow 3: HTML Report Generation (Claude HTML Engine)

```
Frontend                              Python Backend
   │
   ├──► POST /generate-html ─────────► Creates job in DB
   │         │                         Returns jobId immediately
   │         ▼
   │    Background Task ─────────────► [STEP 1/6] Load session data
   │                                   [STEP 2/6] Validate projects
   │                                   [STEP 3-5] Use cached HTML template
   │                                              (or convert PPTX if not cached)
   │                                   [STEP 6/6] Populate HTML with Claude:
   │                                              - SLIDE 1: Portfolio Overview (all projects)
   │                                              - SLIDES 2-N: Per-project slides
   │                                              - LAST SLIDE: Data Notes
   │                                   Upload HTML, PDF, PPTX to Storage
   │
   └──► POST /job-status ◄───────────► Poll every 3s until completed
```

**Multi-Project Report Structure** (MANDATORY):
1. **First Slide**: Portfolio Overview - table/grid of ALL projects with Status, Mood, Progress %
2. **Middle Slides**: Complete template set repeated for each project
3. **Last Slide**: Data Notes - timestamp + list of missing fields

## Database Schema

### `sessions` table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Session identifier |
| current_step | TEXT | Current workflow step |
| template_path | TEXT | Path to uploaded PPTX |
| fetched_projects_data | JSONB | **Single source of truth for project data** |
| html_template_url | TEXT | URL to pre-generated HTML template |
| template_png_urls | JSONB | Array of slide PNG URLs |
| template_pdf_url | TEXT | URL to template PDF |
| template_preparation_status | TEXT | 'pending' \| 'processing' \| 'completed' \| 'failed' |
| template_preparation_error | TEXT | Error message if failed |
| created_at, updated_at | TIMESTAMP | Timestamps |

### `mappings` table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | Foreign key to sessions |
| mapping_json | JSONB | Field mapping configuration |
| template_path | TEXT | Path to template used |
| long_text_strategy | TEXT | 'summarize' \| 'ellipsis' \| 'omit' |
| created_at | TIMESTAMP | Creation time |

### `generation_jobs` table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Job identifier |
| session_id | UUID | Foreign key to sessions |
| status | TEXT | 'pending' \| 'processing' \| 'completed' \| 'failed' |
| engine | TEXT | 'claude-html' or 'claude-pptx' |
| input_data | JSONB | Snapshot of mapping and data |
| result | JSONB | Output URLs and metadata |
| error | TEXT | Error message if failed |
| created_at, started_at, completed_at | TIMESTAMP | Timing info |

## Python Backend Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API info |
| `/health` | GET | Health check |
| `/prepare-template` | POST | Start background PPTX → HTML conversion |
| `/template-preparation-status` | POST | Check preparation status |
| `/list-slides` | POST | List slides from PPTX (legacy) |
| `/list-slides-from-html` | POST | List slides from pre-generated HTML (optimized) |
| `/generate-html` | POST | Create HTML generation job (async) |
| `/job-status` | POST | Check job status |
| `/analyze-template` | POST | Analyze PPTX and generate HTML (legacy, not used in main flow) |
| `/preview-template` | GET | Preview HTML template before population |
| `/generate-direct` | POST | Synchronous generation (testing only) |

## Edge Functions

| Function | Description |
|----------|-------------|
| `list-smartviews` | Lists AirSaas smartviews |
| `get-smartview-projects` | Gets projects in a smartview |
| `fetch-projects` | Downloads full project data from AirSaas |
| `analyze-template` | Identifies fields by comparing similar slides (uses pre-generated HTML) |
| `mapping-batch` | Generates AI mapping suggestions for all fields |
| `mapping-batch-submit` | Saves user's mapping choices |
| `mapping-question` | Legacy one-by-one mapping Q&A flow |
| `copy-mapping` | Copies mapping + data from previous session |
| `copy-fetched-data` | Copies only project data |
| `get-session` | Gets/updates session state |
| `upload-template` | Registers uploaded template in session |
| `chat` | Chat endpoint for mapping conversation |
| `generate-claude-pptx` | Creates PPTX generation job |
| `process-pptx-job` | Executes PPTX generation with Claude Skill |
| `check-job-status` | Polls job status |
| `create-eval-job` | Creates evaluation job |
| `process-eval-job` | Evaluates generated report quality |

## Environment Variables

### Frontend (`.env.local`)
```env
VITE_SUPABASE_URL=https://wlvpwlygitzhrkrvrfwj.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_PYTHON_BACKEND_URL=http://localhost:8000
```

### Python Backend (`.env`)
```env
SUPABASE_URL=https://wlvpwlygitzhrkrvrfwj.supabase.co
SUPABASE_KEY=<service-role-key>
ANTHROPIC_API_KEY=sk-ant-xxx
```

### Supabase Edge Functions
Set in Supabase Dashboard > Settings > Edge Functions:
- `ANTHROPIC_API_KEY`
- `AIRSAAS_API_KEY`

## Running the Project

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Python Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Install system dependencies (macOS)
brew install poppler glib pango cairo

# Run server
uvicorn app.main:app --reload --port 8000
```

### Deploying Edge Functions
```bash
npx supabase functions deploy <function-name> --project-ref wlvpwlygitzhrkrvrfwj --use-api --no-verify-jwt
```

## Troubleshooting

### Job stuck in "processing"
```sql
UPDATE generation_jobs SET status = 'failed', error = 'Timeout' WHERE status = 'processing';
```

### "No project data available"
Ensure `fetch-projects` ran successfully, or use "Use Last Mapping" which copies data.

### Template preparation stuck
Check Python backend logs. Common causes:
- Claude API timeout
- Invalid PPTX file
- Poppler not installed (`brew install poppler`)

### PDF generation not available
Install WeasyPrint dependencies:
```bash
brew install glib pango cairo  # macOS
```

---

## Deprecated Code

The following code is deprecated and should be removed after **2025-03-15**.

### Frontend Components

| File | Status | Replacement | Reason |
|------|--------|-------------|--------|
| `components/projects/ProjectsConfig.tsx` | DEPRECATED | `SmartviewSelector.tsx` | Old flow required manual JSON input. New flow selects from AirSaas smartviews. |

### Frontend Services & Hooks

| File/Function | Status | Replacement | Reason |
|---------------|--------|-------------|--------|
| `session.service.ts: fetchProjects()` | DEPRECATED | `fetchProjectsFromSmartview()` | Accepted legacy `projectsConfig` format |
| `session.service.ts: ProjectsConfig` interface | DEPRECATED | `SmartviewConfig` | Old data format |
| `useSession.ts: setProjectsConfig()` | DEPRECATED | `setSmartviewSelection()` | Old state setter |

### Frontend Types

| Type | Status | Replacement | Reason |
|------|--------|-------------|--------|
| `ProjectsConfig` in `types/session.ts` | DEPRECATED | `SmartviewSelection` | Legacy JSON format |
| `SessionState.projectsConfig` | DEPRECATED | `SessionState.smartviewSelection` | Old state field |

### Frontend State

| Storage Key | Status | Replacement | Reason |
|-------------|--------|-------------|--------|
| `projectsConfig` in localStorage | DEPRECATED | `smartviewSelection` | Old manual project configuration |

### Frontend Constants

| Constant | Status | Replacement | Reason |
|----------|--------|-------------|--------|
| `AIRSAAS_PROJECTS` in `config/constants.ts` | DEPRECATED | Dynamic from smartviews | Was hardcoded default project list |

### Edge Functions

| Function | Status | Notes |
|----------|--------|-------|
| `fetch-projects` with `projectsConfig` param | BACKWARD COMPAT | Still accepts legacy format, prefer `smartviewConfig` |
| `generate-gamma`, `process-gamma-job` | UNUSED | Gamma API integration was removed |

### Python Backend

| Code | Status | Replacement | Reason |
|------|--------|-------------|--------|
| `/list-slides` endpoint | LEGACY | `/list-slides-from-html` | Slower PPTX parsing, use HTML when available |
| `/generate-direct` endpoint | TESTING ONLY | `/generate-html` with jobs | Synchronous, doesn't scale |

### Database

| Column | Status | Reason |
|--------|--------|--------|
| `mappings.fetched_data` | REMOVED | Data moved to `sessions.fetched_projects_data` |
| `generation_jobs.updated_at` | REMOVED | Never used |

---

## Future Improvements

1. **Streaming progress**: Use Supabase Realtime instead of polling
2. **Retry logic**: Auto-retry failed jobs with backoff
3. **Slide selection persistence**: Save `uniqueSlideNumbers` for filtering in generation
4. **Caching**: Cache AirSaas responses to reduce API calls
5. **Webhooks**: Database webhooks instead of client-triggered processing
