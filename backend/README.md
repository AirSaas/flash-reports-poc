# Flash Reports Backend

FastAPI backend for Flash Reports presentation generation. Provides a REST API compatible with the existing React frontend, using Claude PPTX Skill for PowerPoint generation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FLASH REPORTS BACKEND                               │
│                         (FastAPI + Claude PPTX Skill)                            │
└─────────────────────────────────────────────────────────────────────────────────┘

Frontend (React)
    │
    ├──► POST /functions/v1/get-session ──────────────► Session state
    ├──► POST /functions/v1/upload-template ──────────► Register template
    ├──► POST /functions/v1/analyze-template ─────────► Claude analyzes PPTX
    ├──► POST /functions/v1/fetch-projects ───────────► AirSaas API data
    ├──► POST /functions/v1/mapping-question ─────────► Interactive Q&A
    ├──► POST /functions/v1/chat ─────────────────────► SSE Stream (optional)
    │
    ├──► POST /functions/v1/generate-claude-pptx ─────► Create job
    ├──► POST /functions/v1/process-pptx-job ─────────► Background processing
    │           │
    │           ▼
    │    ┌─────────────────────────────────────────────────────────────┐
    │    │                 CLAUDE PPTX SKILL                           │
    │    │                                                             │
    │    │   • Generates PowerPoint from project data                  │
    │    │   • Uses code execution for pptx generation                 │
    │    │   • Downloads file from Anthropic Files API                 │
    │    │   • Uploads to Supabase Storage                             │
    │    └─────────────────────────────────────────────────────────────┘
    │           │
    │           ▼
    └──► POST /functions/v1/check-job-status ─────────► Poll for completion
```

## API Endpoints

All endpoints are prefixed with `/functions/v1/` for compatibility with the Supabase Edge Functions API the frontend expects.

### Session Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/functions/v1/get-session` | Get session state, update strategy, or get fetched data info |

### Template & Mapping

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/functions/v1/upload-template` | Register uploaded template path |
| POST | `/functions/v1/analyze-template` | Analyze PPTX template with Claude |
| POST | `/functions/v1/mapping-question` | Interactive Q&A for field mapping |
| POST | `/functions/v1/chat` | Chat endpoint (SSE streaming supported) |

### Data Fetching

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/functions/v1/fetch-projects` | Fetch project data from AirSaas API |
| POST | `/functions/v1/copy-mapping` | Copy mapping + data from another session |
| POST | `/functions/v1/copy-fetched-data` | Copy project data from another session |

### PPTX Generation (Async Job-Based)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/functions/v1/generate-claude-pptx` | Create generation job, returns jobId |
| POST | `/functions/v1/process-pptx-job` | Process job in background (fire-and-forget) |
| POST | `/functions/v1/check-job-status` | Poll job status until completed/failed |

### Evaluation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/functions/v1/create-eval-job` | Create evaluation job for generated report |
| POST | `/functions/v1/process-eval-job` | Process evaluation in background |

## Local Development

### Prerequisites

- Python 3.11+
- Node.js 20+ (for PPTX converter, if using local export)
- Supabase project with tables (sessions, mappings, generation_jobs, generated_reports)

### Setup

1. Clone and navigate to backend:
```bash
cd backend
```

2. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or
venv\Scripts\activate  # Windows
```

3. Install Python dependencies:
```bash
pip install -r requirements.txt
```

4. (Optional) Install Node.js dependencies for PPTX converter:
```bash
cd pptx_converter
npm install
cd ..
```

5. Configure environment:
```bash
cp .env.example .env
# Edit .env with your credentials
```

6. Run the server:
```bash
python main.py
# or
uvicorn main:app --reload --port 8000
```

## Environment Variables

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # Optional

# Anthropic Configuration
ANTHROPIC_API_KEY=sk-ant-your-api-key

# AirSaas Configuration
AIRSAAS_API_KEY=your-airsaas-api-key

# Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=false

# CORS Configuration
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

## Deployment on Render

### Option 1: Using render.yaml (Blueprint)

1. Push code to GitHub
2. In Render dashboard, create "New Blueprint Instance"
3. Connect your GitHub repo
4. Configure environment variables in Render dashboard

### Option 2: Manual Setup

1. Create new "Web Service" in Render
2. Connect GitHub repository
3. Settings:
   - **Environment**: Docker
   - **Dockerfile Path**: `./backend/Dockerfile`
   - **Docker Context**: `./backend`
4. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY`
   - `CORS_ORIGINS` (your frontend URL)

## Generation Flow

The PPTX generation uses an async job-based architecture:

```
1. Frontend calls generate-claude-pptx
   └── Creates job in DB, returns jobId immediately

2. Frontend calls process-pptx-job (fire-and-forget)
   └── Starts background processing

3. Background task runs:
   [STEP 1/6] Calling Claude API with PPTX Skill...
   [STEP 2/6] Claude responded in XXs
   [STEP 3/6] Downloading file from Anthropic Files API...
   [STEP 4/6] Uploading to Supabase Storage...
   [STEP 5/6] Saving report record...
   [STEP 6/6] Marking job completed

4. Frontend polls check-job-status every 3s
   └── Returns when status = 'completed' or 'failed'
```

### Token Management

To prevent timeouts, project data is compressed:

```python
MAX_DATA_TOKENS = 12000

# Compression steps:
# 1. Apply long text strategy (summarize/ellipsis/omit)
# 2. Compress strings to 50 chars
# 3. If still > 12k tokens, compress to 30 chars
# 4. If still > 12k tokens, limit number of projects
# 5. Safety limit: max 4 projects if > 15k tokens
```

## File Structure

```
backend/
├── main.py                 # FastAPI application with all endpoints
├── models.py               # Pydantic/dataclass models
├── config.py               # Settings management (pydantic-settings)
├── database.py             # Supabase client and operations
├── session_manager.py      # Session state management
│
├── airsaas.py              # AirSaas API client, data compression
├── template_analyzer.py    # Template analysis with Claude
├── mapping_engine.py       # Field mapping Q&A logic
├── chat_handler.py         # Chat endpoint with SSE streaming
├── pptx_generator.py       # PPTX generation with Claude Skill
├── report_evaluator.py     # Report quality evaluation
│
├── pptx_converter/         # Node.js PPTX export (legacy)
│   ├── convert.js
│   └── package.json
│
├── requirements.txt        # Python dependencies
├── Dockerfile              # Multi-stage Docker build
├── render.yaml             # Render Blueprint config
└── .env.example            # Environment variables template
```

## Database Schema

Uses Supabase PostgreSQL with these tables:

### `sessions`
- `id` (UUID) - Session identifier
- `current_step` (text) - Workflow step
- `fetched_projects_data` (JSONB) - Project data from AirSaas
- `template_analysis` (JSONB) - Claude's template analysis
- `mapping_state` (JSONB) - Current mapping Q&A state
- `anthropic_file_id` (text) - Template file ID in Anthropic
- `created_at`, `updated_at`

### `mappings`
- `id` (UUID) - Primary key
- `session_id` (UUID) - Foreign key
- `mapping_json` (JSONB) - Field mapping configuration
- `template_path` (text) - Path to uploaded template
- `long_text_strategy` (text) - 'summarize' | 'ellipsis' | 'omit'

### `generation_jobs`
- `id` (UUID) - Job identifier
- `session_id` (UUID) - Foreign key
- `job_type` (text) - 'generation' or 'evaluation'
- `status` (text) - 'pending' | 'processing' | 'completed' | 'failed'
- `engine` (text) - 'claude-pptx'
- `input_data` (JSONB) - Snapshot of data at job creation
- `result` (JSONB) - Output on completion
- `error` (text) - Error message if failed
- `prompt` (text) - Prompt sent to Claude (for debugging)
- `created_at`, `started_at`, `completed_at`

### `generated_reports`
- `id` (UUID) - Report identifier
- `session_id` (UUID) - Foreign key
- `engine` (text) - Generation engine used
- `pptx_path` (text) - Storage path for PPTX file
- `iteration` (int) - Report version number
- `eval_score` (int) - Evaluation score (0-100)

## Dependencies

```
# Web framework
fastapi==0.109.2
uvicorn[standard]==0.27.1

# Anthropic SDK (for Claude PPTX Skill)
anthropic==0.43.0

# Supabase
supabase==2.3.4

# Settings management
pydantic-settings==2.1.0

# HTTP client
httpx==0.26.0

# Async support
python-multipart==0.0.9

# Development
python-dotenv==1.0.1
```

## Common Issues

### Job stuck in "processing"
The Claude API call may have timed out.
```sql
UPDATE generation_jobs SET status = 'failed', error = 'Timeout' WHERE status = 'processing';
```

### "No project data available"
Ensure `fetch-projects` was called or use `copy-mapping` to copy from a previous session.

### CORS errors
Update `CORS_ORIGINS` in `.env` to include your frontend URL.

### Claude PPTX Skill not generating file
Check that `anthropic>=0.43.0` is installed and the API key has access to the PPTX skill beta.
