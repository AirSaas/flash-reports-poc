import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"

interface TemplateAnalysis {
  slide_templates?: Array<{
    template_id: string
    title: string
    type: 'per_project' | 'global'
    example_slide_numbers: number[]
    fields: Array<{ id: string; name: string }>
  }>
  slides?: Array<{
    slide_number: number
    fields: Array<{ id: string; name: string }>
  }>
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const { mappings } = await req.json() as { mappings: Record<string, string> }

    if (!mappings || typeof mappings !== 'object') {
      throw new Error('Missing or invalid mappings in request body')
    }

    const supabase = getSupabaseClient()

    console.log(`[mapping-batch-submit] Saving mappings for session ${sessionId}`)

    // Get session data for template_analysis
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('template_analysis, template_path')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      throw new Error('Session not found')
    }

    const templateAnalysis = session.template_analysis as TemplateAnalysis | null

    if (!templateAnalysis || (!templateAnalysis.slide_templates && !templateAnalysis.slides)) {
      throw new Error('Template analysis not found')
    }

    // Build final mapping JSON structure
    const finalMapping: {
      slides: Record<string, Record<string, unknown>>
      missing_fields: string[]
    } = {
      slides: {},
      missing_fields: [],
    }

    if (templateAnalysis.slide_templates) {
      // New deduplicated format
      for (const tmpl of templateAnalysis.slide_templates) {
        const key = `template_${tmpl.template_id}`
        finalMapping.slides[key] = {
          _meta: { type: tmpl.type, example_slide_numbers: tmpl.example_slide_numbers },
        }

        for (const field of tmpl.fields || []) {
          const mappedSource = mappings[field.id]
          if (mappedSource && mappedSource !== 'none') {
            finalMapping.slides[key][field.id] = { source: mappedSource, status: 'ok' }
          } else {
            finalMapping.missing_fields.push(field.id)
          }
        }
      }
    } else {
      // Legacy format
      for (const slide of templateAnalysis.slides!) {
        const slideKey = `slide_${slide.slide_number}`
        finalMapping.slides[slideKey] = {}

        for (const field of slide.fields || []) {
          const mappedSource = mappings[field.id]
          if (mappedSource && mappedSource !== 'none') {
            finalMapping.slides[slideKey][field.id] = { source: mappedSource, status: 'ok' }
          } else {
            finalMapping.missing_fields.push(field.id)
          }
        }
      }
    }

    // Get template path from session
    const templatePath = session.template_path || ''

    // Check if mapping already exists for this session
    const { data: existingMapping } = await supabase
      .from('mappings')
      .select('id')
      .eq('session_id', sessionId)
      .single()

    let mappingId: string

    if (existingMapping) {
      // Update existing mapping
      const { error: updateError } = await supabase
        .from('mappings')
        .update({ mapping_json: finalMapping })
        .eq('id', existingMapping.id)

      if (updateError) {
        throw new Error(`Failed to update mapping: ${updateError.message}`)
      }

      mappingId = existingMapping.id
      console.log(`[mapping-batch-submit] Updated existing mapping ${mappingId}`)
    } else {
      // Create new mapping
      const { data: newMapping, error: insertError } = await supabase
        .from('mappings')
        .insert({
          session_id: sessionId,
          mapping_json: finalMapping,
          template_path: templatePath,
        })
        .select('id')
        .single()

      if (insertError || !newMapping) {
        throw new Error(`Failed to create mapping: ${insertError?.message || 'Unknown error'}`)
      }

      mappingId = newMapping.id
      console.log(`[mapping-batch-submit] Created new mapping ${mappingId}`)
    }

    // Update session step to long_text_options
    const { error: sessionUpdateError } = await supabase
      .from('sessions')
      .update({ current_step: 'long_text_options' })
      .eq('id', sessionId)

    if (sessionUpdateError) {
      console.error('[mapping-batch-submit] Failed to update session step:', sessionUpdateError)
    }

    // Count mapped vs skipped
    const mappedCount = Object.values(mappings).filter((v) => v && v !== 'none').length
    const skippedCount = Object.values(mappings).filter((v) => !v || v === 'none').length

    console.log(`[mapping-batch-submit] Saved ${mappedCount} mappings, ${skippedCount} skipped`)

    return new Response(
      JSON.stringify({
        success: true,
        mappingId,
        mappedFields: mappedCount,
        skippedFields: skippedCount,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('[mapping-batch-submit] Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
