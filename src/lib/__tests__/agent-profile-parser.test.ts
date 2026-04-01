import { describe, it, expect } from 'vitest'
import { parseAgentProfile, type ParsedAgentProfile } from '@/lib/agent-profile-parser'

// Test fixtures
const agentMdWithProtocol = `# Agent
Protocol Stack:
- MCP
- REST
`

const agentMdWithDeliverables = `# Agent
Deliverables:
- Weekly report
- Code review
`

const identityMdWithDeliverables = `# Identity
Deliverables:
- Monthly summary
- Code review
`

const agentMdWithDeps = `# Agent
Dependencies:
- AgentX
- AgentY
`

const agentMdWithRuntime = `# Agent
Preferred Runtime: claude-code
`

const agentMdWithIdentityRuntime = `# Agent
Runtime: codex
`

const agentMdFull = `# Agent
Name: Test Agent
Role: Senior Engineer
Skills:
- TypeScript
- React
KPIs:
- Code quality
- Velocity
Department: Engineering
Team: Frontend
Protocol Stack:
- MCP
- A2A
Deliverables:
- Pull requests
- Code reviews
Dependencies:
- DesignAgent
- BackendAgent
Preferred Runtime: claude-code
`

const identityMdFull = `# Identity
Skills:
- Node.js
Deliverables:
- Documentation
Dependencies:
- DatabaseAgent
`

describe('parseAgentProfile', () => {
  describe('openclaw_id derivation', () => {
    it('converts spaces to hyphens (kebab-case)', () => {
      const result = parseAgentProfile('My Cool Agent', '', '')
      expect(result.openclaw_id).toBe('my-cool-agent')
    })

    it('preserves dots and hyphens', () => {
      const result = parseAgentProfile('agent.v2', '', '')
      expect(result.openclaw_id).toBe('agent.v2')
    })

    it('lowercases the name', () => {
      const result = parseAgentProfile('AgentName', '', '')
      expect(result.openclaw_id).toBe('agentname')
    })

    it('replaces special chars (except dots/hyphens/underscores) with hyphens', () => {
      const result = parseAgentProfile('Agent Name!123', '', '')
      expect(result.openclaw_id).toBe('agent-name-123')
    })

    it('uses parsed name from AGENT.md for openclaw_id if available', () => {
      const result = parseAgentProfile('SomeDirName', '# Agent\nName: My Cool Agent\n', '')
      expect(result.openclaw_id).toBe('my-cool-agent')
    })
  })

  describe('protocol_stack parsing', () => {
    it('extracts protocol_stack from AGENT.md', () => {
      const result = parseAgentProfile('MyAgent', agentMdWithProtocol, '')
      expect(result.protocol_stack).toEqual(['MCP', 'REST'])
    })

    it('returns empty array when no protocol_stack present', () => {
      const result = parseAgentProfile('AgentName', '', '')
      expect(result.protocol_stack).toEqual([])
    })

    it('deduplicates protocol_stack from both sources', () => {
      const identityMd = `# Identity\nProtocol Stack:\n- MCP\n- A2A\n`
      const result = parseAgentProfile('MyAgent', agentMdWithProtocol, identityMd)
      expect(result.protocol_stack).toContain('MCP')
      expect(result.protocol_stack).toContain('REST')
      expect(result.protocol_stack).toContain('A2A')
      // MCP should appear only once (deduplicated)
      expect(result.protocol_stack.filter((p) => p === 'MCP')).toHaveLength(1)
    })
  })

  describe('deliverables parsing', () => {
    it('extracts deliverables from AGENT.md', () => {
      const result = parseAgentProfile('MyAgent', agentMdWithDeliverables, '')
      expect(result.deliverables).toContain('Weekly report')
      expect(result.deliverables).toContain('Code review')
    })

    it('merges and deduplicates deliverables from both sources', () => {
      const result = parseAgentProfile('MyAgent', agentMdWithDeliverables, identityMdWithDeliverables)
      expect(result.deliverables).toContain('Weekly report')
      expect(result.deliverables).toContain('Monthly summary')
      // "Code review" appears in both — should appear only once
      expect(result.deliverables.filter((d) => d === 'Code review')).toHaveLength(1)
    })

    it('returns empty array for deliverables when not present', () => {
      const result = parseAgentProfile('AgentName', '', '')
      expect(result.deliverables).toEqual([])
    })
  })

  describe('dependencies parsing', () => {
    it('extracts dependencies from AGENT.md', () => {
      const result = parseAgentProfile('MyAgent', agentMdWithDeps, '')
      expect(result.dependencies).toContain('AgentX')
      expect(result.dependencies).toContain('AgentY')
    })

    it('returns empty array for dependencies when not present', () => {
      const result = parseAgentProfile('AgentName', '', '')
      expect(result.dependencies).toEqual([])
    })

    it('merges dependencies from both sources and deduplicates', () => {
      const identityMd = `# Identity\nDependencies:\n- AgentZ\n- AgentX\n`
      const result = parseAgentProfile('MyAgent', agentMdWithDeps, identityMd)
      expect(result.dependencies).toContain('AgentX')
      expect(result.dependencies).toContain('AgentY')
      expect(result.dependencies).toContain('AgentZ')
      expect(result.dependencies.filter((d) => d === 'AgentX')).toHaveLength(1)
    })
  })

  describe('preferred_runtime parsing', () => {
    it('extracts preferred_runtime from AGENT.md', () => {
      const result = parseAgentProfile('MyAgent', agentMdWithRuntime, '')
      expect(result.preferred_runtime).toBe('claude-code')
    })

    it('falls back to identityMd for preferred_runtime', () => {
      const identityMd = `# Identity\nPreferred Runtime: codex\n`
      const result = parseAgentProfile('MyAgent', '', identityMd)
      expect(result.preferred_runtime).toBe('codex')
    })

    it('returns undefined when preferred_runtime not present', () => {
      const result = parseAgentProfile('AgentName', '', '')
      expect(result.preferred_runtime).toBeUndefined()
    })

    it('also matches "Runtime" key alias', () => {
      const result = parseAgentProfile('MyAgent', agentMdWithIdentityRuntime, '')
      expect(result.preferred_runtime).toBe('codex')
    })
  })

  describe('empty content handling', () => {
    it('returns empty arrays for list fields when content is empty', () => {
      const result = parseAgentProfile('AgentName', '', '')
      expect(result.protocol_stack).toEqual([])
      expect(result.deliverables).toEqual([])
      expect(result.dependencies).toEqual([])
      expect(result.skills).toEqual([])
      expect(result.kpis).toEqual([])
      expect(result.preferred_runtime).toBeUndefined()
    })

    it('uses dir name as openclaw_id fallback when no name in content', () => {
      const result = parseAgentProfile('my-agent', '', '')
      expect(result.openclaw_id).toBe('my-agent')
    })
  })

  describe('full profile parsing', () => {
    it('parses all fields from full AGENT.md', () => {
      const result = parseAgentProfile('TestAgent', agentMdFull, '')
      expect(result.name).toBe('Test Agent')
      expect(result.role).toBe('Senior Engineer')
      expect(result.skills).toContain('TypeScript')
      expect(result.skills).toContain('React')
      expect(result.kpis).toContain('Code quality')
      expect(result.protocol_stack).toContain('MCP')
      expect(result.protocol_stack).toContain('A2A')
      expect(result.deliverables).toContain('Pull requests')
      expect(result.dependencies).toContain('DesignAgent')
      expect(result.preferred_runtime).toBe('claude-code')
      expect(result.openclaw_id).toBe('test-agent')
    })

    it('merges fields from both agentMd and identityMd', () => {
      const result = parseAgentProfile('TestAgent', agentMdFull, identityMdFull)
      expect(result.skills).toContain('TypeScript')
      expect(result.skills).toContain('Node.js')
      expect(result.deliverables).toContain('Pull requests')
      expect(result.deliverables).toContain('Documentation')
      expect(result.dependencies).toContain('DesignAgent')
      expect(result.dependencies).toContain('DatabaseAgent')
    })

    it('result conforms to ParsedAgentProfile type', () => {
      const result: ParsedAgentProfile = parseAgentProfile('TestAgent', agentMdFull, '')
      expect(typeof result.openclaw_id).toBe('string')
      expect(Array.isArray(result.protocol_stack)).toBe(true)
      expect(Array.isArray(result.deliverables)).toBe(true)
      expect(Array.isArray(result.dependencies)).toBe(true)
    })
  })
})
