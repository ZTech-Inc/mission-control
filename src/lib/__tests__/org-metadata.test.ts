import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  readDepartmentMetadata,
  readTeamMetadata,
  writeDepartmentMetadata,
  writeTeamMetadata,
} from '@/lib/org-metadata'

describe('org metadata helpers', () => {
  it('round-trips filesystem leadership metadata', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mc-org-metadata-'))
    const departmentPath = path.join(root, 'Engineering')
    const teamPath = path.join(departmentPath, 'Platform')

    try {
      writeDepartmentMetadata(departmentPath, { manager_agent_dir: 'MANAGER/ada' })
      writeTeamMetadata(teamPath, { lead_agent_dir: 'grace-hopper' })

      expect(readDepartmentMetadata(departmentPath)).toEqual({
        manager_agent_dir: 'MANAGER/ada',
      })
      expect(readTeamMetadata(teamPath)).toEqual({
        lead_agent_dir: 'grace-hopper',
      })

      const rawDepartmentMetadata = JSON.parse(
        readFileSync(path.join(departmentPath, '.department.json'), 'utf8')
      ) as Record<string, string>
      const rawTeamMetadata = JSON.parse(
        readFileSync(path.join(teamPath, '.team.json'), 'utf8')
      ) as Record<string, string>

      expect(rawDepartmentMetadata.manager_agent_dir).toBe('MANAGER/ada')
      expect(rawTeamMetadata.lead_agent_dir).toBe('grace-hopper')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('drops unsafe relative paths instead of persisting them', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mc-org-metadata-'))
    const departmentPath = path.join(root, 'Operations')
    const teamPath = path.join(departmentPath, 'SRE')

    try {
      writeDepartmentMetadata(departmentPath, { manager_agent_dir: '../outside' })
      writeTeamMetadata(teamPath, { lead_agent_dir: '/absolute/path' })

      expect(readDepartmentMetadata(departmentPath)).toEqual({})
      expect(readTeamMetadata(teamPath)).toEqual({})
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
