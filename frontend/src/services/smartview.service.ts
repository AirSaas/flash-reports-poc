import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@config/constants'

// Types
export interface Smartview {
  id: string
  name: string
  description: string | null
  display: string
  view_category: string
  private: boolean
  updated_at: string
}

export interface SmartviewProject {
  id: string
  name: string
  short_id?: string
}

interface ListSmartviewsResponse {
  success: boolean
  smartviews?: Smartview[]
  total?: number
  error?: string
}

interface GetSmartviewProjectsResponse {
  success: boolean
  smartviewId?: string
  projects?: SmartviewProject[]
  total?: number
  fetched?: number
  errors?: string[]
  error?: string
}

/**
 * Fetches the list of available project smartviews from AirSaas
 */
export async function listSmartviews(): Promise<ListSmartviewsResponse> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/list-smartviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({}),
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    return { success: false, error: data.error || 'Failed to list smartviews' }
  }

  return {
    success: true,
    smartviews: data.smartviews,
    total: data.total,
  }
}

/**
 * Fetches the projects contained in a specific smartview
 */
export async function getSmartviewProjects(
  smartviewId: string
): Promise<GetSmartviewProjectsResponse> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/get-smartview-projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ smartviewId }),
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    return { success: false, error: data.error || 'Failed to get smartview projects' }
  }

  return {
    success: true,
    smartviewId: data.smartviewId,
    projects: data.projects,
    total: data.total,
    fetched: data.fetched,
    errors: data.errors,
  }
}
