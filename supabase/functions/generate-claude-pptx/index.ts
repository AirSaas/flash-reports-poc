import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

/**
 * Creates a generation job and triggers processing.
 * Returns immediately with a jobId that can be polled for status.
 *
 * Flow:
 * 1. Frontend calls generate-claude-pptx → gets jobId immediately
 * 2. This function triggers process-pptx-job in background
 * 3. Frontend polls check-job-status until completed
 */
serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const supabase = getSupabaseClient()

    console.log(`Creating generation job for session: ${sessionId}`)

    // Get session with fetched data
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('fetched_projects_data')
      .eq('id', sessionId)
      .single()

    if (sessionError) {
      console.error(`Error fetching session: ${sessionError.message}`)
      throw new Error('Session not found')
    }

    // Get mapping
    const { data: mapping, error: mappingError } = await supabase
      .from('mappings')
      .select('id, mapping_json, long_text_strategy')
      .eq('session_id', sessionId)
      .single()

    if (mappingError || !mapping) {
      console.error(`No mapping found for session ${sessionId}. Error:`, mappingError)
      throw new Error('No mapping found for session. Please complete the mapping step first.')
    }

    // Get fetched data from session
    let fetchedData: Record<string, unknown>[] = []

    if (session?.fetched_projects_data) {
      const sessionData = session.fetched_projects_data as { projects?: Record<string, unknown>[] }
      fetchedData = sessionData.projects || []
    }

    if (fetchedData.length === 0) {
      throw new Error('No project data available. Please ensure AirSaas data has been fetched.')
    }

    console.log(`Found ${fetchedData.length} projects, creating job...`)

    // Create job with input data snapshot
    const { data: job, error: jobError } = await supabase
      .from('generation_jobs')
      .insert({
        session_id: sessionId,
        status: 'pending',
        engine: 'claude-pptx',
        input_data: {
          mappingJson: mapping.mapping_json,
          longTextStrategy: mapping.long_text_strategy,
          fetchedData: fetchedData,
        },
      })
      .select()
      .single()

    if (jobError || !job) {
      console.error('Failed to create job:', jobError)
      throw new Error('Failed to create generation job')
    }

    console.log(`Created job: ${job.id}`)

    // NOTE: Job processing is triggered by the frontend after receiving jobId
    // This ensures the processing request has its own 150s timeout (Pro plan)
    // instead of being tied to this function's lifecycle

    // Return immediately with job ID
    return new Response(
      JSON.stringify({
        success: true,
        jobId: job.id,
        message: 'Generation job created. Poll check-job-status for updates.',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Generate PPTX error:', error)
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
