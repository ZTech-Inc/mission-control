import path from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import type { DocFile } from '@/store'
import { validateBody } from '@/lib/validation'

const createDocSchema = z.object({
  filename: z.string().min(1).max(200),
  content: z.string().optional().default(''),
})

function sanitizeFilename(filename: string): string {
  const stripped = filename.trim().replace(/[/\\]+/g, '')
  const safe = stripped.endsWith('.md') ? stripped : `${stripped}.md`
  return safe
}

function scanDocs(dir: string, basePath = ''): DocFile[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries
    .map((entry) => {
      const entryPath = path.join(basePath, entry.name)
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: entryPath,
          type: 'directory' as const,
          children: scanDocs(path.join(dir, entry.name), entryPath),
        }
      }

      return {
        name: entry.name,
        path: entryPath,
        type: 'file' as const,
        size: statSync(path.join(dir, entry.name)).size,
      }
    })
    .sort(
      (a, b) =>
        (a.type === 'directory' ? -1 : 1) - (b.type === 'directory' ? -1 : 1) ||
        a.name.localeCompare(b.name)
    )
}

function collectContent(dir: string, basePath = '', acc: Record<string, string> = {}) {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.join(basePath, entry.name)

    if (entry.isDirectory()) {
      collectContent(fullPath, relativePath, acc)
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      acc[relativePath] = readFileSync(fullPath, 'utf-8')
      acc[entry.name] = acc[relativePath]
    }
  }

  return acc
}

function getDepartmentDocContext(
  db: ReturnType<typeof getDatabase>,
  workspaceId: number,
  departmentExternalId: number
) {
  const row = db
    .prepare(
      `SELECT name
       FROM departments
       WHERE workspace_id = ? AND external_id = ?`
    )
    .get(workspaceId, departmentExternalId) as { name: string } | undefined

  if (!row) return null
  return {
    docsDir: path.join(config.agentsDir, row.name, 'docs'),
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!config.agentsDir) {
    return NextResponse.json({ error: 'Agents directory not configured' }, { status: 400 })
  }

  const { id } = await params
  const departmentExternalId = Number.parseInt(id, 10)
  if (Number.isNaN(departmentExternalId)) {
    return NextResponse.json({ error: 'Invalid department id' }, { status: 400 })
  }

  const workspaceId = auth.user.workspace_id ?? 1
  const db = getDatabase()
  const departmentDocContext = getDepartmentDocContext(db, workspaceId, departmentExternalId)
  if (!departmentDocContext) {
    return NextResponse.json({ error: 'Department not found' }, { status: 404 })
  }

  if (!existsSync(departmentDocContext.docsDir)) {
    return NextResponse.json({ docs: [], content: {} })
  }

  return NextResponse.json({
    docs: scanDocs(departmentDocContext.docsDir),
    content: collectContent(departmentDocContext.docsDir),
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (!config.agentsDir) {
    return NextResponse.json({ error: 'Agents directory not configured' }, { status: 400 })
  }

  const { id } = await params
  const departmentExternalId = Number.parseInt(id, 10)
  if (Number.isNaN(departmentExternalId)) {
    return NextResponse.json({ error: 'Invalid department id' }, { status: 400 })
  }

  const validated = await validateBody(request, createDocSchema)
  if ('error' in validated) return validated.error

  const workspaceId = auth.user.workspace_id ?? 1
  const db = getDatabase()
  const departmentDocContext = getDepartmentDocContext(db, workspaceId, departmentExternalId)
  if (!departmentDocContext) {
    return NextResponse.json({ error: 'Department not found' }, { status: 404 })
  }

  const filename = sanitizeFilename(validated.data.filename)
  if (!filename || filename === '.md') {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  mkdirSync(departmentDocContext.docsDir, { recursive: true })
  writeFileSync(path.join(departmentDocContext.docsDir, filename), validated.data.content, 'utf-8')

  return NextResponse.json({ ok: true, path: filename }, { status: 201 })
}
