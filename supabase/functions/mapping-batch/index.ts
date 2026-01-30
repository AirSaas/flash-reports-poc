import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"
import { getAnthropicClient } from "../_shared/anthropic.ts"

// Available AirSaas API fields that can be mapped
const AVAILABLE_AIRSAAS_FIELDS = [
  // Basic project info
  { id: 'project.name', label: 'Project Name', description: 'The name of the project' },
  { id: 'project.short_id', label: 'Project Short ID', description: 'Short identifier like AQM-P8' },
  { id: 'project.description_text', label: 'Project Description', description: 'Project description as plain text' },
  { id: 'project.description', label: 'Project Description (Rich)', description: 'Project description with formatting' },

  // Status fields
  { id: 'project.status', label: 'Project Status', description: 'Current status (in_progress, finished, etc.)' },
  { id: 'project.mood', label: 'Project Mood', description: 'Mood indicator (good, complicated, blocked, etc.)' },
  { id: 'project.risk', label: 'Project Risk', description: 'Risk level (low, medium, high)' },

  // Owner info
  { id: 'project.owner.name', label: 'Owner Full Name', description: 'Project owner full name' },
  { id: 'project.owner.given_name', label: 'Owner First Name', description: 'Project owner first name' },
  { id: 'project.owner.family_name', label: 'Owner Last Name', description: 'Project owner last name' },
  { id: 'project.owner.initials', label: 'Owner Initials', description: 'Project owner initials' },

  // Dates
  { id: 'project.start_date', label: 'Start Date', description: 'Project start date' },
  { id: 'project.end_date', label: 'End Date', description: 'Project end date' },

  // Budget
  { id: 'project.budget_capex', label: 'Budget CAPEX', description: 'Capital expenditure budget' },
  { id: 'project.budget_opex', label: 'Budget OPEX', description: 'Operational expenditure budget' },
  { id: 'project.budget_capex_used', label: 'Budget CAPEX Used', description: 'Capital expenditure used' },
  { id: 'project.budget_opex_used', label: 'Budget OPEX Used', description: 'Operational expenditure used' },

  // Program
  { id: 'project.program.name', label: 'Program Name', description: 'Associated program name' },
  { id: 'project.program.short_id', label: 'Program ID', description: 'Program short identifier' },

  // Progress and effort
  { id: 'project.progress', label: 'Progress', description: 'Project progress percentage' },
  { id: 'project.milestone_progress', label: 'Milestone Progress', description: 'Milestone completion progress' },
  { id: 'project.effort', label: 'Planned Effort', description: 'Planned effort value' },
  { id: 'project.effort_used', label: 'Effort Used', description: 'Actual effort consumed' },

  // Arrays
  { id: 'milestones', label: 'Milestones', description: 'Array of milestones with dates and status' },
  { id: 'members', label: 'Project Members', description: 'Array of project team members' },
  { id: 'efforts', label: 'Team Efforts', description: 'Effort entries by team/period' },
  { id: 'budget_values', label: 'Budget Values', description: 'Budget value entries' },
  { id: 'attention_points', label: 'Attention Points', description: 'Items requiring attention' },
  { id: 'decisions', label: 'Decisions', description: 'Project decisions with status' },

  // Other
  { id: 'project.goals', label: 'Project Goals', description: 'Array of project goals' },
  { id: 'project.teams', label: 'Project Teams', description: 'Array of associated teams' },
  { id: 'project.importance', label: 'Importance', description: 'Project importance level' },
  { id: 'project.gain_text', label: 'Expected Gains', description: 'Expected gains/benefits text' },

  // Metadata
  { id: '_metadata.name', label: 'Project Name (Meta)', description: 'Project name from metadata' },
  { id: '_metadata.short_id', label: 'Project ID (Meta)', description: 'Short ID from metadata' },

  // Special
  { id: 'current_date', label: 'Current Date', description: 'Today\'s date at generation time' },

  // Skip option
  { id: 'none', label: 'No mapping (skip)', description: 'Leave this field empty' },
]

const BATCH_MAPPING_PROMPT = `You are helping map PowerPoint template fields to AirSaas project data fields.

These fields come from a deduplicated template analysis — repeated slides have been grouped into unique templates, so each field appears only once even if the slide repeats per project.

## Template Fields to Map
{template_fields}

## Available AirSaas Fields
{available_fields}

## Sample Project Data (for context)
{sample_data}

## Task
For EACH template field, suggest the best matching AirSaas field based on:
1. Field name semantics (e.g., "Nom du projet" → project.name)
2. Data type compatibility (dates → date fields, lists → array fields)
3. The sample data values for validation

Respond with a JSON array containing one object per template field:
\`\`\`json
[
  {
    "field_id": "the template field id",
    "suggested_mapping": "the AirSaas field id (e.g., project.name)",
    "confidence": "high|medium|low",
    "reasoning": "brief explanation"
  },
  ...
]
\`\`\`

Important:
- Use "none" as suggested_mapping if no good match exists
- Be precise with the field_id - use exactly the same id from the template fields
- Consider data types: dates should map to date fields, arrays to array fields, etc.
`

interface TemplateField {
  id: string
  name: string
  placeholder_text?: string
  data_type?: string
  location?: string
  slide_number?: number
}

interface ProjectData {
  project?: Record<string, unknown>
  milestones?: unknown[]
  decisions?: unknown[]
  attention_points?: unknown[]
  members?: unknown[]
  [key: string]: unknown
}

/**
 * Truncate sample data to fit within token limits
 */
function truncateSampleData(projectData: ProjectData, maxChars = 3000): Record<string, unknown> {
  const truncated: Record<string, unknown> = {}

  if (projectData.project) {
    const project = projectData.project as Record<string, unknown>
    truncated.project = Object.fromEntries(
      Object.entries(project).filter(([k]) =>
        [
          'name', 'short_id', 'description_text', 'status', 'mood', 'risk',
          'start_date', 'end_date', 'progress', 'milestone_progress',
          'budget_capex', 'budget_opex', 'importance'
        ].includes(k)
      )
    )

    // Add owner info if present
    if (project.owner && typeof project.owner === 'object') {
      (truncated.project as Record<string, unknown>).owner = Object.fromEntries(
        Object.entries(project.owner as Record<string, unknown>).filter(([k]) =>
          ['name', 'given_name', 'family_name', 'initials'].includes(k)
        )
      )
    }

    // Add program info if present
    if (project.program && typeof project.program === 'object') {
      (truncated.project as Record<string, unknown>).program = Object.fromEntries(
        Object.entries(project.program as Record<string, unknown>).filter(([k]) =>
          ['name', 'short_id'].includes(k)
        )
      )
    }
  }

  // Include first few items of arrays for context
  for (const key of ['milestones', 'decisions', 'attention_points', 'members']) {
    if (projectData[key] && Array.isArray(projectData[key])) {
      const items = (projectData[key] as unknown[]).slice(0, 3)
      if (items.length > 0) {
        truncated[key] = items
      }
    }
  }

  // Convert to string and check size
  const resultStr = JSON.stringify(truncated)
  if (resultStr.length > maxChars) {
    // Further truncate if needed
    return { project: truncated.project || {} }
  }

  return truncated
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const supabase = getSupabaseClient()

    console.log(`[mapping-batch] Starting for session ${sessionId}`)

    // Get session with template analysis and fetched data
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      throw new Error('Session not found')
    }

    const templateAnalysis = session.template_analysis
    const fetchedProjectsData = session.fetched_projects_data as { projects?: ProjectData[] } | null

    if (!templateAnalysis || (!templateAnalysis.slide_templates && !templateAnalysis.slides)) {
      throw new Error('Template analysis not found. Please analyze the template first.')
    }

    // Extract all fields from template analysis (support new deduplicated + legacy format)
    // Deduplicate by field ID — same field (e.g. "project_name") may appear in multiple templates
    const seenFieldIds = new Set<string>()
    const allFields: TemplateField[] = []
    if (templateAnalysis.slide_templates) {
      // New deduplicated format
      for (const tmpl of templateAnalysis.slide_templates) {
        for (const field of tmpl.fields || []) {
          if (!seenFieldIds.has(field.id)) {
            seenFieldIds.add(field.id)
            allFields.push({
              ...field,
              slide_number: tmpl.example_slide_numbers?.[0],
            })
          }
        }
      }
    } else {
      // Legacy format
      for (const slide of templateAnalysis.slides) {
        for (const field of slide.fields || []) {
          if (!seenFieldIds.has(field.id)) {
            seenFieldIds.add(field.id)
            allFields.push({
              ...field,
              slide_number: slide.slide_number,
            })
          }
        }
      }
    }

    if (allFields.length === 0) {
      throw new Error('No fields found in template analysis')
    }

    console.log(`[mapping-batch] Found ${allFields.length} fields to map`)

    // Get sample project data for context
    let sampleData: Record<string, unknown> = {}
    if (fetchedProjectsData?.projects && fetchedProjectsData.projects.length > 0) {
      const firstProject = fetchedProjectsData.projects[0]
      sampleData = truncateSampleData(firstProject)
    }

    // Format template fields for prompt
    const templateFieldsStr = JSON.stringify(
      allFields.map((f) => ({
        id: f.id,
        name: f.name,
        data_type: f.data_type || 'text',
        placeholder_text: f.placeholder_text || '',
        location: f.location || 'body',
        slide_number: f.slide_number,
      })),
      null,
      2
    )

    // Format available fields
    const availableFieldsStr = AVAILABLE_AIRSAAS_FIELDS.map(
      (f) => `- ${f.id}: ${f.label} - ${f.description}`
    ).join('\n')

    // Format sample data
    const sampleDataStr = Object.keys(sampleData).length > 0
      ? JSON.stringify(sampleData, null, 2)
      : 'No sample data available'

    // Build prompt
    const prompt = BATCH_MAPPING_PROMPT
      .replace('{template_fields}', templateFieldsStr)
      .replace('{available_fields}', availableFieldsStr)
      .replace('{sample_data}', sampleDataStr)

    // Call Claude
    const client = getAnthropicClient()

    console.log(`[mapping-batch] Calling Claude API...`)

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    })

    // Extract text response
    let suggestionText = ''
    for (const block of response.content) {
      if (block.type === 'text') {
        suggestionText += block.text
      }
    }

    // Parse JSON array from response
    let suggestions: Array<{
      field_id: string
      suggested_mapping: string
      confidence: string
      reasoning: string
    }> = []

    const jsonMatch = suggestionText.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try {
        suggestions = JSON.parse(jsonMatch[0])
      } catch (e) {
        console.error('[mapping-batch] Failed to parse suggestions JSON:', e)
      }
    }

    // Build suggestions map
    const suggestionsMap = new Map(
      suggestions.map((s) => [s.field_id, s])
    )

    // Merge suggestions with fields
    const fieldsWithSuggestions = allFields.map((field) => {
      const suggestion = suggestionsMap.get(field.id)
      return {
        ...field,
        suggested_mapping: suggestion?.suggested_mapping || 'none',
        confidence: (suggestion?.confidence || 'low') as 'high' | 'medium' | 'low',
        reasoning: suggestion?.reasoning || '',
      }
    })

    // All available options
    const allOptions = AVAILABLE_AIRSAAS_FIELDS.map((f) => ({
      id: f.id,
      label: f.label,
      description: f.description,
    }))

    console.log(`[mapping-batch] Generated suggestions for ${fieldsWithSuggestions.length} fields`)

    return new Response(
      JSON.stringify({
        fields: fieldsWithSuggestions,
        allOptions,
        totalFields: fieldsWithSuggestions.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('[mapping-batch] Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
