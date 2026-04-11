function slugifyAgentName(agentName: string): string {
  return agentName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildOrgAgentSkillSource(agentName: string): string {
  const slug = slugifyAgentName(agentName) || 'unknown-agent'
  return `org-agent:${slug}`
}
