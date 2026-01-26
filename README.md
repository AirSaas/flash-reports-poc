# Flash Reports - AirSaas Portfolio Generator

Automated PowerPoint portfolio report generator from AirSaas project data using Claude's PPTX Skill.

## Overview

Flash Reports automates the generation of PowerPoint presentations from AirSaas project data. Users can upload a template, configure field mappings with AI assistance, and generate professional reports that maintain the template's design.

## Features

- **Template-Based Generation**: Upload your PPTX template and generate reports using it as the base
- **Batch Field Mapping**: AI-suggested mappings for all template fields at once
- **Multiple Projects**: Fetch and include multiple projects from AirSaas
- **Long Text Handling**: Choose how to handle long texts (summarize, truncate, or omit)
- **Session Persistence**: Resume work across browser sessions
- **Quality Evaluation**: Automatic evaluation with regeneration option

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Python + FastAPI (local development)
- **Database**: Supabase PostgreSQL
- **Storage**: Supabase Storage (templates & outputs)
- **AI**: Anthropic Claude API with PPTX Skill

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- Supabase account
- Anthropic API key
- AirSaas API key

### 1. Clone the Repository

```bash
git clone <repository-url>
cd flash-reports
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
```

Edit `backend/.env`:
```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx

# AirSaas
AIRSAAS_API_KEY=your-airsaas-key
AIRSAAS_BASE_URL=https://app.airsaas.io/api/v1

# Optional
MAX_FETCH_PAGES=5
DEBUG=true
```

Start the backend:
```bash
python main.py
```

The API will be available at `http://localhost:8000`

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

Edit `frontend/.env`:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:8000
```

Start the frontend:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### 4. Supabase Setup

1. Create a Supabase project at [supabase.com](https://supabase.com)

2. Run migrations in SQL Editor:
   - Execute files from `supabase/migrations/` in order

3. Create storage buckets:
   - `templates` (public) - for uploaded templates
   - `outputs` (public) - for generated reports

## Usage Flow

1. **Select Engine**: Choose Claude PPTX
2. **Configure Projects**: Select workspace and projects from AirSaas
3. **Upload Template**: Upload your reference .pptx template
4. **Field Mapping**: Review and adjust AI-suggested field mappings
5. **Text Options**: Choose how to handle long text content
6. **Generate**: Create the PowerPoint presentation (~15-20 min)
7. **Download**: Get your generated report

## Project Structure

```
flash-reports/
├── backend/                # Python FastAPI backend
│   ├── main.py            # API routes
│   ├── config.py          # Settings and configuration
│   ├── database.py        # Supabase client & DB operations
│   ├── airsaas.py         # AirSaas API integration
│   ├── template_analyzer.py # Template analysis with Claude
│   ├── mapping_engine.py  # Field mapping logic
│   ├── pptx_generator.py  # PPTX generation with Claude
│   └── requirements.txt   # Python dependencies
│
├── frontend/              # React application
│   ├── src/
│   │   ├── components/   # UI components by feature
│   │   ├── hooks/        # Custom React hooks
│   │   ├── services/     # API service functions
│   │   ├── lib/          # Utilities
│   │   └── types/        # TypeScript definitions
│   └── package.json
│
├── supabase/
│   ├── functions/        # Edge Functions (production)
│   └── migrations/       # Database schema
│
└── templates/            # Template storage (gitignored)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/functions/v1/get-session` | GET | Get session state |
| `/functions/v1/upload-template` | POST | Register uploaded template |
| `/functions/v1/analyze-template` | POST | Analyze template with Claude |
| `/functions/v1/fetch-projects` | POST | Fetch projects from AirSaas |
| `/functions/v1/mapping-batch` | POST | Get all field mappings with AI suggestions |
| `/functions/v1/mapping-batch-submit` | POST | Save all field mappings |
| `/functions/v1/generate-claude-pptx` | POST | Create generation job |
| `/functions/v1/process-pptx-job` | POST | Process PPTX generation |
| `/functions/v1/check-job-status` | POST | Poll job status |

## Environment Variables

### Backend

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `AIRSAAS_API_KEY` | AirSaas API key |
| `AIRSAAS_BASE_URL` | AirSaas API base URL |
| `MAX_FETCH_PAGES` | Max pages to fetch from AirSaas (default: 5) |

### Frontend

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `VITE_API_URL` | Backend API URL |

## Notes

- PPTX generation takes ~15-20 minutes due to Claude's code execution
- Template files are uploaded to Anthropic Files API during generation and cleaned up after
- Maximum ~3-4 projects per generation due to token limits

## License

MIT
