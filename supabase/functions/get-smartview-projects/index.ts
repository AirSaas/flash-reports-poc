import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"

/**
 * Gets the list of projects inside a smartview.
 * 1. Fetches item_ids from the smartview
 * 2. For each project ID, fetches basic project info (name)
 * 3. Returns list of { id, name, short_id } for preview in the UI
 */

interface SmartviewItemsResponse {
  count: number
  type: string
  item_ids: string[]
}

interface Project {
  id: string
  name: string
  short_id?: string
}

interface ProjectApiResponse {
  id: string
  name: string
  short_id?: string
  [key: string]: unknown
}

// Rate limiting helper
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  retries = 3
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(url, { headers })

    if (response.status === 429) {
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

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const body = await req.json()
    const { smartviewId } = body

    if (!smartviewId) {
      throw new Error('smartviewId is required')
    }

    const apiKey = Deno.env.get('AIRSAAS_API_KEY')
    const baseUrl = Deno.env.get('AIRSAAS_BASE_URL') || 'https://api.airsaas.io/v1'

    if (!apiKey) {
      throw new Error('Missing AIRSAAS_API_KEY environment variable')
    }

    const headers = {
      'Authorization': `Api-Key ${apiKey}`,
      'Content-Type': 'application/json',
    }

    // Step 1: Get item_ids from smartview
    console.log(`Fetching item_ids for smartview: ${smartviewId}`)
    const itemsResponse = await fetchWithRetry(
      `${baseUrl}/smartviews/${smartviewId}/item_ids/`,
      headers
    )

    if (!itemsResponse.ok) {
      const errorText = await itemsResponse.text()
      console.error(`Failed to fetch smartview items: ${itemsResponse.status} - ${errorText}`)
      throw new Error(`Failed to fetch smartview items: ${itemsResponse.status}`)
    }

    const itemsData: SmartviewItemsResponse = await itemsResponse.json()

    if (itemsData.type !== 'project') {
      throw new Error(`Smartview is not of type 'project', got: ${itemsData.type}`)
    }

    console.log(`Found ${itemsData.count} projects in smartview`)

    // Step 2: Fetch basic info for each project
    // We only need id, name, and short_id for the preview
    const projects: Project[] = []
    const errors: string[] = []

    // Fetch projects in parallel batches to be faster but respect rate limits
    const BATCH_SIZE = 10
    const projectIds = itemsData.item_ids

    for (let i = 0; i < projectIds.length; i += BATCH_SIZE) {
      const batch = projectIds.slice(i, i + BATCH_SIZE)

      const batchPromises = batch.map(async (projectId) => {
        try {
          const response = await fetchWithRetry(
            `${baseUrl}/projects/${projectId}/`,
            headers
          )

          if (!response.ok) {
            console.warn(`Failed to fetch project ${projectId}: ${response.status}`)
            errors.push(projectId)
            return null
          }

          const projectData: ProjectApiResponse = await response.json()
          return {
            id: projectData.id,
            name: projectData.name,
            short_id: projectData.short_id,
          }
        } catch (e) {
          console.error(`Error fetching project ${projectId}:`, e)
          errors.push(projectId)
          return null
        }
      })

      const batchResults = await Promise.all(batchPromises)
      projects.push(...batchResults.filter((p): p is Project => p !== null))

      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < projectIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    console.log(`Successfully fetched ${projects.length}/${projectIds.length} projects`)

    return new Response(
      JSON.stringify({
        success: true,
        smartviewId,
        projects,
        total: itemsData.count,
        fetched: projects.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Get smartview projects error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
