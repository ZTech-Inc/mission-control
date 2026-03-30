import { describe, test } from 'vitest'

describe('POST /api/teams', () => {
  test.todo('creates filesystem directory at ZTech_Agents/<dept>/<team>/')
  test.todo('inserts team record in DB with source=manual')
  test.todo('uses stableNumber(path) for external_id')
  test.todo('calls invalidateOrgSnapshot after write')
  test.todo('returns 400 when agentsDir is not configured')
  test.todo('returns 400 when name is empty')
})
