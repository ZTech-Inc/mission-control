import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DEPARTMENT_METADATA_FILE = '.department.json'
const TEAM_METADATA_FILE = '.team.json'

interface DepartmentMetadata {
  manager_agent_dir?: string
}

interface TeamMetadata {
  lead_agent_dir?: string
}

function isSafeRelativeDir(value: string | undefined): value is string {
  if (!value) return false
  if (path.isAbsolute(value)) return false

  const normalized = path.normalize(value).replace(/\\/g, '/')
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    return false
  }

  return true
}

function readMetadataFile<T extends object>(filePath: string): T {
  try {
    const raw = readFileSync(filePath, 'utf8').trim()
    if (!raw) return {} as T
    const parsed = JSON.parse(raw) as T
    return parsed && typeof parsed === 'object' ? parsed : ({} as T)
  } catch {
    return {} as T
  }
}

function writeMetadataFile(filePath: string, value: object): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function getDepartmentMetadataPath(departmentPath: string): string {
  return path.join(departmentPath, DEPARTMENT_METADATA_FILE)
}

export function getTeamMetadataPath(teamPath: string): string {
  return path.join(teamPath, TEAM_METADATA_FILE)
}

export function readDepartmentMetadata(departmentPath: string): DepartmentMetadata {
  const metadata = readMetadataFile<DepartmentMetadata>(getDepartmentMetadataPath(departmentPath))
  return isSafeRelativeDir(metadata.manager_agent_dir)
    ? { manager_agent_dir: metadata.manager_agent_dir }
    : {}
}

export function readTeamMetadata(teamPath: string): TeamMetadata {
  const metadata = readMetadataFile<TeamMetadata>(getTeamMetadataPath(teamPath))
  return isSafeRelativeDir(metadata.lead_agent_dir)
    ? { lead_agent_dir: metadata.lead_agent_dir }
    : {}
}

export function writeDepartmentMetadata(
  departmentPath: string,
  metadata: DepartmentMetadata
): void {
  const next: DepartmentMetadata = {}
  if (isSafeRelativeDir(metadata.manager_agent_dir)) {
    next.manager_agent_dir = metadata.manager_agent_dir
  }
  writeMetadataFile(getDepartmentMetadataPath(departmentPath), next)
}

export function writeTeamMetadata(teamPath: string, metadata: TeamMetadata): void {
  const next: TeamMetadata = {}
  if (isSafeRelativeDir(metadata.lead_agent_dir)) {
    next.lead_agent_dir = metadata.lead_agent_dir
  }
  writeMetadataFile(getTeamMetadataPath(teamPath), next)
}
