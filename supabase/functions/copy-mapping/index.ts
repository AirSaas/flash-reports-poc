import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

/**
 * Copies the mapping from a source session to the current session
 * This allows reusing previous field mappings and fetched data
 */
serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const supabase = getSupabaseClient()

    const body = await req.json()
    const { sourceMappingId } = body

    if (!sourceMappingId) {
      throw new Error('sourceMappingId is required')
    }

    // Get the source mapping
    const { data: sourceMapping, error: sourceError } = await supabase
      .from('mappings')
      .select('*')
      .eq('id', sourceMappingId)
      .single()

    if (sourceError || !sourceMapping) {
      throw new Error('Source mapping not found')
    }

    // Check if current session already has a mapping
    const { data: existingMapping } = await supabase
      .from('mappings')
      .select('id')
      .eq('session_id', sessionId)
      .single()

    if (existingMapping) {
      // Update existing mapping with source data
      const { error: updateError } = await supabase
        .from('mappings')
        .update({
          mapping_json: sourceMapping.mapping_json,
          fetched_data: sourceMapping.fetched_data,
          template_path: sourceMapping.template_path,
          long_text_strategy: sourceMapping.long_text_strategy,
        })
        .eq('session_id', sessionId)

      if (updateError) {
        throw new Error(`Failed to update mapping: ${updateError.message}`)
      }
    } else {
      // Create new mapping for current session
      const { error: insertError } = await supabase
        .from('mappings')
        .insert({
          session_id: sessionId,
          mapping_json: sourceMapping.mapping_json,
          fetched_data: sourceMapping.fetched_data,
          template_path: sourceMapping.template_path,
          long_text_strategy: sourceMapping.long_text_strategy,
        })

      if (insertError) {
        throw new Error(`Failed to create mapping: ${insertError.message}`)
      }
    }

    // Update session step
    await supabase
      .from('sessions')
      .update({ current_step: 'long_text_options' })
      .eq('id', sessionId)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Mapping copied successfully',
        hasFetchedData: !!sourceMapping.fetched_data && sourceMapping.fetched_data.length > 0,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Copy mapping error:', error)
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
