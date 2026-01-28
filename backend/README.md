# Flash Reports - Python Backend

FastAPI backend for HTML/PDF report generation using Claude Vision.

## Overview

This backend handles the `claude-html` engine, which converts PPTX templates to HTML using Claude Vision, then populates them with project data.

### Pipeline

```
PPTX Template → PDF → PNG slides → Claude Vision → HTML Template → Data Population → HTML/PDF
```

## Requirements

### System Dependencies

**macOS**:
```bash
# Required for PPTX to PNG conversion
brew install poppler

# Required for PDF generation (optional)
brew install glib pango cairo
```

**Ubuntu/Debian**:
```bash
# Required for PPTX to PNG conversion
apt-get install poppler-utils

# Required for PDF generation (optional)
apt-get install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0
```

### Python Dependencies

- Python 3.8+
- FastAPI
- Anthropic SDK
- Supabase Python client
- pdf2image (PPTX → PNG)
- WeasyPrint (HTML → PDF, optional)
- Pillow (image processing)

## Installation

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # macOS/Linux
# .venv\Scripts\activate   # Windows

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
| `/generate-html` | POST | Create HTML generation job (async) |
| `/job-status` | POST | Check job status |
| `/analyze-template` | POST | Analyze PPTX and generate HTML template |
| `/generate-direct` | POST | Synchronous generation (testing only) |

### Headers

All endpoints (except `/` and `/health`) require:
- `x-session-id`: Session UUID from frontend

### Generate HTML Job

**Request**:
```bash
curl -X POST http://localhost:8000/generate-html \
  -H "Content-Type: application/json" \
  -H "x-session-id: <SESSION_ID>" \
  -d '{"use_claude_population": true}'
```

**Response**:
```json
{
  "success": true,
  "jobId": "uuid"
}
```

### Check Job Status

**Request**:
```bash
curl -X POST http://localhost:8000/job-status \
  -H "Content-Type: application/json" \
  -H "x-session-id: <SESSION_ID>" \
  -d '{"job_id": "<JOB_ID>"}'
```

**Response**:
```json
{
  "success": true,
  "job": {
    "id": "uuid",
    "status": "completed",
    "result": {
      "reportId": "uuid",
      "htmlUrl": "https://storage.../report.html",
      "pdfUrl": "https://storage.../report.pdf",
      "templateHtmlUrl": "https://storage.../template.html",
      "templatePdfUrl": "https://storage.../template.pdf",
      "projectCount": 5,
      "slideCount": 10
    }
  }
}
```

## Architecture

### Services

- **converter.py**: PPTX → PDF → PNG conversion using pdf2image
- **claude_html.py**: HTML template generation using Claude Vision
- **data_populator.py**: HTML population with project data
- **pdf_generator.py**: HTML → PDF conversion using WeasyPrint
- **supabase_client.py**: Database and storage operations

### Job Processing

1. Frontend calls `/generate-html` → returns jobId immediately
2. Background task processes generation:
   - Load session data (template, mapping, projects)
   - Download PPTX from Supabase Storage
   - Convert PPTX → PDF → PNG slides
   - Send PNGs to Claude Vision → HTML template
   - Populate HTML with project data
   - Generate PDF (if WeasyPrint available)
   - Upload results to Supabase Storage
   - Update job status in database
3. Frontend polls `/job-status` until completed

### PDF Generation

PDF generation is optional and requires WeasyPrint with system libraries.

If unavailable, the backend:
- Returns `pdfUrl: null` in job result
- Frontend opens HTML in new tab for browser print-to-PDF

## Troubleshooting

### "PDF generation not available"

Install system dependencies:
```bash
# macOS
brew install glib pango cairo

# Ubuntu
apt-get install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0
```

### "Unable to get page count" (pdf2image)

Install Poppler:
```bash
# macOS
brew install poppler

# Ubuntu
apt-get install poppler-utils
```

### "Session not found" / "No mapping found"

Ensure the frontend has:
1. Created a session
2. Uploaded a template
3. Completed field mapping
4. Fetched project data

## Development

### Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI application
│   ├── config.py            # Environment configuration
│   └── services/
│       ├── converter.py     # PPTX → PNG conversion
│       ├── claude_html.py   # Claude Vision HTML generation
│       ├── data_populator.py # HTML data population
│       ├── pdf_generator.py # HTML → PDF conversion
│       └── supabase_client.py # Supabase operations
├── requirements.txt
├── .env                     # Environment variables (not in git)
└── README.md
```

### Adding New Features

1. Add service in `app/services/`
2. Import and use in `app/main.py`
3. Update requirements.txt if needed
4. Document in this README
