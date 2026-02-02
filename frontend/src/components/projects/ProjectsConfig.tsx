/**
 * @deprecated This component is no longer used in the main flow.
 * Replaced by SmartviewSelector.tsx which fetches projects from AirSaas smartviews.
 *
 * Old flow: User pastes JSON with workspace + projects array
 * New flow: User selects a smartview from AirSaas, projects are fetched automatically
 *
 * This file is kept for reference only. Can be safely deleted after 2025-03-01.
 *
 * @see SmartviewSelector.tsx for the new implementation
 */

import { useState, useCallback, useEffect } from 'react'
import { cn } from '@lib/utils'
import { AIRSAAS_PROJECTS } from '@config/constants'
import type { ProjectsConfig as ProjectsConfigType } from '@appTypes/index'

interface ProjectsConfigProps {
  config: ProjectsConfigType | null
  onSave: (config: ProjectsConfigType) => void
  onContinue: () => void
  disabled?: boolean
}

// Default config based on constants
const DEFAULT_CONFIG: ProjectsConfigType = {
  workspace: AIRSAAS_PROJECTS.workspace,
  projects: AIRSAAS_PROJECTS.projects.map(p => ({
    id: p.id,
    name: p.name,
    short_id: 'short_id' in p ? p.short_id : undefined,
  })),
}

export function ProjectsConfig({ config, onSave, onContinue, disabled = false }: ProjectsConfigProps) {
  const [jsonInput, setJsonInput] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [isValid, setIsValid] = useState(false)

  // Initialize textarea with existing config or default
  useEffect(() => {
    if (config) {
      setJsonInput(JSON.stringify(config, null, 2))
      setIsValid(true)
    } else {
      setJsonInput(JSON.stringify(DEFAULT_CONFIG, null, 2))
      // Auto-save the default config
      onSave(DEFAULT_CONFIG)
      setIsValid(true)
    }
  }, []) // Only run on mount

  const handleJsonChange = useCallback((value: string) => {
    setJsonInput(value)
    setParseError(null)
    setIsValid(false)

    try {
      const parsed = JSON.parse(value)

      // Validate structure
      if (!parsed.workspace || typeof parsed.workspace !== 'string') {
        setParseError('Missing or invalid "workspace" field (string required)')
        return
      }

      if (!Array.isArray(parsed.projects)) {
        setParseError('Missing or invalid "projects" field (array required)')
        return
      }

      if (parsed.projects.length === 0) {
        setParseError('Projects array cannot be empty')
        return
      }

      // Validate each project
      for (let i = 0; i < parsed.projects.length; i++) {
        const project = parsed.projects[i]
        if (!project.id || typeof project.id !== 'string') {
          setParseError(`Project ${i + 1}: Missing or invalid "id" field`)
          return
        }
        if (!project.name || typeof project.name !== 'string') {
          setParseError(`Project ${i + 1}: Missing or invalid "name" field`)
          return
        }
      }

      // Valid!
      setIsValid(true)
      onSave(parsed)
    } catch {
      setParseError('Invalid JSON format')
    }
  }, [onSave])

  const handleLoadDefault = useCallback(() => {
    const defaultJson = JSON.stringify(DEFAULT_CONFIG, null, 2)
    setJsonInput(defaultJson)
    setParseError(null)
    setIsValid(true)
    onSave(DEFAULT_CONFIG)
  }, [onSave])

  const projectCount = config?.projects?.length || 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Configure Projects</h2>
        <p className="text-sm text-gray-600 mt-1">
          Load the AirSaas projects configuration. The report will be generated for <strong>all projects</strong> in this list.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">
            Projects JSON Configuration
          </label>
          <button
            onClick={handleLoadDefault}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            Load default projects
          </button>
        </div>

        <textarea
          value={jsonInput}
          onChange={(e) => handleJsonChange(e.target.value)}
          disabled={disabled}
          placeholder={`{
  "workspace": "your-workspace",
  "projects": [
    { "id": "uuid-1", "name": "Project 1", "short_id": "P1" },
    { "id": "uuid-2", "name": "Project 2" }
  ]
}`}
          className={cn(
            'w-full h-80 p-3 text-sm font-mono border rounded-lg focus:outline-none focus:ring-2',
            parseError
              ? 'border-red-300 focus:ring-red-500'
              : isValid
                ? 'border-green-300 focus:ring-green-500'
                : 'border-gray-300 focus:ring-blue-500',
            disabled && 'opacity-50 cursor-not-allowed bg-gray-50'
          )}
        />

        {parseError && (
          <p className="text-sm text-red-600">{parseError}</p>
        )}
      </div>

      {isValid && config && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800 font-medium">
            Configuration valid
          </p>
          <p className="text-sm text-green-700 mt-1">
            Workspace: <code className="bg-green-100 px-1 rounded">{config.workspace}</code>
          </p>
          <p className="text-sm text-green-700">
            Projects: <strong>{projectCount}</strong> project{projectCount !== 1 ? 's' : ''} configured
          </p>
          <div className="mt-2 max-h-32 overflow-y-auto">
            <ul className="text-xs text-green-600 space-y-0.5">
              {config.projects.slice(0, 10).map((p, i) => (
                <li key={p.id}>
                  {i + 1}. {p.name} {p.short_id && <span className="text-green-500">({p.short_id})</span>}
                </li>
              ))}
              {config.projects.length > 10 && (
                <li className="text-green-500 italic">... and {config.projects.length - 10} more</li>
              )}
            </ul>
          </div>
        </div>
      )}

      <button
        onClick={onContinue}
        disabled={!isValid || disabled}
        className={cn(
          'w-full py-2 px-4 rounded-lg font-medium transition-colors',
          isValid && !disabled
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-gray-200 text-gray-500 cursor-not-allowed'
        )}
      >
        Continue with {projectCount} project{projectCount !== 1 ? 's' : ''}
      </button>
    </div>
  )
}
