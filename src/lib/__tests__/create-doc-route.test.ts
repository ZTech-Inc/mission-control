import { describe, test } from 'vitest'

describe('POST /api/teams/:id/docs', () => {
  test.todo('creates .md file in ZTech_Agents/<dept>/<team>/docs/')
  test.todo('returns 400 when agentsDir is not configured')
  test.todo('auto-appends .md extension when missing')
})

describe('POST /api/departments/:id/docs', () => {
  test.todo('creates .md file in ZTech_Agents/<dept>/docs/')
  test.todo('returns 400 when agentsDir is not configured')
})

describe('GET /api/teams/:id/docs', () => {
  test.todo('returns real filesystem docs as DocFile tree')
  test.todo('returns empty array when docs dir does not exist')
})
