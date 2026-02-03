# Flash Reports

Automated portfolio report generator from AirSaas project data.

## Features

- **Smartview Integration**: Select projects from AirSaas smartviews
- **AI-Powered Mapping**: Claude analyzes templates and suggests field mappings
- **Multiple Output Formats**: HTML, PDF, and PPTX
- **Background Processing**: Template conversion runs in background for better UX
- **Session Reuse**: Reuse templates, mappings, and data from previous sessions

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.8+
- Supabase account
- Anthropic API key
- AirSaas API key

### 1. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # Configure environment
npm run dev
```

### 2. Python Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# System dependencies (macOS)
brew install poppler glib pango cairo

# Configure environment
cp .env.example .env

# Run server
uvicorn app.main:app --reload --port 8000
```

### 3. Configure Supabase

1. Create project at [supabase.com](https://supabase.com)
2. Run migrations from `supabase/migrations/`
3. Create storage buckets: `templates` (public), `outputs` (public)
4. Set secrets: `ANTHROPIC_API_KEY`, `AIRSAAS_API_KEY`
5. Deploy edge functions

## Usage Flow

1. **Select Engine** - Choose Claude HTML (recommended) or Claude PPTX
2. **Select Smartview** - Pick a smartview from AirSaas
3. **Upload Template** - Upload PPTX or reuse last template
4. **Map Fields** - Review AI-suggested mappings
5. **Generate** - Create your report
6. **Download** - Get HTML, PDF, or PPTX

## Architecture

```
┌─────────────┐    ┌─────────────────┐    ┌─────────────┐
│   Frontend  │───►│  Python Backend │───►│   Claude    │
│   (React)   │    │    (FastAPI)    │    │   Vision    │
└─────────────┘    └─────────────────┘    └─────────────┘
       │                   │
       │                   ▼
       │           ┌─────────────┐
       └──────────►│  Supabase   │
                   │  (DB/Edge)  │
                   └─────────────┘
```

## Documentation

See [CLAUDE.md](./CLAUDE.md) for detailed technical documentation.

## Project Structure

```
flash-reports/
├── frontend/           # React + TypeScript + Vite
├── backend/            # Python FastAPI
├── supabase/
│   ├── functions/      # Edge Functions
│   └── migrations/     # Database schema
├── CLAUDE.md           # Technical documentation
├── README.md           # This file
└── SPEC.md             # Original specification
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Python, FastAPI, Claude Vision |
| Database | Supabase PostgreSQL |
| Storage | Supabase Storage |
| Edge Functions | Deno (Supabase Edge Functions) |
| AI | Anthropic Claude (Vision + PPTX Skill) |

## Environment Variables

### Frontend (`.env.local`)
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_PYTHON_BACKEND_URL=http://localhost:8000
```

### Backend (`.env`)
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-xxx
```

## License

MIT
