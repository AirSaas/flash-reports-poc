import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"
import { fetchAirSaasProjectData, compressProjectData } from "../_shared/anthropic.ts"

interface ProjectItem {
  id: string
  name: string
  short_id?: string
}

/**
 * @deprecated Legacy format - use smartview format instead
 */
interface LegacyProjectsConfig {
  workspace: string
  projects: ProjectItem[]
}

/**
 * New smartview-based format
 */
interface SmartviewConfig {
  smartview_id: string
  smartview_name: string
  projects: ProjectItem[]
}

type RequestBody = {
  // New format: smartview-based
  smartviewConfig?: SmartviewConfig
  // Legacy format: manual JSON config (deprecated)
  projectsConfig?: LegacyProjectsConfig
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const body: RequestBody = await req.json()

    // Support both new smartview format and legacy format
    let projects: ProjectItem[] = []
    let sourceIdentifier: string = 'unknown'

    if (body.smartviewConfig) {
      // New smartview-based format
      projects = body.smartviewConfig.projects
      sourceIdentifier = `smartview:${body.smartviewConfig.smartview_name}`
      console.log(`Using smartview config: ${body.smartviewConfig.smartview_name} (${body.smartviewConfig.smartview_id})`)
    } else if (body.projectsConfig) {
      // Legacy format (deprecated but still supported)
      console.warn('Using deprecated projectsConfig format. Please migrate to smartviewConfig.')
      projects = body.projectsConfig.projects
      sourceIdentifier = `workspace:${body.projectsConfig.workspace}`
    } else {
      throw new Error('Either smartviewConfig or projectsConfig is required')
    }

    if (!projects || projects.length === 0) {
      throw new Error('No projects provided')
    }

    const supabase = getSupabaseClient()

    console.log(`Fetching data for ${projects.length} projects...`)

    const allProjectsData: Record<string, unknown>[] = []
    const errors: Array<{ projectId: string; error: string }> = []

    // Fetch data for each project
    for (let i = 0; i < projects.length; i++) {
      const project = projects[i]
      console.log(`[${i + 1}/${projects.length}] Fetching project: ${project.name} (${project.id})`)

      try {
        const projectData = await fetchAirSaasProjectData(project.id)
        allProjectsData.push({
          ...projectData,
          _metadata: {
            id: project.id,
            short_id: project.short_id,
            name: project.name,
          },
        })
      } catch (error) {
        console.error(`Failed to fetch project ${project.id}:`, error)
        errors.push({
          projectId: project.id,
          error: error instanceof Error ? error.message : String(error),
        })
        // Continue with other projects
        allProjectsData.push({
          _metadata: {
            id: project.id,
            short_id: project.short_id,
            name: project.name,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    }

    // Compress data to reduce token usage
    const compressedData = compressProjectData(allProjectsData)

    // Build final structure
    const fetchedData: Record<string, unknown> = {
      fetched_at: new Date().toISOString(),
      source: sourceIdentifier,
      project_count: projects.length,
      successful_count: projects.length - errors.length,
      projects: compressedData,
    }

    // Add smartview info if using new format
    if (body.smartviewConfig) {
      fetchedData.smartview_id = body.smartviewConfig.smartview_id
      fetchedData.smartview_name = body.smartviewConfig.smartview_name
    }

    // Legacy: keep workspace for backward compatibility
    if (body.projectsConfig?.workspace) {
      fetchedData.workspace = body.projectsConfig.workspace
    }

    // Save to session (upsert to create if not exists)
    await supabase
      .from('sessions')
      .upsert({
        id: sessionId,
        fetched_projects_data: fetchedData,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    console.log(`Fetched ${projects.length - errors.length}/${projects.length} projects successfully`)

    return new Response(
      JSON.stringify({
        success: true,
        projectCount: projects.length,
        successfulCount: projects.length - errors.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Fetch projects error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
