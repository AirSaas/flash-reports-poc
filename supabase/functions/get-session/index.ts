import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const supabase = getSupabaseClient()

    // Check for action in body (for updating strategy)
    let body: { action?: string; long_text_strategy?: string } = {}
    try {
      body = await req.json()
    } catch {
      // No body, that's fine for GET
    }

    // Handle update_strategy action
    if (body.action === 'update_strategy' && body.long_text_strategy) {
      const { error: updateError } = await supabase
        .from('mappings')
        .update({ long_text_strategy: body.long_text_strategy })
        .eq('session_id', sessionId)

      if (updateError) {
        throw new Error(`Failed to update strategy: ${updateError.message}`)
      }

      // Also update session step
      await supabase
        .from('sessions')
        .update({ current_step: 'generating' })
        .eq('id', sessionId)

      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Handle get_fetched_data_info action
    if (body.action === 'get_fetched_data_info') {
      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('fetched_projects_data')
        .eq('id', sessionId)
        .single()

      if (sessionError || !session) {
        return new Response(
          JSON.stringify({ projectCount: 0, fetchedAt: null }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }

      const fetchedData = session.fetched_projects_data as {
        fetched_at?: string
        project_count?: number
        successful_count?: number
      } | null

      return new Response(
        JSON.stringify({
          projectCount: fetchedData?.successful_count || fetchedData?.project_count || 0,
          fetchedAt: fetchedData?.fetched_at || null,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Get session data
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError && sessionError.code !== 'PGRST116') {
      throw sessionError
    }

    // Get mapping data
    const { data: mapping, error: mappingError } = await supabase
      .from('mappings')
      .select('*')
      .eq('session_id', sessionId)
      .single()

    if (mappingError && mappingError.code !== 'PGRST116') {
      throw mappingError
    }

    return new Response(
      JSON.stringify({
        session: session || null,
        mapping: mapping
          ? {
              template_path: mapping.template_path,
              mapping_json: mapping.mapping_json,
              long_text_strategy: mapping.long_text_strategy,
            }
          : null,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Get session error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
