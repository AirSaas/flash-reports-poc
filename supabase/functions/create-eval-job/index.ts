import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

/**
 * Creates an evaluation job and returns immediately with a jobId.
 * The frontend then triggers process-eval-job and polls check-job-status.
 *
 * Flow:
 * 1. Frontend calls create-eval-job → gets jobId immediately
 * 2. Frontend triggers process-eval-job in background
 * 3. Frontend polls check-job-status until completed
 */
serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const supabase = getSupabaseClient()

    const { reportId } = await req.json()

    if (!reportId) {
      throw new Error('reportId is required')
    }

    console.log('═══════════════════════════════════════════════════════════')
    console.log('[CREATE-EVAL-JOB] Creating evaluation job')
    console.log(`[CREATE-EVAL-JOB] Session: ${sessionId}`)
    console.log(`[CREATE-EVAL-JOB] Report: ${reportId}`)
    console.log('═══════════════════════════════════════════════════════════')

    // Verify report exists and belongs to session
    const { data: report, error: reportError } = await supabase
      .from('generated_reports')
      .select('id, pptx_path, session_id, engine')
      .eq('id', reportId)
      .eq('session_id', sessionId)
      .single()

    if (reportError || !report) {
      throw new Error('Report not found or does not belong to this session')
    }

    if (!report.pptx_path) {
      throw new Error('Report has no file to evaluate')
    }

    // Check if this is a claude-html report — look for PDF in generation job result
    let pdfPath: string | null = null
    if (report.engine === 'claude-html') {
      const { data: genJob } = await supabase
        .from('generation_jobs')
        .select('result')
        .eq('session_id', sessionId)
        .eq('engine', 'claude-html')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .single()

      if (genJob?.result?.pdfStoragePath) {
        pdfPath = genJob.result.pdfStoragePath
        console.log(`[CREATE-EVAL-JOB] Found PDF storage path: ${pdfPath}`)
      } else {
        console.log('[CREATE-EVAL-JOB] No PDF path found, will use pptx_path (HTML)')
      }
    }

    // Get session for project count
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('fetched_projects_data')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      throw new Error('Session not found')
    }

    const fetchedProjectsData = session.fetched_projects_data as {
      projects?: Record<string, unknown>[]
    } | null

    const projectCount = fetchedProjectsData?.projects?.length || 0

    // Create evaluation job
    const { data: job, error: jobError } = await supabase
      .from('generation_jobs')
      .insert({
        session_id: sessionId,
        job_type: 'evaluation',
        status: 'pending',
        engine: 'claude-pptx',
        report_id: reportId,
        input_data: {
          reportId,
          pptxPath: pdfPath ? undefined : report.pptx_path,
          pdfPath: pdfPath || undefined,
          projectCount,
        },
      })
      .select()
      .single()

    if (jobError || !job) {
      console.error('[CREATE-EVAL-JOB] Failed to create job:', jobError)
      throw new Error('Failed to create evaluation job')
    }

    console.log(`[CREATE-EVAL-JOB] Created job: ${job.id}`)
    console.log('═══════════════════════════════════════════════════════════')

    return new Response(
      JSON.stringify({
        success: true,
        jobId: job.id,
        message: 'Evaluation job created. Trigger process-eval-job and poll check-job-status.',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('[CREATE-EVAL-JOB] Error:', error)
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
