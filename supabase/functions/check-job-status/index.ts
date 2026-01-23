import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

/**
 * Check the status of a job (generation or evaluation).
 * Used for polling from the frontend.
 */
serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const supabase = getSupabaseClient()

    const { jobId } = await req.json()

    if (!jobId) {
      throw new Error('jobId is required')
    }

    // Get job status
    const { data: job, error: jobError } = await supabase
      .from('generation_jobs')
      .select('id, job_type, status, result, error, prompt, created_at, started_at, completed_at')
      .eq('id', jobId)
      .eq('session_id', sessionId) // Security: only allow checking own jobs
      .single()

    if (jobError || !job) {
      throw new Error('Job not found')
    }

    return new Response(
      JSON.stringify({
        success: true,
        job: {
          id: job.id,
          jobType: job.job_type || 'generation', // Default for backwards compatibility
          status: job.status,
          result: job.result,
          error: job.error,
          prompt: job.prompt,
          createdAt: job.created_at,
          startedAt: job.started_at,
          completedAt: job.completed_at,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Check job status error:', error)
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
