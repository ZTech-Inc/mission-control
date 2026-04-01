import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test('skills import linking', async ({ page, request }) => {
  const syncResponse = await request.post('/api/agents/sync?source=local', {
    headers: API_KEY_HEADER,
  })
  expect(syncResponse.ok()).toBeTruthy()

  const agentsResponse = await request.get('/api/agents', {
    headers: API_KEY_HEADER,
  })
  expect(agentsResponse.ok()).toBeTruthy()

  const { agents = [] } = await agentsResponse.json()
  const agentWithSkills = agents.find((agent: any) => Array.isArray(agent.skills) && agent.skills.length > 0)

  expect(agentWithSkills, 'expected a filesystem-backed agent with imported skills').toBeTruthy()

  await page.goto('/')
  await page.getByText(String(agentWithSkills.name)).click()
  await page.getByRole('tab', { name: /Profile/i }).click()

  const skillChip = page.getByRole('button', { name: String(agentWithSkills.skills[0]) })
  await expect(skillChip).toBeVisible()
  await skillChip.click()

  await expect(page.getByText(new RegExp(`org-agent:${String(agentWithSkills.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`))).toBeVisible()
  await expect(page.getByText(/SKILL\.md|#/)).toBeVisible()
})
