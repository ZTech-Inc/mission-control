'use client'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  GraphCanvas,
  type GraphCanvasRef,
  type Theme,
  type GraphNode as ReagraphNode,
  type GraphEdge as ReagraphEdge,
} from 'reagraph'
import type { DocFile } from '@/store'

interface OrgDocsPanelProps {
  entityType: 'department' | 'team'
  entityId: number
}

interface DocsResponse {
  docs?: DocFile[]
  content?: Record<string, string>
}

function getFileColor(filePath: string): string {
  if (filePath.endsWith('.md')) return '#f9e2af'
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonl')) return '#cba6f7'
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return '#89b4fa'
  return '#94e2d5'
}

const obsidianTheme: Theme = {
  canvas: { background: '#11111b', fog: '#11111b' },
  node: {
    fill: '#6c7086', activeFill: '#cba6f7', opacity: 1, selectedOpacity: 1, inactiveOpacity: 0.1,
    label: { color: '#cdd6f4', stroke: '#11111b', activeColor: '#f5f5f7' },
  },
  ring: { fill: '#6c7086', activeFill: '#cba6f7' },
  edge: {
    fill: '#45475a', activeFill: '#cba6f7', opacity: 0.15, selectedOpacity: 0.5, inactiveOpacity: 0.03,
    label: { color: '#6c7086', activeColor: '#cdd6f4' },
  },
  arrow: { fill: '#45475a', activeFill: '#cba6f7' },
  lasso: { background: 'rgba(203, 166, 247, 0.08)', border: 'rgba(203, 166, 247, 0.25)' },
}

function parseWikiLinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]]+)\]\]/g) ?? []
  return matches.map((match) => match.slice(2, -2))
}

function renderMarkdown(content: string, onWikiLinkClick: (target: string) => void): React.ReactNode {
  const lines = content.split('\n')
  return lines.map((line, i) => {
    if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold mb-2">{line.slice(2)}</h1>
    if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-semibold mb-1">{line.slice(3)}</h2>
    if (line.startsWith('### ')) return <h3 key={i} className="text-base font-medium mb-1">{line.slice(4)}</h3>
    if (line === '') return <br key={i} />
    const parts = line.split(/(\[\[[^\]]+\]\])/)
    return (
      <p key={i} className="text-sm mb-1">
        {parts.map((part, j) => {
          if (part.startsWith('[[') && part.endsWith(']]')) {
            const target = part.slice(2, -2)
            return (
              <button key={j} onClick={() => onWikiLinkClick(target)} className="text-blue-400 hover:underline">
                {target}
              </button>
            )
          }
          return part
        })}
      </p>
    )
  })
}

function flattenDocs(files: DocFile[]): DocFile[] {
  const result: DocFile[] = []
  for (const file of files) {
    result.push(file)
    if (file.type === 'directory' && file.children?.length) {
      result.push(...flattenDocs(file.children))
    }
  }
  return result
}

function findFirstFile(files: DocFile[]): DocFile | null {
  for (const file of files) {
    if (file.type === 'file') return file
    if (file.type === 'directory' && file.children?.length) {
      const nested = findFirstFile(file.children)
      if (nested) return nested
    }
  }
  return null
}

function filterDocsTree(files: DocFile[], query: string): DocFile[] {
  if (!query) return files
  const normalized = query.toLowerCase()

  return files.reduce<DocFile[]>((acc, file) => {
    if (file.type === 'file') {
      if (file.name.toLowerCase().includes(normalized)) acc.push(file)
      return acc
    }

    const filteredChildren = filterDocsTree(file.children ?? [], query)
    if (file.name.toLowerCase().includes(normalized) || filteredChildren.length > 0) {
      acc.push({
        ...file,
        children: filteredChildren,
      })
    }
    return acc
  }, [])
}

interface TreeNodeProps {
  file: DocFile
  depth: number
  expandedDirs: Set<string>
  selectedPath: string | null
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
}

function TreeNode({ file, depth, expandedDirs, selectedPath, onToggleDir, onSelectFile }: TreeNodeProps) {
  const isExpanded = expandedDirs.has(file.path)
  const isSelected = selectedPath === file.path

  if (file.type === 'directory') {
    return (
      <div>
        <button
          className="flex items-center gap-1 w-full text-left px-2 py-1 text-xs hover:bg-surface-1 rounded"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => onToggleDir(file.path)}
        >
          <span>{isExpanded ? '▼' : '▶'}</span>
          <span className="text-muted-foreground">{file.name}</span>
        </button>
        {isExpanded && file.children?.map((child) => (
          <TreeNode
            key={child.path}
            file={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            selectedPath={selectedPath}
            onToggleDir={onToggleDir}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    )
  }

  return (
    <button
      className={`flex items-center gap-1 w-full text-left px-2 py-1 text-xs rounded transition-colors ${isSelected ? 'bg-surface-1 text-foreground' : 'text-muted-foreground hover:bg-surface-1 hover:text-foreground'}`}
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
      onClick={() => onSelectFile(file.path)}
    >
      <span>📄</span>
      <span className="truncate">{file.name}</span>
    </button>
  )
}

export function OrgDocsPanel({ entityType, entityId }: OrgDocsPanelProps) {
  const [view, setView] = useState<'files' | 'graph'>('files')
  const [docs, setDocs] = useState<DocFile[]>([])
  const [docContent, setDocContent] = useState<Record<string, string>>({})
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [wikiLinks, setWikiLinks] = useState<string[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreatingDoc, setIsCreatingDoc] = useState(false)
  const [newDocName, setNewDocName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const graphRef = useRef<GraphCanvasRef | null>(null)

  const allDocs = useMemo(() => flattenDocs(docs), [docs])
  const fileDocs = useMemo(() => allDocs.filter((doc) => doc.type === 'file'), [allDocs])

  const loadContent = useCallback((docPath: string, contentMap: Record<string, string>) => {
    setSelectedPath(docPath)
    const nextContent = contentMap[docPath] ?? contentMap[docPath.split('/').pop() ?? ''] ?? '# Empty document'
    setContent(nextContent)
    setWikiLinks(parseWikiLinks(nextContent))
    setIsEditing(false)
  }, [])

  const loadDocs = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/${entityType}s/${entityId}/docs`)
      if (!response.ok) {
        setError('Failed to load docs')
        setDocs([])
        setDocContent({})
        setContent(null)
        setWikiLinks([])
        return
      }

      const data = await response.json() as DocsResponse
      const nextDocs = data.docs ?? []
      const nextContent = data.content ?? {}
      setDocs(nextDocs)
      setDocContent(nextContent)

      const available = flattenDocs(nextDocs).filter((doc) => doc.type === 'file')
      const previouslySelected = available.find((doc) => doc.path === selectedPath)
      const fileToSelect = previouslySelected ?? available[0]
      if (fileToSelect) {
        loadContent(fileToSelect.path, nextContent)
      } else {
        setSelectedPath(null)
        setContent(null)
        setWikiLinks([])
      }
    } catch (fetchError) {
      console.error('Failed to load docs:', fetchError)
      setError('Failed to load docs')
      setDocs([])
      setDocContent({})
      setContent(null)
      setWikiLinks([])
    } finally {
      setIsLoading(false)
    }
  }, [entityId, entityType, loadContent, selectedPath])

  useEffect(() => {
    setExpandedDirs(new Set())
    setSearchQuery('')
    setIsCreatingDoc(false)
    setNewDocName('')
    setIsEditing(false)
    void loadDocs()
  }, [entityType, entityId, loadDocs])

  const handleWikiLinkClick = useCallback((target: string) => {
    const found = fileDocs.find((doc) => doc.name === `${target}.md` || doc.name === target)
    if (found) {
      setView('files')
      loadContent(found.path, docContent)
    }
  }, [docContent, fileDocs, loadContent])

  function handleToggleDir(docPath: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(docPath)) next.delete(docPath)
      else next.add(docPath)
      return next
    })
  }

  function handleNodeClick(node: ReagraphNode) {
    if (!node?.id) return
    const found = fileDocs.find((doc) => doc.path === node.id)
    if (found) {
      setView('files')
      loadContent(found.path, docContent)
    }
  }

  async function handleCreateDoc() {
    const trimmed = newDocName.trim()
    if (!trimmed || isCreating) return

    setIsCreating(true)
    setError(null)
    try {
      const filename = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`
      const response = await fetch(`/api/${entityType}s/${entityId}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          content: `# ${trimmed.replace(/\.md$/i, '')}\n`,
        }),
      })

      if (!response.ok) {
        setError('Failed to create doc')
        return
      }

      setIsCreatingDoc(false)
      setNewDocName('')
      await loadDocs()
    } catch (createError) {
      console.error('Failed to create doc:', createError)
      setError('Failed to create doc')
    } finally {
      setIsCreating(false)
    }
  }

  const { graphNodes, graphEdges } = useMemo(() => {
    const nodes: ReagraphNode[] = fileDocs.map((doc) => ({
      id: doc.path,
      label: doc.name,
      fill: getFileColor(doc.path),
      size: selectedPath === doc.path ? 10 : 6,
    }))

    const edges: ReagraphEdge[] = []
    for (const sourceDoc of fileDocs) {
      const sourceContent = docContent[sourceDoc.path] ?? docContent[sourceDoc.name] ?? ''
      const links = parseWikiLinks(sourceContent)
      for (const link of links) {
        const target = fileDocs.find((doc) => doc.name === `${link}.md` || doc.name === link)
        if (target) {
          edges.push({
            id: `${sourceDoc.path}->${target.path}`,
            source: sourceDoc.path,
            target: target.path,
          })
        }
      }
    }

    return { graphNodes: nodes, graphEdges: edges }
  }, [docContent, fileDocs, selectedPath])

  const filteredDocs = useMemo(() => filterDocsTree(docs, searchQuery), [docs, searchQuery])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0">
        <div className="flex gap-1">
          <button
            onClick={() => setView('files')}
            className={`px-3 py-1 text-xs rounded ${view === 'files' ? 'bg-surface-1 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Files
          </button>
          <button
            onClick={() => setView('graph')}
            className={`px-3 py-1 text-xs rounded ${view === 'graph' ? 'bg-surface-1 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Graph
          </button>
        </div>
        {view === 'files' && (
          <input
            type="text"
            placeholder="Search docs..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="bg-surface-1 border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none w-40"
          />
        )}
        <div className="flex-1" />
        {isCreatingDoc ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newDocName}
              onChange={(event) => setNewDocName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCreateDoc()
                }
                if (event.key === 'Escape') {
                  setIsCreatingDoc(false)
                  setNewDocName('')
                }
              }}
              placeholder="filename.md"
              className="bg-surface-1 border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none w-36"
              autoFocus
            />
            <button
              onClick={() => void handleCreateDoc()}
              disabled={isCreating || !newDocName.trim()}
              className="text-xs px-2 py-1 rounded bg-primary/20 border border-primary/30 text-primary disabled:opacity-50"
            >
              Create
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsCreatingDoc(true)}
            className="text-xs px-2 py-1 rounded bg-surface-1 border border-border text-muted-foreground hover:text-foreground"
          >
            + New Doc
          </button>
        )}
      </div>
      <div className="w-full border-t border-border/50 shrink-0" />

      {view === 'files' ? (
        <div className="flex flex-1 min-h-0">
          <div className="w-48 shrink-0 border-r border-border overflow-y-auto py-2">
            {filteredDocs.map((doc) => (
              <TreeNode
                key={doc.path}
                file={doc}
                depth={0}
                expandedDirs={expandedDirs}
                selectedPath={selectedPath}
                onToggleDir={handleToggleDir}
                onSelectFile={(docPath) => loadContent(docPath, docContent)}
              />
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {error && <div className="text-xs text-red-400 mb-3">{error}</div>}
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading documents...</div>
            ) : selectedPath ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs text-muted-foreground">{selectedPath}</div>
                  <button
                    onClick={() => {
                      setIsEditing(!isEditing)
                      setEditContent(content ?? '')
                    }}
                    className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                  >
                    {isEditing ? 'View' : 'Edit'}
                  </button>
                </div>
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={editContent}
                      onChange={(event) => setEditContent(event.target.value)}
                      className="w-full h-64 bg-surface-1 border border-border rounded p-3 text-sm font-mono text-foreground focus:outline-none resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setContent(editContent)
                          setWikiLinks(parseWikiLinks(editContent))
                          setIsEditing(false)
                        }}
                        className="text-xs px-3 py-1 rounded bg-primary/20 border border-primary/30 text-primary"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="text-xs px-3 py-1 rounded border border-border text-muted-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none text-foreground">
                    {content && renderMarkdown(content, handleWikiLinkClick)}
                  </div>
                )}
                {wikiLinks.length > 0 && (
                  <div className="mt-4 pt-4">
                    <div className="w-full border-t border-border/50" />
                    <div className="text-xs text-muted-foreground mb-2 mt-4">Links</div>
                    <div className="flex flex-wrap gap-2">
                      {wikiLinks.map((link) => (
                        <button
                          key={link}
                          onClick={() => handleWikiLinkClick(link)}
                          className="text-xs px-2 py-0.5 rounded bg-surface-1 border border-border text-muted-foreground hover:text-foreground"
                        >
                          [[{link}]]
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Select a document</div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1">
          {graphNodes.length > 0 ? (
            <GraphCanvas
              ref={graphRef}
              nodes={graphNodes}
              edges={graphEdges}
              theme={obsidianTheme}
              onNodeClick={handleNodeClick}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No documents
            </div>
          )}
        </div>
      )}
    </div>
  )
}
