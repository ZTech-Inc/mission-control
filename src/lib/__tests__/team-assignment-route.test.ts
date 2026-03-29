import { describe, it } from 'vitest'

describe('PATCH /api/teams/:id/assignments', () => {
  it.todo('returns 401 when not authenticated')
  it.todo('returns 400 when team id is not a number')
  it.todo('returns 422 when agent is not a member of the team (per D-17)')
  it.todo('promotes agent to lead and returns 200')
  it.todo('demotes existing lead when promoting a new agent (per D-14)')
  it.todo('sets source to manual on promoted assignment')
  it.todo('allows demoting a lead back to member')
})
