import { describe, test } from 'vitest'

describe('POST /api/agents/create', () => {
  test.todo('creates agent directory with IDENTITY.md, AGENT.md, SOUL.md')
  test.todo('inserts agent record in DB with source=manual')
  test.todo('inserts agent_team_assignments for non-manager agents')
  test.todo('creates MANAGER/ directory and updates department for is_manager=true')
  test.todo('returns 400 when agentsDir is not configured')
  test.todo('returns 400 when name is empty')
})
