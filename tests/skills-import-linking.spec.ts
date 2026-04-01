import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

function buildOrgAgentSkillSource(agentName: string): string {
  const slug = agentName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `org-agent:${slug || 'unknown-agent'}`
}

function pickExpectedSnippet(content: string): string {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  return lines[0] || content.trim()
}

test('skills import linking', async ({ page, request }) => {
  test.setTimeout(120_000)

  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3005'
  const username = `skills-linking-${Date.now()}`
  const password = 'testpass1234!'

  await page.setExtraHTTPHeaders({ 'x-api-key': API_KEY_HEADER['x-api-key'] })

  const createUserResponse = await request.post('/api/auth/users', {
    headers: API_KEY_HEADER,
    data: {
      username,
      password,
      display_name: 'Skills Linking E2E',
      role: 'admin',
    },
  })
  expect([201, 409]).toContain(createUserResponse.status())

  const loginResponse = await request.post('/api/auth/login', {
    data: { username, password },
    headers: { 'x-forwarded-for': '10.88.88.3' },
  })
  expect(loginResponse.ok()).toBeTruthy()

  const setCookie = loginResponse.headers()['set-cookie'] || ''
  const sessionMatch = setCookie.match(/(?:__Host-)?mc-session=([^;]+)/)
  expect(sessionMatch).toBeTruthy()

  await page.context().addCookies([
    {
      name: setCookie.includes('__Host-mc-session=') ? '__Host-mc-session' : 'mc-session',
      value: sessionMatch?.[1] || '',
      domain: new URL(baseUrl).hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])

  const orgResponse = await request.get('/api/org/scan?force=true', {
    headers: API_KEY_HEADER,
  })
  expect(orgResponse.ok()).toBeTruthy()

  const agentsResponse = await request.get('/api/agents', {
    headers: API_KEY_HEADER,
  })
  expect(agentsResponse.ok()).toBeTruthy()

  const skillsResponse = await request.get('/api/skills', {
    headers: API_KEY_HEADER,
  })
  expect(skillsResponse.ok()).toBeTruthy()

  const { agents = [] } = await agentsResponse.json()
  const { skills = [] } = await skillsResponse.json()

  const agentWithSkills = agents.find((agent: any) => {
    if (agent.source !== 'filesystem' || !Array.isArray(agent.skills) || agent.skills.length === 0) {
      return false
    }

    const agentSource = buildOrgAgentSkillSource(agent.name)
    return agent.skills.some((skillName: string) =>
      skills.some((skill: any) => skill.source === agentSource && skill.name === skillName),
    )
  })

  expect(agentWithSkills, 'expected a filesystem-backed agent with imported skills').toBeTruthy()

  const selectedSkill = agentWithSkills.skills.find((skillName: string) =>
    skills.some((skill: any) => skill.source === buildOrgAgentSkillSource(agentWithSkills.name) && skill.name === skillName),
  )
  expect(selectedSkill, 'expected at least one profile skill to link to an imported org-agent skill').toBeTruthy()

  const selectedSkillName = String(selectedSkill)
  const selectedSource = buildOrgAgentSkillSource(agentWithSkills.name)
  const contentResponse = await request.get(
    `/api/skills?mode=content&source=${encodeURIComponent(selectedSource)}&name=${encodeURIComponent(selectedSkillName)}`,
    { headers: API_KEY_HEADER },
  )
  expect(contentResponse.ok()).toBeTruthy()

  const skillContent = await contentResponse.json()
  const expectedSnippet = pickExpectedSnippet(skillContent.content)

  await page.goto('/agents')
  await expect(page).not.toHaveURL(/\/login/)
  const searchInput = page.getByPlaceholder('Search agents...')
  await expect(searchInput).toBeVisible({ timeout: 60_000 })
  await searchInput.fill(String(agentWithSkills.name))
  await expect(page.getByText(String(agentWithSkills.name)).first()).toBeVisible()
  await page.getByText(String(agentWithSkills.name)).first().click()
  await page.getByRole('button', { name: 'Profile' }).click()

  const skillChip = page.getByRole('button', { name: selectedSkillName })
  await expect(skillChip).toBeVisible()
  await skillChip.click()

  await expect(page.getByText(selectedSource)).toBeVisible()
  await expect(page.getByText(expectedSnippet)).toBeVisible()
})
