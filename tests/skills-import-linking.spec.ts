import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test('skills import linking', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'x-api-key': API_KEY_HEADER['x-api-key'] })

  const orgResponse = await request.get('/api/org/scan?force=true', {
    headers: API_KEY_HEADER,
  })
  expect(orgResponse.ok()).toBeTruthy()

  const agentsResponse = await request.get('/api/agents', {
    headers: API_KEY_HEADER,
  })
  expect(agentsResponse.ok()).toBeTruthy()

  const { agents = [] } = await agentsResponse.json()
  const agentWithSkills = agents.find(
    (agent: any) =>
      agent.source === 'filesystem' &&
      agent.name === 'Atlas Coordinator' &&
      Array.isArray(agent.skills) &&
      agent.skills.includes('Retrospective'),
  )

  expect(agentWithSkills, 'expected a filesystem-backed agent with imported skills').toBeTruthy()

  await page.goto('/')
  await page.getByText(String(agentWithSkills.name)).click()
  await page.getByRole('tab', { name: /Profile/i }).click()

  const skillChip = page.getByRole('button', { name: 'Retrospective' })
  await expect(skillChip).toBeVisible()
  await skillChip.click()

  await expect(page.getByText('Atlas Coordinator skills')).toBeVisible()
  await expect(page.getByText('org-agent:atlas-coordinator')).toBeVisible()
  await expect(page.getByText(/Atlas retrospective loop/)).toBeVisible()
})
