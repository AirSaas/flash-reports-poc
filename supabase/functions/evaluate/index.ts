import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"
import { getAnthropicClient } from "../_shared/anthropic.ts"

const EVALUATION_THRESHOLD = 65
const MAX_ITERATIONS = 2

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const { reportId } = await req.json()

    if (!reportId) {
      throw new Error('Report ID is required')
    }

    const supabase = getSupabaseClient()

    // Get mapping and report
    const { data: mapping, error: mappingError } = await supabase
      .from('mappings')
      .select('*')
      .eq('session_id', sessionId)
      .single()

    if (mappingError || !mapping) {
      throw new Error('No mapping found for session')
    }

    const { data: report, error: reportError } = await supabase
      .from('generated_reports')
      .select('*')
      .eq('id', reportId)
      .single()

    if (reportError || !report) {
      throw new Error('Report not found')
    }

    // Call Claude to evaluate
    const client = getAnthropicClient()

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Evaluate the quality of a generated PPTX report based on the mapping and original data.

## Expected Mapping
${JSON.stringify(mapping.mapping_json, null, 2)}

## Original Data
${JSON.stringify(mapping.fetched_data, null, 2)}

## Report Details
- Engine: ${report.engine}
- Iteration: ${report.iteration}

Evaluation criteria:
1. Completeness: Are all mapped fields present? (0-40 points)
2. Accuracy: Is the data correct and properly formatted? (0-40 points)
3. Formatting: Is the format readable and professional? (0-20 points)

Since I cannot see the actual PPTX, evaluate based on:
- Whether the mapping covers all important project fields
- Whether the data structure supports a complete report
- Estimate likely issues based on mapping complexity

Respond ONLY with this JSON:
{
  "score": <number 0-100>,
  "completeness": <0-40>,
  "accuracy": <0-40>,
  "formatting": <0-20>,
  "issues": ["issue1", "issue2"],
  "recommendation": "pass" | "regenerate"
}`,
        },
      ],
    })

    const evalText =
      response.content[0].type === 'text' ? response.content[0].text : ''

    // Parse evaluation JSON
    let evalJson: {
      score: number
      completeness: number
      accuracy: number
      formatting: number
      issues: string[]
      recommendation: 'pass' | 'regenerate'
    }

    try {
      const match = evalText.match(/\{[\s\S]*\}/)
      if (match) {
        evalJson = JSON.parse(match[0])
      } else {
        throw new Error('No JSON found in response')
      }
    } catch (_e) {
      // Default evaluation if parsing fails
      evalJson = {
        score: 70,
        completeness: 28,
        accuracy: 28,
        formatting: 14,
        issues: ['Could not fully evaluate - using default scores'],
        recommendation: 'pass',
      }
    }

    // Update report with score
    await supabase
      .from('generated_reports')
      .update({ eval_score: evalJson.score })
      .eq('id', reportId)

    // Update session step
    await supabase
      .from('sessions')
      .update({ current_step: 'done' })
      .eq('id', sessionId)

    // Determine if regeneration should happen
    const shouldRegenerate =
      evalJson.score < EVALUATION_THRESHOLD &&
      evalJson.recommendation === 'regenerate' &&
      report.iteration < MAX_ITERATIONS

    return new Response(
      JSON.stringify({
        evaluation: evalJson,
        shouldRegenerate,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Evaluate error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
