import { describe, it } from 'vitest'

describe('PUT /api/departments/:id/lead', () => {
  it.todo('returns 401 when not authenticated')
  it.todo('returns 400 when department id is not a number')
  it.todo('sets manager_agent_id on department and returns 200')
  it.todo('returns 404 when department does not exist')
  it.todo('allows unsetting lead by passing agent_id: null')
  it.todo('calls invalidateOrgSnapshot after update')
})
