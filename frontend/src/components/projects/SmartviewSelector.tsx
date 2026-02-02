import { useState, useCallback, useEffect, useMemo } from 'react'
import { cn } from '@lib/utils'
import { listSmartviews, getSmartviewProjects } from '@services/smartview.service'
import type { Smartview, SmartviewSelection, ProjectItem } from '@appTypes/index'

interface SmartviewSelectorProps {
  selection: SmartviewSelection | null
  onSelect: (selection: SmartviewSelection) => void
  onContinue: () => void
  disabled?: boolean
}

export function SmartviewSelector({
  selection,
  onSelect,
  onContinue,
  disabled = false,
}: SmartviewSelectorProps) {
  const [smartviews, setSmartviews] = useState<Smartview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [projectSearchQuery, setProjectSearchQuery] = useState('')
  const [selectedSmartview, setSelectedSmartview] = useState<Smartview | null>(
    selection?.smartview || null
  )
  const [allProjects, setAllProjects] = useState<ProjectItem[]>([])
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    new Set(selection?.projects.map((p) => p.id) || [])
  )

  // Load smartviews on mount
  useEffect(() => {
    async function loadSmartviews() {
      setLoading(true)
      setError(null)

      const result = await listSmartviews()

      if (result.success && result.smartviews) {
        setSmartviews(result.smartviews)
      } else {
        setError(result.error || 'Failed to load smartviews')
      }

      setLoading(false)
    }

    loadSmartviews()
  }, [])

  // Filter smartviews based on search query
  const filteredSmartviews = useMemo(() => {
    if (!searchQuery.trim()) {
      return smartviews
    }

    const query = searchQuery.toLowerCase()
    return smartviews.filter(
      (sv) =>
        sv.name.toLowerCase().includes(query) ||
        sv.description?.toLowerCase().includes(query) ||
        sv.view_category.toLowerCase().includes(query)
    )
  }, [smartviews, searchQuery])

  // Filter projects based on search query
  const filteredProjects = useMemo(() => {
    if (!projectSearchQuery.trim()) {
      return allProjects
    }

    const query = projectSearchQuery.toLowerCase()
    return allProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.short_id?.toLowerCase().includes(query)
    )
  }, [allProjects, projectSearchQuery])

  // Handle smartview selection
  const handleSmartviewClick = useCallback(
    async (smartview: Smartview) => {
      if (disabled) return

      setSelectedSmartview(smartview)
      setLoadingProjects(true)
      setError(null)
      setAllProjects([])
      setSelectedProjectIds(new Set())
      setProjectSearchQuery('')

      const result = await getSmartviewProjects(smartview.id)

      if (result.success && result.projects) {
        setAllProjects(result.projects)
        // Select all projects by default
        const allIds = new Set(result.projects.map((p) => p.id))
        setSelectedProjectIds(allIds)
        onSelect({
          smartview,
          projects: result.projects,
        })
      } else {
        setError(result.error || 'Failed to load projects')
        setSelectedSmartview(null)
      }

      setLoadingProjects(false)
    },
    [disabled, onSelect]
  )

  // Handle project toggle
  const handleProjectToggle = useCallback(
    (projectId: string) => {
      if (disabled) return

      setSelectedProjectIds((prev) => {
        const newSet = new Set(prev)
        if (newSet.has(projectId)) {
          newSet.delete(projectId)
        } else {
          newSet.add(projectId)
        }

        // Update selection with new project list
        if (selectedSmartview) {
          const newSelectedProjects = allProjects.filter((p) => newSet.has(p.id))
          onSelect({
            smartview: selectedSmartview,
            projects: newSelectedProjects,
          })
        }

        return newSet
      })
    },
    [disabled, selectedSmartview, allProjects, onSelect]
  )

  // Handle select all / deselect all
  const handleSelectAll = useCallback(() => {
    if (disabled || !selectedSmartview) return

    const projectsToSelect = projectSearchQuery.trim() ? filteredProjects : allProjects
    const allIds = new Set(projectsToSelect.map((p) => p.id))

    // Merge with existing selections if filtering
    const newSet = projectSearchQuery.trim()
      ? new Set([...selectedProjectIds, ...allIds])
      : allIds

    setSelectedProjectIds(newSet)

    const newSelectedProjects = allProjects.filter((p) => newSet.has(p.id))
    onSelect({
      smartview: selectedSmartview,
      projects: newSelectedProjects,
    })
  }, [disabled, selectedSmartview, allProjects, filteredProjects, projectSearchQuery, selectedProjectIds, onSelect])

  const handleDeselectAll = useCallback(() => {
    if (disabled || !selectedSmartview) return

    if (projectSearchQuery.trim()) {
      // Only deselect filtered projects
      const filteredIds = new Set(filteredProjects.map((p) => p.id))
      const newSet = new Set([...selectedProjectIds].filter((id) => !filteredIds.has(id)))
      setSelectedProjectIds(newSet)

      const newSelectedProjects = allProjects.filter((p) => newSet.has(p.id))
      onSelect({
        smartview: selectedSmartview,
        projects: newSelectedProjects,
      })
    } else {
      // Deselect all
      setSelectedProjectIds(new Set())
      onSelect({
        smartview: selectedSmartview,
        projects: [],
      })
    }
  }, [disabled, selectedSmartview, allProjects, filteredProjects, projectSearchQuery, selectedProjectIds, onSelect])

  const selectedCount = selectedProjectIds.size
  const totalCount = allProjects.length
  const filteredCount = filteredProjects.length

  // Format view category for display
  const formatCategory = (category: string) => {
    return category
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <p className="text-gray-600">Loading smartviews from AirSaas...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Select a Smartview</h2>
        <p className="text-sm text-gray-600 mt-1">
          Choose a smartview and select which projects to include in the report.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Smartview search input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search smartviews..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          disabled={disabled}
          className={cn(
            'w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg',
            'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
            disabled && 'opacity-50 cursor-not-allowed bg-gray-50'
          )}
        />
        <svg
          className="absolute left-3 top-2.5 h-5 w-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>

      {/* Smartviews list */}
      <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
        {filteredSmartviews.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            {searchQuery ? 'No smartviews match your search' : 'No smartviews available'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filteredSmartviews.map((sv) => {
              const isSelected = selectedSmartview?.id === sv.id

              return (
                <li key={sv.id}>
                  <button
                    onClick={() => handleSmartviewClick(sv)}
                    disabled={disabled || loadingProjects}
                    className={cn(
                      'w-full px-4 py-3 text-left transition-colors',
                      'hover:bg-gray-50 focus:outline-none focus:bg-gray-50',
                      isSelected && 'bg-blue-50 hover:bg-blue-50',
                      (disabled || loadingProjects) && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                            isSelected
                              ? 'border-blue-600 bg-blue-600'
                              : 'border-gray-300'
                          )}
                        >
                          {isSelected && (
                            <svg
                              className="w-2.5 h-2.5 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p
                            className={cn(
                              'font-medium',
                              isSelected ? 'text-blue-900' : 'text-gray-900'
                            )}
                          >
                            {sv.name}
                            {sv.private && (
                              <span className="ml-2 text-xs text-gray-400">(private)</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatCategory(sv.view_category)}
                          </p>
                        </div>
                      </div>
                      {isSelected && loadingProjects && (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Loading projects indicator */}
      {loadingProjects && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
          <p className="text-sm text-blue-700">Loading projects from smartview...</p>
        </div>
      )}

      {/* Project selection section */}
      {selectedSmartview && !loadingProjects && allProjects.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {/* Header with search and select/deselect all */}
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-900">
                Select Projects ({selectedCount}/{totalCount})
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={handleSelectAll}
                  disabled={disabled}
                  className={cn(
                    'text-xs px-2 py-1 rounded transition-colors',
                    'text-blue-600 hover:bg-blue-100',
                    disabled && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  Select {projectSearchQuery.trim() ? `${filteredCount} filtered` : 'all'}
                </button>
                <button
                  onClick={handleDeselectAll}
                  disabled={disabled || selectedCount === 0}
                  className={cn(
                    'text-xs px-2 py-1 rounded transition-colors',
                    'text-gray-600 hover:bg-gray-200',
                    (disabled || selectedCount === 0) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  Deselect {projectSearchQuery.trim() ? 'filtered' : 'all'}
                </button>
              </div>
            </div>
            {/* Project search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Filter projects..."
                value={projectSearchQuery}
                onChange={(e) => setProjectSearchQuery(e.target.value)}
                disabled={disabled}
                className={cn(
                  'w-full px-3 py-1.5 pl-8 text-sm border border-gray-300 rounded',
                  'focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500',
                  disabled && 'opacity-50 cursor-not-allowed bg-gray-100'
                )}
              />
              <svg
                className="absolute left-2.5 top-2 h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>

          {/* Projects list */}
          <div className="max-h-64 overflow-y-auto">
            {filteredProjects.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No projects match your filter
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredProjects.map((project) => {
                  const isChecked = selectedProjectIds.has(project.id)

                  return (
                    <li key={project.id}>
                      <label
                        className={cn(
                          'flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors',
                          'hover:bg-gray-50',
                          isChecked && 'bg-blue-50/50',
                          disabled && 'cursor-not-allowed opacity-50'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleProjectToggle(project.id)}
                          disabled={disabled}
                          className={cn(
                            'w-4 h-4 text-blue-600 rounded border-gray-300',
                            'focus:ring-blue-500 focus:ring-offset-0',
                            disabled && 'cursor-not-allowed'
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              'text-sm truncate',
                              isChecked ? 'text-gray-900 font-medium' : 'text-gray-700'
                            )}
                          >
                            {project.name}
                          </p>
                          {project.short_id && (
                            <p className="text-xs text-gray-500">{project.short_id}</p>
                          )}
                        </div>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Selection summary */}
      {selectedSmartview && !loadingProjects && selectedCount > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-800">
            <strong>{selectedCount}</strong> project{selectedCount !== 1 ? 's' : ''} selected
            from <strong>{selectedSmartview.name}</strong>
          </p>
        </div>
      )}

      {/* Warning if no projects selected */}
      {selectedSmartview && !loadingProjects && selectedCount === 0 && allProjects.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-sm text-yellow-800">
            Please select at least one project to continue.
          </p>
        </div>
      )}

      {/* Continue button */}
      <button
        onClick={onContinue}
        disabled={!selectedSmartview || selectedCount === 0 || disabled || loadingProjects}
        className={cn(
          'w-full py-2 px-4 rounded-lg font-medium transition-colors',
          selectedSmartview && selectedCount > 0 && !disabled && !loadingProjects
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-gray-200 text-gray-500 cursor-not-allowed'
        )}
      >
        Continue with {selectedCount} project{selectedCount !== 1 ? 's' : ''}
      </button>
    </div>
  )
}
