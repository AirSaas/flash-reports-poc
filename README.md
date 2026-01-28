# Flash Reports - AirSaas

Automated report generator from AirSaas project portfolio data.

## Overview

Flash Reports generates professional reports from AirSaas project data using a conversational interface for field mapping and multiple generation engines.

## Features

- **Conversational Mapping**: Interactive chat with Claude to map template fields to AirSaas data
- **Multiple Generation Engines**:
  - **Claude PPTX**: PowerPoint generation via Claude's PPTX Skill (Supabase Edge Functions)
  - **Claude HTML**: HTML/PDF generation via Claude Vision (Python FastAPI backend)
- **Quality Evaluation**: Automatic evaluation with regeneration if needed
- **Session Persistence**: Resume work across browser sessions
- **PDF Export**: Server-side PDF generation with WeasyPrint (or browser print fallback)

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + html2pdf.js
- **Backend (Supabase)**: Edge Functions (Deno) for PPTX generation
- **Backend (Python)**: FastAPI for HTML/PDF generation
- **Database**: Supabase Postgres
- **Storage**: Supabase Storage
- **AI**: Anthropic Claude API (PPTX Skill + Vision)

## Setup

### Prerequisites

- Node.js 18+
- Python 3.8+ (for Claude HTML engine)
- Supabase account
- Anthropic API key
- AirSaas API key

### 1. Clone and Install Frontend

```bash
cd frontend
npm install
```

### 2. Setup Python Backend (for Claude HTML engine)

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # macOS/Linux

# Install Python dependencies
pip install -r requirements.txt

# Install system dependencies for PDF generation
# macOS:
brew install poppler glib pango cairo

# Ubuntu/Debian:
# apt-get install poppler-utils libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0
```

### 3. Configure Supabase

1. Create a new Supabase project at [supabase.com](https://supabase.com)

2. Run the database migration:
   - Go to SQL Editor in Supabase Dashboard
   - Copy contents of `supabase/migrations/001_initial.sql`
   - Execute the SQL

3. Create storage buckets:
   - Go to Storage in Supabase Dashboard
   - Create bucket `templates` (public)
   - Create bucket `outputs` (public)

4. Set up Edge Functions:
   ```bash
   # Install Supabase CLI
   npm install -g supabase

   # Login
   supabase login

   # Link to your project
   supabase link --project-ref YOUR_PROJECT_REF

   # Deploy functions
   supabase functions deploy chat
   supabase functions deploy upload-template
   supabase functions deploy get-session
   supabase functions deploy generate-claude-pptx
   supabase functions deploy fetch-projects
   supabase functions deploy evaluate
   ```

5. Set secrets:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
   supabase secrets set AIRSAAS_API_KEY=your-airsaas-key
   supabase secrets set AIRSAAS_BASE_URL=https://api.airsaas.io/v1
   ```

### 4. Configure Environment Variables

**Frontend** (`frontend/.env.local`):
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_PYTHON_BACKEND_URL=http://localhost:8000
```

**Python Backend** (`backend/.env`):
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-xxx
```

### 5. Run Development Servers

**Frontend**:
```bash
cd frontend
npm run dev
```

**Python Backend** (in another terminal):
```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

## Usage Flow

1. **Select Engine**: Choose between Claude PPTX or Claude HTML
2. **Configure Projects**: Select workspace and projects to include
3. **Upload Template**: Upload your reference .pptx template
4. **Field Mapping**: Chat with Claude to map template fields to AirSaas data
5. **Text Options**: Choose how to handle long text content
6. **Generate**: Create the report
7. **Download**: Get your PPTX or PDF report

## Project Structure

```
flash-reports/
├── frontend/           # React application
│   ├── src/
│   │   ├── components/ # Reusable UI components
│   │   ├── hooks/      # Custom React hooks
│   │   ├── services/   # API service functions
│   │   ├── lib/        # Utilities and helpers
│   │   └── types/      # TypeScript definitions
│   └── ...
├── backend/            # Python FastAPI backend
│   ├── app/
│   │   ├── main.py     # FastAPI application
│   │   └── services/   # Business logic
│   └── requirements.txt
└── supabase/
    ├── functions/      # Edge Functions
    │   ├── chat/       # Mapping conversation
    │   ├── generate-*/ # PPTX generation
    │   └── evaluate/   # Quality evaluation
    └── migrations/     # Database schema
```

## API Reference

### Supabase Edge Functions

| Endpoint | Description |
|----------|-------------|
| `/chat` | Conversational mapping with Claude |
| `/upload-template` | Register uploaded template |
| `/get-session` | Get/update session state |
| `/generate-claude-pptx` | Generate via Claude PPTX Skill |
| `/fetch-projects` | Fetch data from AirSaas API |
| `/evaluate` | Evaluate generated report quality |

### Python Backend Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/generate-html` | POST | Create HTML generation job |
| `/job-status` | POST | Check job status |
| `/analyze-template` | POST | Analyze PPTX template |
| `/health` | GET | Health check |

## Configuration

### Evaluation Settings

- **Threshold**: 65 points (regenerate if below)
- **Max Iterations**: 2 attempts before accepting

## Documentation

See [CLAUDE.md](./CLAUDE.md) for detailed technical documentation.

## License

MIT
