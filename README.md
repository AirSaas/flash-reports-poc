# Flash Report POC - AirSaas

Automated PowerPoint portfolio report generator from AirSaas project data.

## Overview

This POC automates the generation of PowerPoint presentations from AirSaas project data using a conversational interface for field mapping and two different generation engines.

## Features

- **Conversational Mapping**: Interactive chat with Claude to map template fields to AirSaas data
- **Dual Generation Engines**:
  - Claude PPTX Skill for programmatic control
  - Gamma API for AI-powered design
- **Quality Evaluation**: Automatic evaluation with regeneration if needed
- **Session Persistence**: Resume work across browser sessions

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Supabase Edge Functions (Deno)
- **Database**: Supabase Postgres
- **Storage**: Supabase Storage
- **AI**: Anthropic Claude API

## Setup

### Prerequisites

- Node.js 18+
- Supabase account
- Anthropic API key
- Gamma API key (optional)
- AirSaas API key

### 1. Clone and Install

```bash
cd frontend
npm install
```

### 2. Configure Supabase

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
   supabase functions deploy generate-gamma
   supabase functions deploy evaluate
   ```

5. Set secrets:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
   supabase secrets set GAMMA_API_KEY=sk-gamma-xxx
   supabase secrets set AIRSAAS_API_KEY=your-airsaas-key
   supabase secrets set AIRSAAS_BASE_URL=https://api.airsaas.io/v1
   ```

### 3. Configure Frontend

```bash
cd frontend
cp .env.example .env.local
```

Edit `.env.local`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run Development Server

```bash
cd frontend
npm run dev
```

## Usage Flow

1. **Select Engine**: Choose between Claude PPTX or Gamma
2. **Upload Template**: Upload your reference .pptx template
3. **Field Mapping**: Chat with Claude to map template fields to AirSaas data
4. **Text Options**: Choose how to handle long text content
5. **Generate**: Create the PowerPoint presentation
6. **Download**: Get your generated report

## Project Structure

```
flash-report-poc/
├── frontend/           # React application
│   ├── src/
│   │   ├── components/ # Reusable UI components
│   │   ├── hooks/      # Custom React hooks
│   │   ├── services/   # API service functions
│   │   ├── lib/        # Utilities and helpers
│   │   └── types/      # TypeScript definitions
│   └── ...
└── supabase/
    ├── functions/      # Edge Functions
    │   ├── chat/       # Mapping conversation
    │   ├── generate-*/ # PPTX generation
    │   └── evaluate/   # Quality evaluation
    └── migrations/     # Database schema
```

## API Reference

### Edge Functions

| Endpoint | Description |
|----------|-------------|
| `/chat` | Conversational mapping with Claude |
| `/upload-template` | Register uploaded template |
| `/get-session` | Get/update session state |
| `/generate-claude-pptx` | Generate via Claude PPTX Skill |
| `/generate-gamma` | Generate via Gamma API |
| `/evaluate` | Evaluate generated report quality |

## Configuration

### AirSaas Projects

Projects are hardcoded in `supabase/functions/_shared/anthropic.ts`. Update the `AIRSAAS_PROJECTS` constant to change the project list.

### Evaluation Settings

- **Threshold**: 65 points (regenerate if below)
- **Max Iterations**: 2 attempts before accepting

## License

MIT
