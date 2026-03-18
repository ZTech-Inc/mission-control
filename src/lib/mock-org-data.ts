import type { Department, Team, AgentTeamAssignment, DocFile } from '@/store/index'

export const MOCK_DEPARTMENTS: Department[] = [
  { id: 1, name: 'Engineering', description: 'Software development and infrastructure', color: '#89b4fa', created_at: 1700000000, updated_at: 1700000000 },
  { id: 2, name: 'Research', description: 'AI/ML research and data science', color: '#cba6f7', created_at: 1700000001, updated_at: 1700000001 },
  { id: 3, name: 'Operations', description: 'DevOps, QA, and reliability', color: '#a6e3a1', created_at: 1700000002, updated_at: 1700000002 },
]

export const MOCK_TEAMS: Team[] = [
  { id: 1, name: 'Frontend Team', description: 'UI/UX and frontend development', department_id: 1, color: '#89b4fa', created_at: 1700000010, updated_at: 1700000010 },
  { id: 2, name: 'Backend Team', description: 'APIs, databases, and server-side', department_id: 1, color: '#74c7ec', created_at: 1700000011, updated_at: 1700000011 },
  { id: 3, name: 'ML Team', description: 'Machine learning and model training', department_id: 2, color: '#cba6f7', created_at: 1700000012, updated_at: 1700000012 },
  { id: 4, name: 'Data Team', description: 'Data pipelines and analytics', department_id: 2, color: '#f5c2e7', created_at: 1700000013, updated_at: 1700000013 },
  { id: 5, name: 'DevOps Team', description: 'Infrastructure and deployment', department_id: 3, color: '#a6e3a1', created_at: 1700000014, updated_at: 1700000014 },
  { id: 6, name: 'QA Team', description: 'Quality assurance and testing', department_id: 3, color: '#94e2d5', created_at: 1700000015, updated_at: 1700000015 },
]

export const MOCK_AGENT_ASSIGNMENTS: AgentTeamAssignment[] = [
  // These reference agent IDs that may or may not exist in the actual DB
  // The UI should gracefully handle missing agents
  { agent_id: 1, team_id: 1, role: 'lead', assigned_at: 1700000100 },
  { agent_id: 2, team_id: 1, role: 'member', assigned_at: 1700000101 },
  { agent_id: 3, team_id: 2, role: 'lead', assigned_at: 1700000102 },
  { agent_id: 4, team_id: 3, role: 'lead', assigned_at: 1700000103 },
  { agent_id: 5, team_id: 4, role: 'member', assigned_at: 1700000104 },
  { agent_id: 6, team_id: 5, role: 'lead', assigned_at: 1700000105 },
]

const deptDocContent = {
  'README.md': `# Department Overview\n\nThis department manages key organizational functions.\n\nSee also: [[processes]] for workflows and [[guidelines]] for standards.\n`,
  'processes.md': `# Processes\n\nStandard operating procedures and workflows.\n\nRelated: [[README]]\n`,
  'guidelines.md': `# Guidelines\n\nCoding standards and best practices.\n\nRelated: [[processes]]\n`,
}

function makeDocs(prefix: string): DocFile[] {
  return [
    { path: `${prefix}/README.md`, name: 'README.md', type: 'file', size: deptDocContent['README.md'].length, modified: 1700000200 },
    { path: `${prefix}/processes.md`, name: 'processes.md', type: 'file', size: deptDocContent['processes.md'].length, modified: 1700000201 },
    { path: `${prefix}/guidelines.md`, name: 'guidelines.md', type: 'file', size: deptDocContent['guidelines.md'].length, modified: 1700000202 },
  ]
}

export const MOCK_DEPARTMENT_DOCS: Record<number, DocFile[]> = {
  1: makeDocs('dept/engineering'),
  2: makeDocs('dept/research'),
  3: makeDocs('dept/operations'),
}

export const MOCK_TEAM_DOCS: Record<number, DocFile[]> = {
  1: makeDocs('team/frontend'),
  2: makeDocs('team/backend'),
  3: makeDocs('team/ml'),
  4: makeDocs('team/data'),
  5: makeDocs('team/devops'),
  6: makeDocs('team/qa'),
}

export const MOCK_DOC_CONTENT: Record<string, string> = {
  'README.md': deptDocContent['README.md'],
  'processes.md': deptDocContent['processes.md'],
  'guidelines.md': deptDocContent['guidelines.md'],
}
