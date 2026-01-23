import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getSupabaseClient, getSessionId } from "../_shared/supabase.ts"
import { fetchAirSaasProjectData, compressProjectData } from "../_shared/anthropic.ts"

interface ProjectItem {
  id: string
  name: string
  short_id?: string
}

interface ProjectsConfig {
  workspace: string
  projects: ProjectItem[]
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const sessionId = getSessionId(req)
    const { projectsConfig } = await req.json() as { projectsConfig: ProjectsConfig }

    if (!projectsConfig || !projectsConfig.projects || projectsConfig.projects.length === 0) {
      throw new Error('projectsConfig with projects array is required')
    }

    const supabase = getSupabaseClient()

    console.log(`Fetching data for ${projectsConfig.projects.length} projects...`)

    const allProjectsData: Record<string, unknown>[] = []
    const errors: Array<{ projectId: string; error: string }> = []

    // Fetch data for each project
    for (let i = 0; i < projectsConfig.projects.length; i++) {
      const project = projectsConfig.projects[i]
      console.log(`[${i + 1}/${projectsConfig.projects.length}] Fetching project: ${project.name} (${project.id})`)

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
    const fetchedData = {
      fetched_at: new Date().toISOString(),
      workspace: projectsConfig.workspace,
      project_count: projectsConfig.projects.length,
      successful_count: projectsConfig.projects.length - errors.length,
      projects: compressedData,
    }

    // Save to session (upsert to create if not exists)
    await supabase
      .from('sessions')
      .upsert({
        id: sessionId,
        fetched_projects_data: fetchedData,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    console.log(`Fetched ${projectsConfig.projects.length - errors.length}/${projectsConfig.projects.length} projects successfully`)

    return new Response(
      JSON.stringify({
        success: true,
        projectCount: projectsConfig.projects.length,
        successfulCount: projectsConfig.projects.length - errors.length,
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
