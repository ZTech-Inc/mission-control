import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillsPanel } from '@/components/panels/skills-panel'

const { useMissionControlMock } = vi.hoisted(() => ({
  useMissionControlMock: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/store', () => ({
  useMissionControl: useMissionControlMock,
}))

function buildStore(source: string) {
  return {
    dashboardMode: 'full',
    skillsList: [
      {
        id: `${source}:Retrospective`,
        name: 'Retrospective',
        source,
        path: `/tmp/${source}/Retrospective`,
        description: 'Skill description',
      },
    ],
    skillGroups: [
      {
        source,
        path: `/tmp/${source}`,
        skills: [
          {
            id: `${source}:Retrospective`,
            name: 'Retrospective',
            source,
            path: `/tmp/${source}/Retrospective`,
            description: 'Skill description',
          },
        ],
      },
    ],
    skillsTotal: 1,
    setSkillsData: vi.fn(),
  }
}

describe('SkillsPanel org-agent behavior', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        source: 'org-agent:atlas-coordinator',
        name: 'Retrospective',
        skillPath: '/tmp/org-agent:atlas-coordinator/Retrospective',
        skillDocPath: '/tmp/org-agent:atlas-coordinator/Retrospective/SKILL.md',
        content: '# Retrospective\n\nSkill description\n',
        security: { status: 'clean', issues: [] },
      }),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows org-agent sources with readable labels and keeps the drawer read-only', async () => {
    useMissionControlMock.mockReturnValue(buildStore('org-agent:atlas-coordinator'))

    render(<SkillsPanel />)

    expect(screen.getAllByText('Atlas Coordinator skills')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'view' }))

    expect(await screen.findByText('Imported org-agent skills are read-only in the catalog.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'delete' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('new-skill-name')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'addSkill' })).toBeDisabled()
  })

  it('keeps editable sources writable', async () => {
    useMissionControlMock.mockReturnValue(buildStore('user-agents'))

    render(<SkillsPanel />)

    await waitFor(() => {
      expect(screen.getAllByText('~/.agents/skills (global)').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'view' }))

    expect(await screen.findByRole('button', { name: 'save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'delete' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('new-skill-name')).not.toBeDisabled()
    expect(screen.getByPlaceholderText('initialContent')).not.toBeDisabled()
    expect(screen.queryByText('Imported org-agent skills are read-only in the catalog.')).not.toBeInTheDocument()
  })
})
