import { describe, it } from 'vitest'

describe('org-scanner source priority', () => {
  it.todo('filesystem upsert does not overwrite role when source is manual')
  it.todo('filesystem upsert does not overwrite source when existing source is manual')
  it.todo('filesystem upsert does update role when source is filesystem')
})

describe('getOrgSnapshot manager_agent_id propagation', () => {
  it.todo('departments in snapshot include manager_agent_id from database')
  it.todo('departments without manager_agent_id in DB have no manager_agent_id in snapshot')
})
