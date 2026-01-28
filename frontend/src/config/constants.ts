export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Python backend URL
export const PYTHON_BACKEND_URL = import.meta.env.VITE_PYTHON_BACKEND_URL as string || 'http://localhost:8000'

export const STORAGE_KEYS = {
  SESSION: 'flash-report-session',
} as const

export const STEP_ORDER = [
  'select_engine',
  'configure_projects',
  'upload_template',
  'check_fetched_data',
  'check_mapping',
  'mapping',
  'long_text_options',
  'generating',
  'evaluating',
  'done',
] as const

export const ENGINE_OPTIONS = {
  gamma: {
    id: 'gamma',
    name: 'Gamma API',
    description: 'AI-powered design with automatic styling',
  },
  'claude-pptx': {
    id: 'claude-pptx',
    name: 'Claude PPTX',
    description: 'Programmatic control with exact template matching',
  },
  'claude-html': {
    id: 'claude-html',
    name: 'Claude HTML',
    description: 'PPTX → HTML conversion with Claude Vision (new)',
  },
} as const

export const LONG_TEXT_STRATEGIES = {
  summarize: {
    id: 'summarize',
    name: 'Summarize',
    description: 'Condense long texts to maximum 2 sentences',
  },
  ellipsis: {
    id: 'ellipsis',
    name: 'Truncate',
    description: 'Cut text after 100 characters with "..."',
  },
  omit: {
    id: 'omit',
    name: 'Omit',
    description: 'Skip fields with very long texts',
  },
} as const

export const AIRSAAS_PROJECTS = {
  workspace: 'aqme-corp-',
  projects: [
    {
      id: '7325bcd3-3998-442b-909e-e5bf6896a5d8',
      name: "Mise en place d'un outil de com' inApp vers nos utilisateurs",
    },
    {
      id: 'e15a49fb-2255-41d5-a7d3-45f1f6ac182e',
      name: 'Remplacement du système de paiement',
    },
    {
      id: '387cb18b-93ec-4bf5-8935-0bba96abdb5b',
      short_id: 'AQM-P13',
      name: 'Lancement du marché Espagnol',
    },
    {
      id: 'eb70f870-7097-4dfa-bcb0-dc9b34a7cf4f',
      short_id: 'AQM-P8',
      name: 'Management de la gestion des stocks',
    },
    {
      id: '73f7942e-c072-4437-8f01-9610bc3fa56f',
      name: 'Ticket restau dématérialisés',
    },
    {
      id: '013f9d4a-857c-427b-9c90-1b70e667b54c',
      name: 'Industrialisation de nos KPI métier',
    },
    {
      id: '5829eb21-8b7d-4627-ab86-7309ea0ca901',
      name: 'Nouveau plan de compétence',
    },
  ],
} as const

export const EVALUATION_THRESHOLD = 65
export const MAX_ITERATIONS = 2
