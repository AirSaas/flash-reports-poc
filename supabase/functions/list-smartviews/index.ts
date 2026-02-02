import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"

/**
 * Lists all smartviews of type 'project' from AirSaas API.
 * Used by the frontend to let users select which smartview to export.
 */

interface Smartview {
  id: string
  name: string
  type: string
  display: string
  group_by: string
  group_by_level_2: string | null
  description: string | null
  private: boolean
  view_category: string
  created_at: string
  updated_at: string
}

interface AirSaasResponse {
  count: number
  next: string | null
  previous: string | null
  results: Smartview[]
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const apiKey = Deno.env.get('AIRSAAS_API_KEY')
    const baseUrl = Deno.env.get('AIRSAAS_BASE_URL') || 'https://api.airsaas.io/v1'

    if (!apiKey) {
      throw new Error('Missing AIRSAAS_API_KEY environment variable')
    }

    const headers = {
      'Authorization': `Api-Key ${apiKey}`,
      'Content-Type': 'application/json',
    }

    // Fetch all project smartviews (with pagination)
    const allSmartviews: Smartview[] = []
    let url: string | null = `${baseUrl}/smartviews/?type=project&page_size=50`

    while (url) {
      const response = await fetch(url, { headers })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`AirSaas API error: ${response.status} - ${errorText}`)
        throw new Error(`Failed to fetch smartviews: ${response.status}`)
      }

      const data: AirSaasResponse = await response.json()
      allSmartviews.push(...data.results)

      // Follow pagination
      url = data.next
    }

    console.log(`Fetched ${allSmartviews.length} project smartviews`)

    // Sort by name for better UX
    allSmartviews.sort((a, b) => a.name.localeCompare(b.name))

    return new Response(
      JSON.stringify({
        success: true,
        smartviews: allSmartviews.map(sv => ({
          id: sv.id,
          name: sv.name,
          description: sv.description,
          display: sv.display,
          view_category: sv.view_category,
          private: sv.private,
          updated_at: sv.updated_at,
        })),
        total: allSmartviews.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('List smartviews error:', error)
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
