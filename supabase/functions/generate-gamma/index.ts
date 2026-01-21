import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"
import { fetchAllProjectsData } from "../_shared/anthropic.ts"

function buildGammaContent(
  mappingJson: Record<string, unknown>,
  fetchedData: Record<string, unknown>[],
  longTextStrategy: string | null
): string {
  const slides: string[] = []

  // Summary slide
  slides.push(`# Portfolio Summary

## Project Overview
${fetchedData.map((p) => {
    const meta = p._metadata as { name: string; short_id?: string } | undefined
    const project = p.project as { mood?: string; status?: string } | undefined
    return `- **${meta?.name || 'Unknown'}** (${meta?.short_id || 'N/A'}) - ${project?.mood || 'N/A'} / ${project?.status || 'N/A'}`
  }).join('\n')}
`)

  // Process each project
  for (const projectData of fetchedData) {
    const meta = projectData._metadata as { name: string; short_id?: string } | undefined
    const project = projectData.project as Record<string, unknown> | undefined
    const milestones = projectData.milestones as Array<{ name: string; target_date?: string }> | undefined
    const budgetLines = projectData.budget_lines as Array<{ name: string; amount?: number }> | undefined

    // Card slide
    slides.push(`---

# ${meta?.name || 'Project'}

## Key Information
- **Status**: ${project?.status || 'N/A'}
- **Mood**: ${project?.mood || 'N/A'}
- **Risk Level**: ${project?.risk || 'N/A'}
- **Owner**: ${(project?.owner as { name?: string })?.name || 'N/A'}

${project?.description ? `### Description\n${truncateText(String(project.description), longTextStrategy)}` : ''}
`)

    // Progress slide (if milestones exist)
    if (milestones && milestones.length > 0) {
      slides.push(`---

# ${meta?.name || 'Project'} - Progress

## Milestones
${milestones.slice(0, 5).map((m) => `- ${m.name}: ${m.target_date || 'TBD'}`).join('\n')}
`)
    }

    // Budget slide (if budget lines exist)
    if (budgetLines && budgetLines.length > 0) {
      slides.push(`---

# ${meta?.name || 'Project'} - Budget

## Budget Lines
${budgetLines.slice(0, 5).map((b) => `- ${b.name}: ${b.amount?.toLocaleString() || 'N/A'}`).join('\n')}
`)
    }
  }

  // Missing fields slide
  const missingFields = (mappingJson as { missing_fields?: string[] })?.missing_fields || []
  if (missingFields.length > 0) {
    slides.push(`---

# Data Notes

## Fields Not Populated
${missingFields.map((f) => `- ${f}`).join('\n')}
`)
  }

  return slides.join('\n')
}

function truncateText(text: string, strategy: string | null): string {
  if (!text) return ''

  switch (strategy) {
    case 'summarize':
      // For Gamma, we'll just truncate - actual summarization would need Claude
      const sentences = text.split(/[.!?]+/).filter(Boolean)
      return sentences.slice(0, 2).join('. ') + (sentences.length > 2 ? '.' : '')
    case 'ellipsis':
      return text.length > 100 ? text.slice(0, 97) + '...' : text
    case 'omit':
      return text.length > 200 ? '' : text
    default:
      return text.length > 300 ? text.slice(0, 297) + '...' : text
  }
}

async function waitForGeneration(
  generationId: string,
  apiKey: string,
  baseUrl: string,
  maxAttempts = 30
): Promise<{ status: string; downloadUrl?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${baseUrl}/generations/${generationId}`, {
      headers: {
        'X-API-KEY': apiKey,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to check generation status: ${response.status}`)
    }

    const data = await response.json()

    if (data.status === 'completed') {
      return {
        status: 'completed',
        downloadUrl: data.exports?.pptx?.url,
      }
    }

    if (data.status === 'failed') {
      throw new Error('Generation failed')
    }

    // Wait 2 seconds before next check
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error('Generation timed out')
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const supabase = getSupabaseClient()

    const gammaApiKey = Deno.env.get('GAMMA_API_KEY')
    const gammaBaseUrl = Deno.env.get('GAMMA_BASE_URL') || 'https://public-api.gamma.app/v1.0'

    if (!gammaApiKey) {
      throw new Error('Missing GAMMA_API_KEY')
    }

    // Get mapping
    const { data: mapping, error: mappingError } = await supabase
      .from('mappings')
      .select('*')
      .eq('session_id', sessionId)
      .single()

    if (mappingError || !mapping) {
      throw new Error('No mapping found for session')
    }

    // Fetch AirSaas data if not already fetched
    let fetchedData = mapping.fetched_data as Record<string, unknown>[] | null
    if (!fetchedData || fetchedData.length === 0) {
      fetchedData = await fetchAllProjectsData()

      // Save fetched data
      await supabase
        .from('mappings')
        .update({ fetched_data: fetchedData })
        .eq('session_id', sessionId)
    }

    // Build content for Gamma
    const content = buildGammaContent(
      mapping.mapping_json || {},
      fetchedData,
      mapping.long_text_strategy
    )

    // Create generation via Gamma API
    const createResponse = await fetch(`${gammaBaseUrl}/generations`, {
      method: 'POST',
      headers: {
        'X-API-KEY': gammaApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: content,
        exportOptions: {
          pptx: true,
        },
      }),
    })

    if (!createResponse.ok) {
      const errorText = await createResponse.text()
      throw new Error(`Gamma API error: ${createResponse.status} - ${errorText}`)
    }

    const createData = await createResponse.json()
    const generationId = createData.id

    // Wait for generation to complete
    const result = await waitForGeneration(generationId, gammaApiKey, gammaBaseUrl)

    if (!result.downloadUrl) {
      throw new Error('No download URL in generation result')
    }

    // Download the PPTX from Gamma
    const pptxResponse = await fetch(result.downloadUrl)
    if (!pptxResponse.ok) {
      throw new Error('Failed to download PPTX from Gamma')
    }

    const pptxBuffer = await pptxResponse.arrayBuffer()

    // Upload to Supabase Storage
    const fileName = `${Date.now()}_report_gamma.pptx`
    const storagePath = `${sessionId}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('outputs')
      .upload(storagePath, pptxBuffer, {
        contentType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })

    if (uploadError) {
      throw new Error(`Failed to upload PPTX: ${uploadError.message}`)
    }

    // Get iteration count
    const { count } = await supabase
      .from('generated_reports')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)

    const iteration = (count || 0) + 1

    // Save report reference
    const { data: report, error: reportError } = await supabase
      .from('generated_reports')
      .insert({
        session_id: sessionId,
        engine: 'gamma',
        pptx_path: storagePath,
        iteration,
      })
      .select()
      .single()

    if (reportError) {
      throw new Error(`Failed to save report: ${reportError.message}`)
    }

    // Update session step
    await supabase
      .from('sessions')
      .update({ current_step: 'evaluating' })
      .eq('id', sessionId)

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('outputs')
      .getPublicUrl(storagePath)

    return new Response(
      JSON.stringify({
        success: true,
        reportId: report.id,
        pptxUrl: publicUrlData.publicUrl,
        storagePath,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Generate Gamma error:', error)
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
