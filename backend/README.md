# Flash Reports - Python Backend

FastAPI backend for HTML/PDF/PPTX report generation using Claude Vision.

## Pipeline

```
PPTX Template → PDF → PNG slides → Claude Vision → HTML Template → Data Population → HTML/PDF/PPTX
```

## Key Features

- **Background Template Preparation**: PPTX → HTML conversion runs async after upload
- **Exact HTML Replica**: Claude Vision generates pixel-perfect HTML (no placeholders)
- **Multi-Project Reports**: Generates Portfolio Overview + Per-Project slides + Data Notes
- **Multiple Output Formats**: HTML, PDF (WeasyPrint), PPTX

## Requirements

### System Dependencies

**macOS**:
```bash
brew install poppler glib pango cairo
```

**Ubuntu/Debian**:
```bash
apt-get install poppler-utils libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0
```

### Python Dependencies

- Python 3.8+
- FastAPI
- Anthropic SDK
- Supabase Python client
- pdf2image (PPTX → PNG)
- WeasyPrint (HTML → PDF, optional)
- python-pptx (HTML → PPTX)
- Pillow, BeautifulSoup4

## Installation

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt
```

## Configuration

Create `.env` file:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-xxx
```

## Running

### Development
```bash
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

### Production
```bash
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
```

## API Endpoints

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
| `/analyze-template` | POST | Analyze PPTX and generate HTML (legacy) |
| `/preview-template` | GET | Preview HTML template before population |
| `/generate-direct` | POST | Synchronous generation (testing only) |

### Headers

All endpoints (except `/` and `/health`) require:
- `x-session-id`: Session UUID from frontend

## Core Flows

### 1. Template Preparation (Background)

Triggered by frontend after template upload:

```
POST /prepare-template
  └─► Background task:
      1. Download PPTX from Supabase Storage
      2. Convert PPTX → PDF → PNG (pdf2image)
      3. Send PNGs to Claude Vision
      4. Generate exact HTML replica
      5. Upload HTML to Storage
      6. Update session.template_preparation_status → 'completed'
```

### 2. HTML Generation (Job-based)

```
POST /generate-html
  └─► Creates job in DB, returns jobId

Background task:
  [STEP 1/6] Load session data (template, mapping, projects)
  [STEP 2/6] Validate projects
  [STEP 3-5] Use cached HTML template (or convert PPTX if not cached)
  [STEP 6/6] Populate HTML with Claude:
             - SLIDE 1: Portfolio Overview (all projects table)
             - SLIDES 2-N: Template repeated for each project
             - LAST SLIDE: Data Notes with timestamp + missing fields

POST /job-status
  └─► Poll until status = 'completed' or 'failed'
```

## Multi-Project Report Structure

The generated report MUST follow this structure (enforced in prompts):

1. **First Slide - Portfolio Overview** (MANDATORY)
   - Table/grid showing ALL projects
   - Columns: Project Name, Status, Mood/Weather, Progress %

2. **Middle Slides - Per-Project** (MANDATORY)
   - Complete template set repeated for each project
   - Each project gets all slides defined in the template

3. **Last Slide - Data Notes** (MANDATORY)
   - Generation timestamp
   - List of missing/unavailable fields

## Services

| Service | Description |
|---------|-------------|
| `converter.py` | PPTX → PDF → PNG conversion |
| `claude_html.py` | Claude Vision HTML generation (exact replica) |
| `data_populator.py` | HTML population with project data |
| `pdf_generator.py` | HTML → PDF (WeasyPrint) |
| `supabase_client.py` | Database and Storage operations |

## Troubleshooting

### "Unable to get page count" (pdf2image)
```bash
brew install poppler  # macOS
```

### "PDF generation not available"
```bash
brew install glib pango cairo  # macOS
```

### "Session not found" / "No mapping found"
Ensure frontend has completed:
1. Session creation
2. Template upload
3. Field mapping
4. Project data fetch

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app + job processing
│   ├── config.py            # Environment configuration
│   └── services/
│       ├── converter.py     # PPTX → PNG
│       ├── claude_html.py   # Claude Vision HTML
│       ├── data_populator.py # Data population prompts
│       ├── pdf_generator.py # HTML → PDF
│       └── supabase_client.py # DB/Storage
├── requirements.txt
├── .env                     # Environment (not in git)
└── README.md
```
