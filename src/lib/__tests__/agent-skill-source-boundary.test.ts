import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('agent skill source module boundaries', () => {
  it('keeps client panels on the extracted shared helper instead of the server importer', () => {
    const panelPath = resolve(process.cwd(), 'src/components/panels/agent-detail-tabs.tsx')
    const importerPath = resolve(process.cwd(), 'src/lib/agent-skills-importer.ts')

    const panelSource = readFileSync(panelPath, 'utf8')
    const importerSource = readFileSync(importerPath, 'utf8')

    expect(panelSource).toContain("from '@/lib/agent-skill-source'")
    expect(panelSource).not.toContain("from '@/lib/agent-skills-importer'")
    expect(importerSource).toContain("from '@/lib/agent-skill-source'")
  })
})
