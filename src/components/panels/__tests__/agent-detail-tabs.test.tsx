import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileTab } from '@/components/panels/agent-detail-tabs'
import type { Agent } from '@/store'

const baseAgent: Agent = {
  id: 42,
  name: 'Atlas Coordinator',
  role: 'Coordinator',
  status: 'idle',
  created_at: Date.now(),
  updated_at: Date.now(),
  content_hash: 'scan-hash',
  skills: ['Retrospective', 'PromptPlanning', 'Research', 'DeepWork'],
}

const skillsPayload = {
  skills: [
    {
      id: 'org-agent:atlas-coordinator:Retrospective',
      name: 'Retrospective',
      source: 'org-agent:atlas-coordinator',
      path: '/tmp/atlas/skills/Retrospective',
      description: 'Atlas retrospective loop',
    },
    {
      id: 'project-codex:PromptPlanning',
      name: 'PromptPlanning',
      source: 'project-codex',
      path: '/tmp/project/PromptPlanning',
      description: 'Global prompt planning',
    },
    {
      id: 'user-agents:Research',
      name: 'Research',
      source: 'user-agents',
      path: '/tmp/global-a/Research',
      description: 'First Research variant',
    },
    {
      id: 'project-agents:Research',
      name: 'Research',
      source: 'project-agents',
      path: '/tmp/global-b/Research',
      description: 'Second Research variant',
    },
  ],
  groups: [],
  total: 4,
}

const contentPayload = {
  source: 'org-agent:atlas-coordinator',
  name: 'Retrospective',
  skillPath: '/tmp/atlas/skills/Retrospective',
  skillDocPath: '/tmp/atlas/skills/Retrospective/SKILL.md',
  content: '# Retrospective\n\nAtlas retrospective loop\n',
  security: { status: 'clean', issues: [] },
}

describe('ProfileTab skill linking', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.startsWith('/api/skills?mode=content')) {
          return {
            ok: true,
            json: async () => contentPayload,
          }
        }

        return {
          ok: true,
          json: async () => skillsPayload,
        }
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('links same-agent matches first, falls back to one global match, and leaves ambiguous chips inert', async () => {
    render(<ProfileTab agent={baseAgent} />)

    const retrospective = await screen.findByRole('button', { name: 'Retrospective' })
    expect(retrospective).toBeInTheDocument()

    const promptPlanning = await screen.findByRole('button', { name: 'PromptPlanning' })
    expect(promptPlanning).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Research' })).not.toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'DeepWork' })).not.toBeInTheDocument()
    expect(screen.getByText('DeepWork')).toBeInTheDocument()
  })

  it('opens the shared viewer when a linked chip is clicked', async () => {
    render(<ProfileTab agent={baseAgent} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Retrospective' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/skills?mode=content&source=org-agent%3Aatlas-coordinator&name=Retrospective'),
        expect.anything(),
      )
    })

    expect(await screen.findByText('Atlas Coordinator skills')).toBeInTheDocument()
    expect(screen.getByText('Atlas retrospective loop')).toBeInTheDocument()
  })
})
