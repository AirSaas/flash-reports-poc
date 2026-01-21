import Anthropic from "npm:@anthropic-ai/sdk"

export function getAnthropicClient(): Anthropic {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable')
  }
  return new Anthropic({ apiKey })
}

// Lista fija de proyectos del workspace aqme-corp-
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
}

// Datos de referencia que se cachean
let referenceDataCache: {
  moods: unknown[] | null
  statuses: unknown[] | null
  risks: unknown[] | null
  cachedAt: number | null
} = {
  moods: null,
  statuses: null,
  risks: null,
  cachedAt: null,
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos

// Rate limiting: 15 calls/sec, 500 calls/min
async function fetchWithRateLimit(
  url: string,
  headers: Record<string, string>,
  retries = 3
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(url, { headers })

    if (response.status === 429) {
      // Rate limited - esperar según Retry-After header
      const retryAfter = response.headers.get('Retry-After')
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * (attempt + 1)
      console.warn(`Rate limited, waiting ${waitMs}ms before retry...`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      continue
    }

    return response
  }

  throw new Error(`Failed after ${retries} retries due to rate limiting`)
}

// Fetch con paginación automática (page_size=20, seguir campo `next`)
async function fetchPaginated(
  baseUrl: string,
  headers: Record<string, string>
): Promise<unknown[]> {
  const allResults: unknown[] = []
  let url: string | null = baseUrl

  // Agregar page_size si no está presente
  if (!url.includes('page_size=')) {
    url += url.includes('?') ? '&page_size=20' : '?page_size=20'
  }

  while (url) {
    const response = await fetchWithRateLimit(url, headers)

    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status}`)
      break
    }

    const data = await response.json()
    allResults.push(...(data.results || []))
    url = data.next // Seguir el campo `next` para la siguiente página
  }

  return allResults
}

// Obtener datos de referencia (moods, statuses, risks)
async function fetchReferenceData(
  baseUrl: string,
  headers: Record<string, string>
): Promise<{
  moods: unknown[]
  statuses: unknown[]
  risks: unknown[]
}> {
  const now = Date.now()

  // Usar cache si está válido
  if (
    referenceDataCache.cachedAt &&
    now - referenceDataCache.cachedAt < CACHE_TTL_MS &&
    referenceDataCache.moods &&
    referenceDataCache.statuses &&
    referenceDataCache.risks
  ) {
    return {
      moods: referenceDataCache.moods,
      statuses: referenceDataCache.statuses,
      risks: referenceDataCache.risks,
    }
  }

  // Fetch en paralelo los datos de referencia
  const [moodsRes, statusesRes, risksRes] = await Promise.all([
    fetchWithRateLimit(`${baseUrl}/projects_moods/`, headers),
    fetchWithRateLimit(`${baseUrl}/projects_statuses/`, headers),
    fetchWithRateLimit(`${baseUrl}/projects_risks/`, headers),
  ])

  const moods = moodsRes.ok ? (await moodsRes.json()).results || [] : []
  const statuses = statusesRes.ok ? (await statusesRes.json()).results || [] : []
  const risks = risksRes.ok ? (await risksRes.json()).results || [] : []

  // Actualizar cache
  referenceDataCache = {
    moods,
    statuses,
    risks,
    cachedAt: now,
  }

  return { moods, statuses, risks }
}

export async function fetchAirSaasProjectData(projectId: string): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get('AIRSAAS_API_KEY')
  const baseUrl = Deno.env.get('AIRSAAS_BASE_URL') || 'https://api.airsaas.io/v1'

  if (!apiKey) {
    throw new Error('Missing AIRSAAS_API_KEY environment variable')
  }

  const headers = {
    'Authorization': `Api-Key ${apiKey}`,
    'Content-Type': 'application/json',
  }

  const results: Record<string, unknown> = {}

  // 1. Fetch datos de referencia (con cache)
  try {
    const refData = await fetchReferenceData(baseUrl, headers)
    results.reference_data = refData
  } catch (error) {
    console.error('Failed to fetch reference data:', error)
    results.reference_data = { moods: [], statuses: [], risks: [] }
  }

  // 2. Fetch datos del proyecto principal con expand correcto
  // GET /projects/{id}/?expand=owner,program,goals,teams,requesting_team
  try {
    const projectUrl = `${baseUrl}/projects/${projectId}/?expand=owner,program,goals,teams,requesting_team`
    const response = await fetchWithRateLimit(projectUrl, headers)
    if (response.ok) {
      results.project = await response.json()
    } else {
      console.error(`Failed to fetch project: ${response.status}`)
      results.project = null
    }
  } catch (error) {
    console.error('Failed to fetch project:', error)
    results.project = null
  }

  // 3. Fetch endpoints simples del proyecto (sin paginación)
  const simpleEndpoints = [
    { key: 'members', url: `${baseUrl}/projects/${projectId}/members/` },
    { key: 'efforts', url: `${baseUrl}/projects/${projectId}/efforts/` },
    { key: 'budget_lines', url: `${baseUrl}/projects/${projectId}/budget_lines/` },
    { key: 'budget_values', url: `${baseUrl}/projects/${projectId}/budget_values/` },
  ]

  for (const endpoint of simpleEndpoints) {
    try {
      const response = await fetchWithRateLimit(endpoint.url, headers)
      if (response.ok) {
        const data = await response.json()
        // Manejar tanto respuestas paginadas como arrays directos
        results[endpoint.key] = data.results || data
      } else {
        results[endpoint.key] = null
      }
    } catch (error) {
      console.error(`Failed to fetch ${endpoint.key}:`, error)
      results[endpoint.key] = null
    }
  }

  // 4. Fetch milestones con expand correcto
  // GET /milestones/?project={id}&expand=owner,team,project
  try {
    const milestonesUrl = `${baseUrl}/milestones/?project=${projectId}&expand=owner,team,project`
    results.milestones = await fetchPaginated(milestonesUrl, headers)
  } catch (error) {
    console.error('Failed to fetch milestones:', error)
    results.milestones = []
  }

  // 5. Fetch decisions con expand correcto (paginado)
  // GET /decisions/?project={id}&expand=owner,decision_maker,project
  try {
    const decisionsUrl = `${baseUrl}/decisions/?project=${projectId}&expand=owner,decision_maker,project`
    results.decisions = await fetchPaginated(decisionsUrl, headers)
  } catch (error) {
    console.error('Failed to fetch decisions:', error)
    results.decisions = []
  }

  // 6. Fetch attention points con expand correcto (paginado)
  // GET /attention_points/?project={id}&expand=owner,project
  try {
    const attentionPointsUrl = `${baseUrl}/attention_points/?project=${projectId}&expand=owner,project`
    results.attention_points = await fetchPaginated(attentionPointsUrl, headers)
  } catch (error) {
    console.error('Failed to fetch attention_points:', error)
    results.attention_points = []
  }

  return results
}

export async function fetchAllProjectsData(): Promise<Record<string, unknown>[]> {
  const apiKey = Deno.env.get('AIRSAAS_API_KEY')
  if (!apiKey) {
    throw new Error('Missing AIRSAAS_API_KEY - cannot fetch project data')
  }

  const allData: Record<string, unknown>[] = []

  for (const project of AIRSAAS_PROJECTS.projects) {
    try {
      const projectData = await fetchAirSaasProjectData(project.id)
      allData.push({
        ...projectData,
        _metadata: {
          id: project.id,
          short_id: (project as { short_id?: string }).short_id,
          name: project.name,
        },
      })
    } catch (error) {
      console.error(`Failed to fetch project ${project.id}:`, error)
      allData.push({
        _metadata: {
          id: project.id,
          short_id: (project as { short_id?: string }).short_id,
          name: project.name,
          error: String(error),
        },
      })
    }
  }

  return allData
}

/**
 * Comprime los datos del proyecto para reducir tokens
 * Elimina campos innecesarios, trunca textos largos, y simplifica estructuras
 */
export function compressProjectData(
  data: Record<string, unknown>[],
  maxTextLength = 200
): Record<string, unknown>[] {
  // Campos a eliminar completamente (metadata innecesaria)
  const fieldsToRemove = [
    'created_at', 'updated_at', 'created_by', 'modified_at', 'modified_by',
    'uuid', 'workspace', 'workspace_id', 'organization', 'organization_id',
    'avatar', 'avatar_url', 'picture', 'picture_url', 'image', 'image_url',
    'slug', 'url', 'external_id', 'external_url', 'api_url',
    'permissions', 'can_edit', 'can_delete', 'can_view',
    'is_active', 'is_archived', 'is_deleted', 'is_template',
    'sort_order', 'position', 'order', 'rank',
  ]

  // Campos de texto largo a truncar
  const longTextFields = ['description', 'content', 'body', 'notes', 'comment', 'summary', 'details']

  function truncateText(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.substring(0, maxLen) + '...'
  }

  function simplifyObject(obj: unknown, depth = 0): unknown {
    if (depth > 5) return '[nested]' // Evitar recursión profunda

    if (obj === null || obj === undefined) return null

    if (Array.isArray(obj)) {
      // Limitar arrays largos
      const maxItems = depth === 0 ? 50 : 10
      const limited = obj.slice(0, maxItems)
      const simplified = limited.map(item => simplifyObject(item, depth + 1))
      if (obj.length > maxItems) {
        return [...simplified, `[+${obj.length - maxItems} more items]`]
      }
      return simplified
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        // Saltar campos innecesarios
        if (fieldsToRemove.includes(key)) continue

        // Saltar campos que empiezan con underscore (excepto _metadata)
        if (key.startsWith('_') && key !== '_metadata') continue

        // Truncar textos largos
        if (typeof value === 'string' && longTextFields.includes(key)) {
          result[key] = truncateText(value, maxTextLength)
        } else if (typeof value === 'string' && value.length > 500) {
          // Truncar cualquier string muy largo
          result[key] = truncateText(value, 500)
        } else {
          result[key] = simplifyObject(value, depth + 1)
        }
      }

      return result
    }

    return obj
  }

  // También eliminamos reference_data duplicado entre proyectos
  const seenReferenceData = new Set<string>()

  return data.map((project, index) => {
    const simplified = simplifyObject(project) as Record<string, unknown>

    // Solo incluir reference_data en el primer proyecto
    if (index > 0 && simplified.reference_data) {
      const refKey = JSON.stringify(simplified.reference_data)
      if (seenReferenceData.has(refKey)) {
        delete simplified.reference_data
      } else {
        seenReferenceData.add(refKey)
      }
    } else if (simplified.reference_data) {
      seenReferenceData.add(JSON.stringify(simplified.reference_data))
    }

    return simplified
  })
}

/**
 * Estima el número de tokens en un string JSON
 * Aproximación: ~4 caracteres por token
 */
export function estimateTokens(data: unknown): number {
  const jsonStr = JSON.stringify(data)
  return Math.ceil(jsonStr.length / 4)
}
