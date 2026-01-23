import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

/**
 * Copies the fetched_projects_data from a source session to the current session.
 * This is the single source of truth for project data.
 */
serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const supabase = getSupabaseClient()

    const body = await req.json()
    const { sourceSessionId } = body

    if (!sourceSessionId) {
      throw new Error('sourceSessionId is required')
    }

    // Get the source session's fetched data
    const { data: sourceSession, error: sourceError } = await supabase
      .from('sessions')
      .select('fetched_projects_data')
      .eq('id', sourceSessionId)
      .single()

    if (sourceError || !sourceSession) {
      throw new Error('Source session not found')
    }

    if (!sourceSession.fetched_projects_data) {
      throw new Error('Source session has no fetched data')
    }

    console.log(`Copying fetched_projects_data from session ${sourceSessionId} to ${sessionId}`)

    // Ensure current session exists
    await supabase
      .from('sessions')
      .upsert({
        id: sessionId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    // Copy the fetched data to the current session
    const { error: updateError } = await supabase
      .from('sessions')
      .update({
        fetched_projects_data: sourceSession.fetched_projects_data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)

    if (updateError) {
      throw new Error(`Failed to copy fetched data: ${updateError.message}`)
    }

    const fetchedData = sourceSession.fetched_projects_data as {
      fetched_at?: string
      project_count?: number
      successful_count?: number
    }

    console.log(`Successfully copied fetched_projects_data to session ${sessionId}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Fetched data copied successfully',
        projectCount: fetchedData.successful_count || fetchedData.project_count || 0,
        fetchedAt: fetchedData.fetched_at,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Copy fetched data error:', error)
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
