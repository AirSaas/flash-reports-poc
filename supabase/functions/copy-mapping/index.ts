import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

/**
 * Copies the mapping from a source mapping to the current session.
 * Also copies the fetched_projects_data from source session to current session.
 *
 * Data flow:
 * - mapping_json, template_path, long_text_strategy → copied to new mapping
 * - fetched_projects_data → copied from source session to current session
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
      .select('session_id, mapping_json, template_path, long_text_strategy')
      .eq('id', sourceMappingId)
      .single()

    if (sourceError || !sourceMapping) {
      throw new Error('Source mapping not found')
    }

    console.log(`Copying mapping from session ${sourceMapping.session_id} to ${sessionId}`)

    // Get fetched_projects_data from source session
    const { data: sourceSession, error: sessionError } = await supabase
      .from('sessions')
      .select('fetched_projects_data')
      .eq('id', sourceMapping.session_id)
      .single()

    if (sessionError) {
      console.error(`Error fetching source session: ${sessionError.message}`)
    }

    const hasFetchedData = !!sourceSession?.fetched_projects_data
    console.log(`Source session has fetched_projects_data: ${hasFetchedData}`)

    // Ensure current session exists and copy fetched_projects_data
    const sessionData: Record<string, unknown> = {
      id: sessionId,
      current_step: 'long_text_options',
      updated_at: new Date().toISOString(),
    }

    if (sourceSession?.fetched_projects_data) {
      sessionData.fetched_projects_data = sourceSession.fetched_projects_data
      console.log('Copying fetched_projects_data to target session')
    }

    await supabase
      .from('sessions')
      .upsert(sessionData, { onConflict: 'id' })

    // Verify current session has fetched_projects_data (either copied or pre-existing)
    const { data: currentSession } = await supabase
      .from('sessions')
      .select('fetched_projects_data')
      .eq('id', sessionId)
      .single()

    const currentHasFetchedData = !!currentSession?.fetched_projects_data
    console.log(`Current session has fetched_projects_data: ${currentHasFetchedData}`)

    // Check if current session already has a mapping
    const { data: existingMapping } = await supabase
      .from('mappings')
      .select('id')
      .eq('session_id', sessionId)
      .single()

    if (existingMapping) {
      // Update existing mapping
      const { error: updateError } = await supabase
        .from('mappings')
        .update({
          mapping_json: sourceMapping.mapping_json,
          template_path: sourceMapping.template_path,
          long_text_strategy: sourceMapping.long_text_strategy,
        })
        .eq('session_id', sessionId)

      if (updateError) {
        throw new Error(`Failed to update mapping: ${updateError.message}`)
      }
      console.log(`Updated existing mapping for session ${sessionId}`)
    } else {
      // Create new mapping
      const { error: insertError } = await supabase
        .from('mappings')
        .insert({
          session_id: sessionId,
          mapping_json: sourceMapping.mapping_json,
          template_path: sourceMapping.template_path,
          long_text_strategy: sourceMapping.long_text_strategy,
        })

      if (insertError) {
        throw new Error(`Failed to create mapping: ${insertError.message}`)
      }
      console.log(`Created new mapping for session ${sessionId}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Mapping copied successfully',
        hasFetchedData: currentHasFetchedData,
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
